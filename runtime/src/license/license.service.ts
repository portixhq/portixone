import {
  GRACE,
  type LicenseRevocationNotice,
  type LicenseTokenClaims,
  type RuntimeLicensePosture,
  type RuntimeLicenseState,
  type RuntimePublicKeyring,
} from '@portixone/protocol';
import type { LoggerService } from '../logger/logger.service.js';
import { assertNoDevKeysInProduction, resolveKeyring, resolveLicenseEnv } from './license.keyring.js';
import { LicenseStore, type CachedLicense } from './license.store.js';
import { ClockMonitor } from './clock.monitor.js';
import { verifyLicenseToken } from './license.verifier.js';

export interface LicenseServiceOptions {
  /** The public Application ID this runtime is deployed under, if any (config `applicationId`). */
  applicationId?: string;
  /** Overridable for tests; defaults to the fail-closed keyring for the resolved license env. */
  keyring?: RuntimePublicKeyring;
  /** Injectable clock for deterministic grace tests. */
  now?: () => number;
  /** Injectable state paths so parallel test files don't fight over one cwd-fixed file. */
  licenseFilePath?: string;
  clockFilePath?: string;
}

/**
 * The result of deriving a runtime posture from a (possibly expired, possibly absent, possibly
 * revoked) token. Separated from the class so the whole grace/state machine is a pure function —
 * the interesting logic is testable with no filesystem, no clock, no logger. This function is the
 * single source of truth for the precedence table (see license.precedence.test.ts); the cloud side
 * must not diverge from it.
 */
export function derivePosture(
  claims: LicenseTokenClaims | undefined,
  verificationValid: boolean,
  tokenExpiresAt: number | undefined,
  hasApplicationId: boolean,
  revoked: boolean,
  nowMs: number,
): RuntimeLicensePosture {
  // Highest precedence: an authenticated revocation wins over any token state. Admin plane only —
  // printing still continues (this returns a posture, it never blocks a print).
  if (revoked) {
    return 'action_required';
  }

  // No token at all.
  if (!claims || tokenExpiresAt === undefined) {
    // A runtime with no registered Application is just a developer's machine — development, not a
    // license violation. A runtime that IS tied to an Application but never received a token is
    // 'unlicensed' (still prints if paired — see the invariant below).
    return hasApplicationId ? 'unlicensed' : 'development';
  }

  // Signature/kid/claims failed — we cannot trust these claims, expired or not.
  if (!verificationValid && nowMs < tokenExpiresAt) {
    // Well-formed, unexpired, but we can't verify it (unknown_kid, bad sig, bad claims, mismatch).
    return 'unlicensed';
  }

  const expired = nowMs >= tokenExpiresAt;
  if (!expired && verificationValid) {
    // A currently-valid token: posture follows the application's commercial state at issuance.
    switch (claims.applicationStatus) {
      case 'production_active':
        return 'production_active';
      case 'launch_trial':
        return 'trial_active';
      case 'grace_period':
        // The Portal is reachable and chose to keep issuing tokens during the 7-day commercial
        // (payment) grace window — distinct from the offline/technical grace below.
        return 'grace_payment';
      case 'license_action_required':
      case 'suspended':
        return 'action_required';
      default:
        return 'development';
    }
  }

  // Token is expired (or expired + unverifiable). The Portal didn't hand us a fresh one in time,
  // which from the Runtime's vantage point is a technical/offline situation: honor the last valid
  // token for OFFLINE_GRACE_MS counted FROM EXPIRY (not from the last heartbeat — ratified).
  const offlineGraceEndsAt = tokenExpiresAt + GRACE.OFFLINE_GRACE_MS;
  if (nowMs < offlineGraceEndsAt) {
    return 'grace_portal_unreachable';
  }

  // Offline grace exhausted: degrade the ADMIN/DEPLOY layer only. Existing installs keep printing.
  return 'action_required';
}

/**
 * Holds the Runtime's in-memory license posture (plan §4). Loaded from the cached token at boot
 * and refreshed by the heartbeat.
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────────────────────────────
 * Nothing here is awaited on the print hot path, and no posture value blocks a print. Licensing
 * gates admin/deployment actions and drives dashboard/log messaging only. A Portix Cloud outage
 * must never stop local printing (plan §4 / §12 fundamental test). This class is deliberately
 * incapable of failing a print — it exposes state, it does not guard `POST /print`, and it is NOT
 * a dependency of the print/queue/printer layer (frozen by license.architecture.test.ts).
 */
export class LicenseService {
  private readonly store: LicenseStore;
  private readonly clock: ClockMonitor;
  private readonly keyring: RuntimePublicKeyring;
  private readonly now: () => number;
  private readonly applicationId?: string;
  private state: RuntimeLicenseState = { posture: 'development' };
  /** The raw JWT backing `state`, kept in memory so getState() can re-verify as grace windows elapse. */
  private rawToken?: string;
  /** Set when an authenticated revocation was applied; cleared when a fresh valid token arrives. */
  private revokedAt?: number;

  constructor(
    private readonly logger: LoggerService,
    options: LicenseServiceOptions = {},
  ) {
    this.applicationId = options.applicationId;
    this.now = options.now ?? Date.now;
    this.store = new LicenseStore(options.licenseFilePath);
    this.clock = new ClockMonitor(logger, options.clockFilePath);
    if (options.keyring) {
      this.keyring = options.keyring;
    } else {
      // Fail-closed: resolve the environment's keyring and refuse to start production with a dev key.
      const env = resolveLicenseEnv();
      const keyring = resolveKeyring(env);
      assertNoDevKeysInProduction(keyring, env);
      this.keyring = keyring;
    }
  }

