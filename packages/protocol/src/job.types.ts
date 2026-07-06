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
