/**
 * Portix.One licensing — shared contracts (Phase A design draft).
 *
 * DESIGN REFERENCE ONLY. Not exported, not compiled into any package, nothing wired.
 * These are the interfaces the runtime (this monorepo) and portix-cloud (private) agree on
 * "on paper" before Phase C builds the token service + runtime verifier. When Phase C starts,
 * the shared subset (token claims + enums) should move into `packages/protocol`.
 *
 * `TBD-<n>` markers point to the open decisions in README.md.
 */

// ============================================================================
// Shared enums (mirror schema.sql; will live in @portixone/protocol)
// ============================================================================

export type LicenseType = 'free' | 'creator' | 'founder';

export type LicenseState =
  | 'active'
  | 'past_due'
  | 'grace_period'
  | 'cancel_at_period_end'
  | 'cancelled'
  | 'disputed'
  | 'lifetime';

export type ApplicationStatus =
  | 'draft'
  | 'development'
  | 'validated'
  | 'ready_to_launch'
  | 'launch_trial'
  | 'production_active'
  | 'grace_period'
  | 'license_action_required'
  | 'suspended';

// ============================================================================
// License token — the cloud-signed JWT (plan §10)
// Decision 1 (ratified): ES256, mandatory `kid`, runtime keyring for rotation.
// ============================================================================

/**
 * JOSE header of the license token. `kid` is MANDATORY: it names exactly which signing key
 * produced this token, so the runtime can hold several valid public keys at once and rotate
 * without breaking runtimes that still cache tokens signed by an older key.
 */
export interface LicenseTokenHeader {
  alg: 'ES256'; // future migration path: 'EdDSA'
  typ: 'JWT';
  /** Key identifier, e.g. "key_2026_01". Selects the public key from the runtime keyring. */
  kid: string;
}

/**
 * JWT payload signed by portix-cloud with its PRIVATE key. The runtime verifies with the
 * EMBEDDED PUBLIC key named by the header `kid`, offline. The private key never ships in any
 * client. `tokenVersion` is a coarse schema/rotation marker; `kid` (header) is the precise
 * key selector.
 */
export interface LicenseTokenClaims {
  /** Standard JWT: issuer is always Portix.One's token service. */
  iss: 'portix.one';
  /** Subject = the Application ID (public, `app_<slug>_<rand>`). */
  sub: string;
  /** Seconds since epoch. exp = iat + 48h; renewed via the 12h heartbeat. */
  iat: number;
  exp: number;

  developerId: string;
  applicationId: string;
  installationId?: string;
  licenseType: LicenseType;
  /** The application's commercial state at issuance time. */
  applicationStatus: ApplicationStatus;
  /** Origins this token is valid for; a supporting signal, not the sole gate (plan §7). */
  allowedOrigins: string[];
  licenseId: string;
  activationId: string;
  /** Coarse rotation/schema marker; starts at 1. Precise key selection is the header `kid`. */
  tokenVersion: number;
}

// ============================================================================
// Runtime side — in-memory license state (this monorepo, plan §4)
// ============================================================================

/**
 * The runtime embeds a KEYRING, not a single key: a map of `kid` → public key. The verifier
 * picks the key named by the token header's `kid`. Rotation = ship a new runtime that adds the
 * new key while keeping the old one for its overlap window; tokens signed by either verify.
 * Decision 1 (ratified).
 */
export type RuntimePublicKeyring = Record</* kid */ string, /* PEM/JWK public key */ string>;

/** Grace windows, ratified. Technical grace is counted from token EXPIRY, not last heartbeat. */
export const GRACE = {
  /** Token lifetime. */
  TOKEN_TTL_MS: 48 * 60 * 60 * 1000,
  /** Heartbeat cadence — 4 renewal attempts fit inside one token lifetime. */
  HEARTBEAT_MS: 12 * 60 * 60 * 1000,
  /** Technical grace: Portal unreachable / offline. Starts when the token expires. */
  OFFLINE_GRACE_MS: 72 * 60 * 60 * 1000, // → token(48h) + grace(72h) ≈ 5 days offline
} as const;
// Commercial grace (7 days for payment failure) is a SEPARATE, cloud-side timer — the Portal
// is reachable and knows the commercial state. It is never conflated with OFFLINE_GRACE_MS.

/** Why the runtime is (or isn't) treating the app as commercially authorized right now. */
export type RuntimeLicensePosture =
  | 'production_active'
  | 'trial_active'
  | 'development'
  | 'grace_portal_unreachable' // technical grace: last valid token honored for 72h AFTER expiry
  | 'grace_payment'            // commercial grace: 7-day cloud-side window; runtime still prints
  | 'action_required'          // admin/deploy actions blocked; existing installs still print
  | 'unlicensed';              // no valid token; still prints if paired — license ≠ print gate

/**
 * Held in memory by `runtime/src/license/license.service.ts`. Loaded from the cached token at
 * boot and refreshed by the heartbeat. INVARIANT: nothing on the print hot path awaits this.
 */
export interface RuntimeLicenseState {
  posture: RuntimeLicensePosture;
  applicationId?: string;
  claims?: LicenseTokenClaims;
  /**
   * When the cached token expires. Offline grace runs until `tokenExpiresAt + OFFLINE_GRACE_MS`;
   * neither expiry nor grace exhaustion is a hard stop on printing.
   */
  tokenExpiresAt?: number;
  /** Last successful heartbeat renewal — diagnostics only; NOT the basis for the grace window. */
  lastRenewedAt?: number;
}

export interface LicenseVerificationResult {
  valid: boolean;
  claims?: LicenseTokenClaims;
  /** The `kid` the token asked for — lets the caller log an unknown-key rotation gap. */
  kid?: string;
  /** Present when valid === false. 'unknown_kid' = no key in the keyring matched the header. */
  reason?: 'expired' | 'bad_signature' | 'malformed' | 'revoked' | 'unknown_kid';
}

// ============================================================================
// SDK contract delta (this monorepo, plan §5)
// ============================================================================

/**
 * No new required option and no behavior change in Phase A. The two staged changes:
 *
 *  1. `appId` (already in sdk-js/src/types.ts PortixOptions) is promoted in meaning to the
 *     PUBLIC, cloud-registered Application ID. No type change — a documentation/semantics change.
 *
 *  2. `mode`/`environment` is demoted to a NON-AUTHORITATIVE hint. The runtime + signed token
 *     decide production, never the browser (plan §5, §7, §13). No secret ever ships in the
 *     browser bundle — public appId + public integration key only.
 *
 * Nothing here changes `pair()` or `print()`; licensing is transparent to the print call.
 */
export type SdkContractDelta = 'documentation-and-semantics-only-in-phase-A';
