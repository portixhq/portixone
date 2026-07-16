import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Blocking sleep for the sync rename-retry — a few ms only, to ride out a transient file lock. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Transient Windows/file-sync errors worth retrying (antivirus, search indexer, OneDrive/Dropbox). */
const RETRIABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOENT']);

/**
 * A tiny JSON-file store with ATOMIC, crash-safe writes (hardening #5). The property that matters:
 * a crash or full disk mid-write must never destroy the last valid file — the runtime rides its
 * cached license token through a Portal outage, so losing that file on a bad write would be worse
 * than the outage itself.
 *
 * How the write stays atomic:
 *  - Serialize FIRST — if `JSON.stringify` throws, the existing file is never touched.
 *  - Write to a temp file in the SAME directory (so the final `rename` is a same-volume, atomic
 *    metadata swap, not a cross-volume copy).
 *  - `fsync` the temp's data to disk before renaming, so a power loss can't leave a renamed-but-
 *    empty file.
 *  - `rename` over the destination — atomic on POSIX, and on Windows libuv maps this to
 *    `MoveFileEx(..., MOVEFILE_REPLACE_EXISTING)`, which also replaces atomically.
 *  - NEVER unlink the valid file first. If anything fails before the rename, the old file stands.
 *  - Orphan temps from a previous crashed write are swept on the next write.
 */
export class StorageRepository<T> {
  constructor(private readonly filePath: string) {}

  read(): T | undefined {
    if (!existsSync(this.filePath)) {
      return undefined;
    }
    const raw = readFileSync(this.filePath, 'utf-8');
    return JSON.parse(raw) as T;
  }

  write(data: T): void {
    // Serialize before touching the filesystem — a serialization error must not corrupt the file.
    const payload = JSON.stringify(data, null, 2);

    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    this.sweepOrphanTemps(dir);

    // Retry the WHOLE temp→fsync→rename sequence, not just the rename: a file-sync layer can whisk
    // the temp file away between fsync and rename (seen with OneDrive), so a fresh temp per attempt
    // is more robust than retrying a rename whose source has vanished. The live file is only ever
    // replaced by a fully-written temp, so no attempt can leave it half-written.
    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; ; attempt += 1) {
      const tempPath = join(dir, `.${basename(this.filePath)}.${process.pid}.${Date.now()}.${attempt}.tmp`);
      try {
        this.writeTempThenRename(tempPath, payload);
        return;
      } catch (error) {
        rmSync(tempPath, { force: true });
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (attempt >= MAX_ATTEMPTS || !RETRIABLE_CODES.has(code)) {
          throw error;
        }
        sleepSync(attempt * 15); // 15ms, 30ms, 45ms, 60ms
      }
    }
  }

  private writeTempThenRename(tempPath: string, payload: string): void {
    const mode = this.existingMode();
    const fd = mode === undefined ? openSync(tempPath, 'w') : openSync(tempPath, 'w', mode);
    try {
      writeSync(fd, payload, 0, 'utf-8');
      fsyncSync(fd); // flush data to disk before the rename makes it the live file
    } finally {
      closeSync(fd);
    }
    // Atomic replace. libuv maps this to MoveFileEx(REPLACE_EXISTING) on Windows.
    renameSync(tempPath, this.filePath);
  }

  /** Preserve the destination's permission bits across a rewrite, if it already exists. */
  private existingMode(): number | undefined {
    try {
      return statSync(this.filePath).mode;
    } catch {
      return undefined;
    }
  }

  /** Remove leftover `.<name>.*.tmp` files from a previously interrupted write in this directory. */
  private sweepOrphanTemps(dir: string): void {
    const prefix = `.${basename(this.filePath)}.`;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(prefix) && entry.endsWith('.tmp')) {
        rmSync(join(dir, entry), { force: true });
      }
    }
  }
}