  /** Boot: load the cached token from disk, verify it offline, and derive the initial posture. */
  load(): RuntimeLicenseState {
    const cached = this.store.read();
    this.rawToken = cached?.token;
    this.revokedAt = cached?.revokedAt;
    this.clock.observe(this.now());
    this.state = this.deriveFromCached(cached);
    this.logger.info('License posture resolved at boot', {
      posture: this.state.posture,
      applicationId: this.state.applicationId ?? this.applicationId,
      licenseType: this.state.licenseType,
      tokenExpiresAt: this.state.tokenExpiresAt
        ? new Date(this.state.tokenExpiresAt).toISOString()
        : undefined,
    });
    return this.state;
  }

  /**
   * Swap in a freshly issued token (called by the heartbeat). Verifies before persisting so a
   * malformed/expired/mismatched response from the Portal never overwrites a still-good cached
   * token. A successful renewal also clears any prior revocation and confirms the clock. Returns
   * true if the token was accepted.
   */
  applyToken(token: string): boolean {
    const result = verifyLicenseToken(token, this.keyring, {
      now: this.now(),
      expectedApplicationId: this.applicationId,
    });
    if (!result.valid || !result.claims) {
      this.logger.warn('Rejected a license token from the Portal', {
        reason: result.reason,
        kid: result.kid,
      });
      return false;
    }
    const nowMs = this.now();
    const cached: CachedLicense = {
      token,
      tokenExpiresAt: result.claims.exp * 1000,
      lastRenewedAt: nowMs,
    };
    this.store.write(cached);
    this.rawToken = token;
    this.revokedAt = undefined;
    this.clock.recordConfirmed(nowMs); // a real Portal round-trip: the strong clock watermark
    this.state = this.deriveFromCached(cached);
    this.logger.info('License token renewed', {
      posture: this.state.posture,
      tokenExpiresAt: new Date(cached.tokenExpiresAt).toISOString(),
    });
    return true;
  }

  /**
   * Apply an AUTHENTICATED revocation (hardening #3). The caller (heartbeat) must have already
   * confirmed this arrived as the recognized contract over TLS from the expected endpoint; this
   * method additionally checks the notice targets THIS runtime's Application/installation before
   * degrading. Immediate admin-plane degradation — printing continues. Returns true if applied.
   */
  applyRevocation(notice: LicenseRevocationNotice): boolean {
    if (this.applicationId && notice.applicationId !== this.applicationId) {
      this.logger.warn('Ignored a revocation notice for a different Application', {
        noticeApplicationId: notice.applicationId,
      });
      return false;
    }
    const installationId = this.state.claims?.installationId;
    if (notice.installationId && installationId && notice.installationId !== installationId) {
      this.logger.warn('Ignored a revocation notice for a different installation', {
        noticeInstallationId: notice.installationId,
      });
      return false;
    }
    this.revokedAt = this.now();
    const cached = this.store.read();
    if (cached) {
      this.store.write({ ...cached, revokedAt: this.revokedAt });
    }
    this.state = { ...this.state, posture: 'action_required' };
    this.logger.warn('License revoked by the Portal — admin plane degraded (printing unaffected)', {
      applicationId: notice.applicationId,
      effectiveAt: notice.effectiveAt,
    });
    return true;
  }

  getState(): RuntimeLicenseState {
    // Posture is time-dependent (grace windows elapse), so re-derive on read from the last token
    // rather than trusting a value computed at boot hours ago.
    const nowMs = this.now();
    this.clock.observe(nowMs);
    if (this.revokedAt !== undefined) {
      this.state = { ...this.state, posture: 'action_required' };
      return this.state;
    }
    if (this.rawToken && this.state.tokenExpiresAt !== undefined) {
      const result = verifyLicenseToken(this.rawToken, this.keyring, {
        now: nowMs,
        expectedApplicationId: this.applicationId,
      });
      this.state = {
        ...this.state,
        posture: derivePosture(
          this.state.claims,
          result.valid,
          this.state.tokenExpiresAt,
          Boolean(this.applicationId ?? this.state.applicationId),
          false,
          nowMs,
        ),
      };
    }
    return this.state;
  }

  /** True when the app is authorized for commercial production right now (production or trial). */
  isProductionAuthorized(): boolean {
    const posture = this.getState().posture;
    return posture === 'production_active' || posture === 'trial_active';
  }

  private deriveFromCached(cached: CachedLicense | undefined): RuntimeLicenseState {
    const nowMs = this.now();
    const revoked = this.revokedAt !== undefined;
    if (!cached) {
      return {
        posture: derivePosture(undefined, false, undefined, Boolean(this.applicationId), revoked, nowMs),
        applicationId: this.applicationId,
      };
    }
    const result = verifyLicenseToken(cached.token, this.keyring, {
      now: nowMs,
      expectedApplicationId: this.applicationId,
    });
    const claims = result.claims;
    const posture = derivePosture(
      claims,
      result.valid,
      cached.tokenExpiresAt,
      Boolean(this.applicationId ?? claims?.applicationId),
      revoked,
      nowMs,
    );
    if (result.reason === 'unknown_kid') {
      this.logger.warn('Cached license token was signed by an unknown key — runtime may be older than the current signing key', {
        kid: result.kid,
      });
    }
    return {
      posture,
      applicationId: this.applicationId ?? claims?.applicationId,
      licenseType: claims?.licenseType,
      applicationStatus: claims?.applicationStatus,
      claims,
      tokenExpiresAt: cached.tokenExpiresAt,
      lastRenewedAt: cached.lastRenewedAt,
    };
  }
}
