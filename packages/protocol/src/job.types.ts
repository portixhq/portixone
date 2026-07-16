import type { PrintTarget } from './printer-target.types.js';

/**
 * Device capabilities per the PortixOne capability model. Only PRINT is
 * implemented today — the rest are reserved names for future device types
 * (cash drawer, scale, ...) so the wire contract doesn't need to change shape
 * when they're added.
 */
export enum Capability {
  PRINT = 'PRINT',
  CUT = 'CUT',
  OPEN_DRAWER = 'OPEN_DRAWER',
  READ_WEIGHT = 'READ_WEIGHT',
}

export type JobStatus = 'pending' | 'printing' | 'completed' | 'failed' | 'cancelled';

export interface PrintJob {
  content: string;
  /**
   * The logical destination to print to (`receipt`, `kitchen`, …). The Runtime resolves it to a
   * physical printer using this installation's own configuration, so the application never needs to
   * know what the printer is called on the customer's machine. This is the intended way to print.
   */
  target?: PrintTarget;
  /**
   * The physical printer name, bypassing target resolution.
   *
   * ADVANCED / COMPATIBILITY. It requires the caller to know a Windows printer name on someone
   * else's machine, which doesn't survive being distributed to more than one customer. Prefer
   * `target`.
   */
  printerName?: string;
  copies?: number;
}

export interface PrintJobResult {
  jobId: string;
  status: JobStatus;
  message?: string;
  /** The rendered text preview — only present when the job ran in the SDK's mock mode. */
  preview?: string;
}

/** Which paired app a job belongs to — absent means the admin key placed it. */
export interface JobOwner {
  tenant: string;
  appId: string;
}

/** A job's full record as tracked by the queue, returned by `getJobs()`. */
export interface JobRecord {
  jobId: string;
  status: JobStatus;
  /** The logical target requested, when the caller used one. */
  target?: PrintTarget;
  /** The physical printer the job actually went to — resolved from `target` when one was used. */
  printerName?: string;
  copies?: number;
  message?: string;
  createdAt: string;
  updatedAt: string;
  owner?: JobOwner;
}

export interface RuntimeStatus {
  status: 'online';
  version: string;
  defaultPrinter?: string;
  /** True when the Runtime's printer driver is `mock` — jobs are accepted and tracked but never reach real hardware. */
  simulated: boolean;
}

/** A printer as reported by discovery — see `listPrinters()`/`getPrinter()`. */
export interface PrinterInfo {
  name: string;
  driver?: string;
  port?: string;
  /** Raw OS-level status string (e.g. Windows' `PrinterStatus`), when available. */
  status?: string;
  online: boolean;
}
