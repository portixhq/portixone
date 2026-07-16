import { join } from 'node:path';
import type { PrinterTargetsConfig } from '@portixone/protocol';
import { StorageRepository } from '../storage/storage.repository.js';

/**
 * Persists this installation's target → printer bindings.
 *
 * Lives in `.data/`, which the installer does not touch, so an end customer's printer setup
 * survives a Runtime update — the whole point of configuring it once.
 */
export class PrinterTargetsStore {
  private readonly storage: StorageRepository<PrinterTargetsConfig>;

  /**
   * `filePath` is injectable so tests can point at a temp file. Without it the path is fixed to the
   * process cwd, which makes parallel test files silently fight over one another's state — they
   * pass alone and fail together, or worse, pass together by luck.
   */
  constructor(filePath: string = join(process.cwd(), '.data', 'printer-targets.json')) {
    this.storage = new StorageRepository<PrinterTargetsConfig>(filePath);
  }

  read(): PrinterTargetsConfig {
    return this.storage.read() ?? { applications: {} };
  }

  write(config: PrinterTargetsConfig): void {
    this.storage.write(config);
  }
}
