import { join } from 'node:path';
import { StorageRepository } from '../storage/storage.repository.js';

/**
 * What the Runtime persists between restarts about its license token. Only the raw JWT and a
 * little metadata — the claims are re-derived by verifying the token at boot, never trusted from
 * disk. Persistence is what lets an end-customer machine survive a reboot during a Portal outage
 * and keep printing on its last valid token through the offline-grace window (plan §4).
 */
export interface CachedLicense {
  /** The compact JWS license token last issued by portix-cloud. */
  token: string;
  /** Copied from the token's `exp` (ms since epoch) for a cheap glance without re-parsing. */
  tokenExpiresAt: number;
  /** When the heartbeat last swapped this token in — diagnostics only, NOT the grace basis. */
  lastRenewedAt: number;
  /**
   * Set when the Portal delivered an AUTHENTICATED revocation (LicenseRevocationNotice over TLS).
   * Persisted so a reboot stays in `action_required` rather than silently recovering; cleared when
   * a fresh valid token is applied. Revocation degrades the admin plane only — printing continues.
   */
  revokedAt?: number;
}

/**
 * Stored next to the rest of the runtime's state (`.data/`), matching ConfigService / PairingStore.
 * The file is not a secret in the confidentiality sense — the token is a signed capability, not a
 * password — but it is per-installation state, so it lives with the installation, not in the repo.
 */
export class LicenseStore {
  private readonly storage: StorageRepository<CachedLicense>;

  /** `filePath` is injectable so parallel test files don't silently fight over one cwd-fixed file. */
  constructor(filePath: string = join(process.cwd(), '.data', 'license.json')) {
    this.storage = new StorageRepository<CachedLicense>(filePath);
  }

  read(): CachedLicense | undefined {
    return this.storage.read();
  }

  write(cached: CachedLicense): void {
    this.storage.write(cached);
  }
}
