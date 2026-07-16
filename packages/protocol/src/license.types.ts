/**
 * Portix.One licensing — shared contracts between the Runtime (this monorepo) and
 * portix-cloud (private). Promoted from the Phase A design draft in `docs/licensing/contracts.ts`
 * now that Phase C wires a real verifier.
 *
 * The token CLAIMS and the enums live here because both sides must agree on them byte-for-byte:
 * portix-cloud signs a JWT with these claims, the Runtime verifies and reads them. The private
 * signing key never ships in any client — only the public keyring is embedded in the Runtime.
 *
 * Decision references (ratified 2026-07-11) point to docs/licensing/README.md.
 */

// ============================================================================
// Enums (mirror docs/licensing/schema.sql)
// ============================================================================

export type LicenseType = 'free' | 'creator' | 'founder';

/** Internal license/subscription state, mapped from Stripe events (plan §2.2 / §8). */
export type LicenseState =
  | 'active'
  | 'past_due'
  | 'grace_period'
  | 'cancel_at_period_end'
  | 'cancelled'
  | 'disputed'
  | 'lifetime';

/** Application lifecycle (plan §6). */
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
 * produced this token, so the Runtime can hold several valid public keys at once and rotate
 * without breaking runtimes that still cache tokens signed by an older key.
 */
export interface LicenseTokenHeader {
  alg: 'ES256'; // future migration path: 'EdDSA'
  typ: 'JWT';
  /** Key identifier, e.g. "key_2026_01". Selects the public key from the runtime keyring. */
  kid: string;
}

/**
 * JWT payload signed by portix-cloud with its PRIVATE key. The Runtime verifies with the
 * EMBEDDED PUBLIC key named by the header `kid`, offline. `tokenVersion` is a coarse
 * schema/rotation marker; `kid` (header) is the precise key selector.
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
// Runtime side — verification + in-memory state (plan §4)
// ============================================================================

/**
 * The Runtime embeds a KEYRING, not a single key: a map of `kid` → PEM public key. The verifier
 * picks the key named by the token header's `kid`. Rotation = ship a new runtime that adds the
 * new key while keeping the old one for its overlap window; tokens signed by either verify.
 * Decision 1 (ratified).
 */
export type RuntimePublicKeyring = Record</* kid */ string, /* PEM public key */ string>;

/** Grace windows, ratified. Technical grace is counted from token EXPIRY, not last heartbeat. */
export const GRACE = {
  /** Token lifetime. */
  TOKEN_TTL_MS: 48 * 60 * 60 * 1000,
  /** Heartbeat cadence — 4 renewal attempts fit inside one token lifetime. */
  HEARTBEAT_MS: 12 * 60 * 60 * 1000,
  /** Technical grace: Portal unreachable / offline. Starts when the token expires. */
  OFFLINE_GRACE_MS: 72 * 60 * 60 * 1000, // → token(48h) + grace(72h) ≈ 5 days offline
  /**
   * Sanity clamp on a token's own lifetime (`exp - iat`). A correctly issued token is 48h; a
   * token claiming a far longer life is either a cloud bug or an attempt to mint a near-permanent
   * credential, so the verifier rejects it (belt-and-suspenders on top of the signature, since a
   * mis-issued long-lived token would still be signed). Generous enough to absorb clock skew.
   */
  MAX_TOKEN_LIFETIME_MS: 7 * 24 * 60 * 60 * 1000,
} as const;
// Commercial grace (7 days for payment failure) is a SEPARATE, cloud-side timer — the Portal
// is reachable and knows the commercial state. It is never conflated with OFFLINE_GRACE_MS.

/** Why the Runtime is (or isn't) treating the app as commercially authorized right now. */
export type RuntimeLicensePosture =
  | 'production_active'
  | 'trial_active'
  | 'development'
  | 'grace_portal_unreachable' // technical grace: last valid token honored for 72h AFTER expiry
  | 'grace_payment' //           commercial grace: 7-day cloud-side window; runtime still prints
  | 'action_required' //         admin/deploy actions blocked; existing installs still print
  | 'unlicensed'; //             no valid token; still prints if paired — license ≠ print gate

/**
 * Held in memory by `runtime/src/license/license.service.ts`. Loaded from the cached token at
 * boot and refreshed by the heartbeat. INVARIANT: nothing on the print hot path awaits this.
 */
export interface RuntimeLicenseState {
  posture: RuntimeLicensePosture;
  applicationId?: string;
  licenseType?: LicenseType;
  applicationStatus?: ApplicationStatus;
  claims?: LicenseTokenClaims;
  /**
   * When the cached token expires (ms since epoch). Offline grace runs until
   * `tokenExpiresAt + OFFLINE_GRACE_MS`; neither expiry nor grace exhaustion is a hard stop on
   * printing.
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
  /**
   * Present when valid === false. Granular so logs distinguish a benign rotation gap from a real
   * tampering signal:
   * - `unknown_kid` — no key in the keyring matched the header (runtime older than the signing key).
   * - `bad_signature` — a key matched but the signature didn't verify (tampering / wrong key).
   * - `expired` — signature good, but past `exp` (claims still returned for grace math).
   * - `bad_issuer` — `iss` is not Portix.One's token service.
   * - `application_mismatch` — the token authorizes a different Application than this runtime is
   *   deployed as (a valid token for App X presented to a runtime configured as App Y).
   * - `incoherent_claims` — timestamps don't form a sane sequence, or `exp - iat` exceeds
   *   `GRACE.MAX_TOKEN_LIFETIME_MS`.
   * - `malformed` — not a well-formed ES256 compact JWS.
   */
  reason?:
    | 'expired'
    | 'bad_signature'
    | 'malformed'
    | 'revoked'
    | 'unknown_kid'
    | 'bad_issuer'
    | 'application_mismatch'
    | 'incoherent_claims';
}

/**
 * The recognized shape of an AUTHENTICATED revocation, delivered by the Portal's heartbeat
 * response over TLS. Only a body matching this contract — with `applicationId`/`installationId`
 * that match the runtime's own — triggers immediate admin-plane degradation. A bare 401/403/500,
 * a timeout, or unknown JSON is NOT a revocation; the runtime conserves its last verifiable state
 * (best-effort). The stronger form is a signed token carrying `applicationStatus:
 * 'license_action_required'`, which degrades through the normal verified-token path.
 */
export interface LicenseRevocationNotice {
  code: 'license_revoked';
  applicationId: string;
  installationId?: string;
  /** ISO-8601 instant the revocation takes effect. */
  effectiveAt: string;
}

/**
 * ── Planned contract evolution (NOT yet emitted; do not design cloud around its absence) ──
 * The license token is expected to gain, once portix-cloud token issuance is built and the two
 * sides coordinate a `tokenVersion` bump:
 *   - `aud` — the audience (e.g. the specific installation or runtime), tightening replay scope.
 *   - `nbf` — not-before, so a token can be pre-issued.
 *   - a formal `tokenVersion` negotiation (runtime advertises the versions it accepts).
 * These are deferred deliberately (they require cloud to emit them), but are reserved here so the
 * cloud token service is designed toward this shape rather than an accidental one.
 */
export type LicenseTokenContractEvolution = 'aud | nbf | tokenVersion-negotiation — reserved';
