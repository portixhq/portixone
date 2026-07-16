import { join } from 'node:path';
import { StorageRepository } from '../storage/storage.repository.js';

/**
 * The Installation Identity this Runtime received when it consumed its one-time installation token
 * (plan §9). Persisted so the exchange happens exactly once — a reinstall reuses this rather than
 * burning a fresh token. NOT a billing unit; carries no ticket content or end-customer PII.
 */
export interface InstallationIdentity {
  installationId: string;
  applicationId: string;
  /** The developer's Application display name, used to compose distribution branding. */
  appName?: string;
  registeredAt: string;
}

export class InstallationStore {
  private readonly storage: StorageRepository<InstallationIdentity>;

  /** `filePath` is injectable so parallel test files don't silently fight over one cwd-fixed file. */
  constructor(filePath: string = join(process.cwd(), '.data', 'installation.json')) {
    this.storage = new StorageRepository<InstallationIdentity>(filePath);
  }

  read(): InstallationIdentity | undefined {
    return this.storage.read();
  }

  write(identity: InstallationIdentity): void {
    this.storage.write(identity);
  }
}
