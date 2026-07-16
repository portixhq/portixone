import type { LoggerService } from '../logger/logger.service.js';
import { distributionBranding } from '@portixone/shared';
import { InstallationStore, type InstallationIdentity } from './installation.store.js';
import type { LicenseService } from './license.service.js';

/** The minimal shape the exchange needs from `fetch` — injectable so tests need no network. */
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface InstallationServiceOptions {
  /**
   * The one-time installation token minted by portix-cloud (plan §9) and handed to the installer
   * (e.g. via a per-App download link, written into config at install time). Single-use,
   * minutes-long TTL. Consumed exactly once, then never needed again.
   */
  installationToken?: string;
  /** portix-cloud's installation-registration endpoint. Unset = exchange skipped. */
  registrationUrl?: string;
  fetchImpl?: FetchLike;
  /** Injectable state path so parallel test files don't fight over one cwd-fixed file. */
  identityFilePath?: string;
}

interface RegistrationResponse {
  installationId?: string;
  applicationId?: string;
  appName?: string;
  /** Optionally, the first license token, so the runtime is production-ready immediately. */
  token?: string;
}

/**
 * Consumes a one-time installation token on first boot and registers this Runtime as an
 * Installation of a developer's Application (plan §9, §16). This is what lets a SaaS distribute
 * the generic Runtime to thousands of end customers with no developer touch: the download link
 * carries a short-lived token, the installer drops it into config, and this exchanges it for a
 * durable Installation Identity — then the token is spent and irrelevant.
 *
 * ── NON-BLOCKING, IDEMPOTENT ───────────────────────────────────────────────────────────────
 * Runs once at boot, off the print path, and every failure is caught and logged (never thrown) —
 * a registration hiccup must not stop a machine from printing. If an Installation Identity already
 * exists on disk, the token is ignored (a reinstall reuses the identity instead of burning a new
 * token).
 */
export class InstallationService {
  private readonly store: InstallationStore;
  private readonly fetchImpl?: FetchLike;

  constructor(
    private readonly logger: LoggerService,
    private readonly license: LicenseService,
    private readonly options: InstallationServiceOptions = {},
  ) {
    this.store = new InstallationStore(options.identityFilePath);
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  }

  /** The already-registered identity, if any. */
  getIdentity(): InstallationIdentity | undefined {
    return this.store.read();
  }

  /** The distribution branding line for this installation, or undefined for a bare dev runtime. */
  branding(): string | undefined {
    const identity = this.store.read();
    if (!identity) {
      return undefined;
    }
    return distributionBranding(identity.appName ?? identity.applicationId);
  }

  /**
   * Exchange the installation token for an Installation Identity, once. Returns the identity if
   * one now exists (freshly registered or already present), or undefined if there was nothing to
   * do / the exchange failed. Safe to call unconditionally at boot.
   */
  async registerIfNeeded(): Promise<InstallationIdentity | undefined> {
    const existing = this.store.read();
    if (existing) {
      return existing; // already registered — never burn a second token
    }
    const { installationToken, registrationUrl } = this.options;
    if (!installationToken || !registrationUrl || !this.fetchImpl) {
      return undefined; // a plain dev runtime with no token to consume
    }

    try {
      const response = await this.fetchImpl(registrationUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installationToken }),
      });
      if (!response.ok) {
        this.logger.warn('Installation registration got a non-OK response', { status: response.status });
        return undefined;
      }
      const body = (await response.json()) as RegistrationResponse;
      if (!body.installationId || !body.applicationId) {
        this.logger.warn('Installation registration response was missing installationId/applicationId');
        return undefined;
      }
      const identity: InstallationIdentity = {
        installationId: body.installationId,
        applicationId: body.applicationId,
        appName: body.appName,
        registeredAt: new Date().toISOString(),
      };
      this.store.write(identity);
      // If the Portal also handed us a first license token, apply it so the runtime is ready now.
      if (body.token) {
        this.license.applyToken(body.token);
      }
      this.logger.info('Installation registered', {
        installationId: identity.installationId,
        applicationId: identity.applicationId,
        branding: this.branding(),
      });
      return identity;
    } catch (error) {
      this.logger.warn('Installation registration failed — will retry on next boot', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
