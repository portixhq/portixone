import { join } from 'node:path';
import { StorageRepository } from '../storage/storage.repository.js';
import type { LoggerService } from '../logger/logger.service.js';

/**
 * All license grace math is local-clock based, so winding the system clock backwards can extend a
 * grace window. This detects that — as a DIAGNOSTIC SIGNAL ONLY. It never gates printing, never
 * changes posture, never shortens grace. It just makes a suspicious clock visible in the logs.
 *
 * Two watermarks, per the hardening spec:
 *  - `highestLocalMs`   — the greatest `Date.now()` ever seen. A WEAK signal: a clock accidentally
 *                         set far into the future would poison it, so it only ever raises a warning.
 *  - `highestConfirmedMs` — the greatest time confirmed by a SUCCESSFUL heartbeat (a real network
 *                         round-trip to the Portal). A STRONG signal: it can't be moved by the local
 *                         clock alone.
 */
export interface ClockWatermarks {
  highestLocalMs: number;
  highestConfirmedMs: number;
}

/** How far the clock must fall below a watermark before it's worth a diagnostic (absorbs NTP jitter). */
const ROLLBACK_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * The local watermark is kept precise in memory but persisted only in coarse steps. Rollback
 * detection tolerates minutes of jitter anyway, and persisting on every posture read would hammer
 * the disk (and any file-sync/AV layer) for no diagnostic benefit.
 */
const LOCAL_PERSIST_STEP_MS = 60 * 60 * 1000; // persist at most ~once per hour of advance

export class ClockMonitor {
  private readonly storage: StorageRepository<ClockWatermarks>;
  private marks: ClockWatermarks;
  /** The local watermark value last written to disk — throttles persistence (see LOCAL_PERSIST_STEP_MS). */
  private persistedLocalMs: number;

  /** `filePath` is injectable so parallel test files don't silently fight over one cwd-fixed file. */
  constructor(
    private readonly logger: LoggerService,
    filePath: string = join(process.cwd(), '.data', 'clock.json'),
  ) {
    this.storage = new StorageRepository<ClockWatermarks>(filePath);
    let existing: ClockWatermarks | undefined;
    try {
      existing = this.storage.read();
    } catch {
      existing = undefined;
    }
    this.marks = existing ?? { highestLocalMs: 0, highestConfirmedMs: 0 };
    this.persistedLocalMs = this.marks.highestLocalMs;
  }

  /**
   * Persist the watermarks. This is PURELY DIAGNOSTIC state — a failed write must never propagate
   * into the license path (it would be absurd for a rollback-detection file to break licensing,
   * which itself must never break printing). So a persistence error is swallowed; the in-memory
   * watermarks stay correct for this process.
   */
  private persist(): void {
    try {
      this.storage.write(this.marks);
    } catch {
      // Diagnostic-only: ignore. Worst case we re-detect the same rollback after a restart.
    }
  }

  /**
   * Record the current local time and flag a rollback if it's meaningfully behind either watermark.
   * Call on boot and whenever posture is read. Returns true if a rollback was detected (for tests).
   */
  observe(nowMs: number): boolean {
    let rolledBack = false;
    if (nowMs + ROLLBACK_THRESHOLD_MS < this.marks.highestConfirmedMs) {
      // Strong signal: the clock is behind a time the Portal itself confirmed.
      this.logger.warn('Clock rollback detected against a Portal-confirmed time (diagnostic only — printing unaffected)', {
        nowMs,
        highestConfirmedMs: this.marks.highestConfirmedMs,
        behindByMs: this.marks.highestConfirmedMs - nowMs,
      });
      rolledBack = true;
    } else if (nowMs + ROLLBACK_THRESHOLD_MS < this.marks.highestLocalMs) {
      // Weak signal: behind the highest local time we've seen; could be a legitimate NTP correction.
      this.logger.warn('Clock moved backwards vs the highest local time seen (weak signal — printing unaffected)', {
        nowMs,
        highestLocalMs: this.marks.highestLocalMs,
      });
      rolledBack = true;
    }
    if (nowMs > this.marks.highestLocalMs) {
      this.marks = { ...this.marks, highestLocalMs: nowMs };
      // Persist only after a meaningful advance, not on every posture read.
      if (nowMs - this.persistedLocalMs >= LOCAL_PERSIST_STEP_MS) {
        this.persistedLocalMs = nowMs;
        this.persist();
      }
    }
    return rolledBack;
  }

  /** Record a time confirmed by a successful heartbeat — the strong, tamper-resistant watermark. */
  recordConfirmed(nowMs: number): void {
    if (nowMs > this.marks.highestConfirmedMs) {
      this.marks = { ...this.marks, highestConfirmedMs: nowMs, highestLocalMs: Math.max(nowMs, this.marks.highestLocalMs) };
      this.persistedLocalMs = this.marks.highestLocalMs;
      this.persist(); // confirmations are rare — always persist
    }
  }

  watermarks(): ClockWatermarks {
    return this.marks;
  }
}
