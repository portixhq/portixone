export class PortixError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class PrinterNotFoundError extends PortixError {
  constructor(printerName?: string) {
    super(
      printerName ? `Printer not found: ${printerName}` : 'No printer available',
      'PRINTER_NOT_FOUND',
    );
  }
}

export class InvalidApiKeyError extends PortixError {
  constructor() {
    super('Invalid or missing API key', 'INVALID_API_KEY');
  }
}

export class InvalidPrintJobError extends PortixError {
  constructor(details: string) {
    super(`Invalid print job: ${details}`, 'INVALID_PRINT_JOB');
  }
}

export class JobNotFoundError extends PortixError {
  constructor(jobId: string) {
    super(`Job not found: ${jobId}`, 'JOB_NOT_FOUND');
  }
}

export class PrinterConnectionError extends PortixError {
  constructor(details: string) {
    super(`Could not reach printer: ${details}`, 'PRINTER_CONNECTION_FAILED');
  }
}

export class PairingNotFoundError extends PortixError {
  constructor() {
    super('Pairing code not found or expired', 'PAIRING_NOT_FOUND');
  }
}

export class UntrustedOriginError extends PortixError {
  constructor() {
    super('This origin is not trusted for this pairing', 'UNTRUSTED_ORIGIN');
  }
}

export class PermissionDeniedError extends PortixError {
  constructor(permission: string) {
    super(`This app is not authorized for: ${permission}`, 'PERMISSION_DENIED');
  }
}

export class JobNotCancellableError extends PortixError {
  constructor(status: string) {
    super(`Job already ${status}, cannot cancel`, 'JOB_NOT_CANCELLABLE');
  }
}

export class InvalidRequestError extends PortixError {
  constructor(details: string) {
    super(`Invalid request: ${details}`, 'INVALID_REQUEST');
  }
}

export class PrinterOfflineError extends PortixError {
  constructor(context?: string) {
    super(context ? `Printer is offline (${context}).` : 'Printer is offline.', 'PRINTER_OFFLINE');
  }
}

export class PaperOutError extends PortixError {
  constructor() {
    super('Paper out.', 'PAPER_OUT');
  }
}

export class PrinterConnectionLostError extends PortixError {
  constructor(context?: string) {
    super(context ? `Connection lost (${context}).` : 'Connection lost.', 'CONNECTION_LOST');
  }
}

export class PrinterTimeoutError extends PortixError {
  constructor(context?: string) {
    super(
      context
        ? `Connection timed out (${context}) — check the printer is powered on and reachable.`
        : 'Connection timed out — check the printer is powered on and reachable.',
      'PRINTER_TIMEOUT',
    );
  }
}

export class PrinterBusyError extends PortixError {
  constructor() {
    super('Printer is busy — try again shortly.', 'PRINTER_BUSY');
  }
}

/** Catch-all for a printer reporting a real, non-Normal status we don't have a more specific error for (paper jam, door open, low toner, ...). */
export class PrinterNotReadyError extends PortixError {
  constructor(reason: string) {
    super(`Printer is not ready: ${reason}.`, 'PRINTER_NOT_READY');
  }
}

/**
 * The app printed to a logical target this installation has never had a printer assigned to.
 *
 * Deliberately raised at enqueue time, not at print time: this is a configuration gap the Runtime
 * knows about immediately, so the caller gets an error it can act on ("run setup for this target")
 * instead of a job that is accepted and then quietly fails somewhere in the queue.
 */
export class TargetNotConfiguredError extends PortixError {
  constructor(target: string) {
    super(
      `No printer is configured for the "${target}" target on this machine. Run printer setup to assign one.`,
      'TARGET_NOT_CONFIGURED',
    );
  }
}

/** The printer a target was bound to no longer exists — uninstalled or renamed. Needs reconfiguration, not a silent fallback to some other printer. */
export class MappingInvalidError extends PortixError {
  constructor(target: string, printerName: string) {
    super(
      `The "${target}" target is assigned to "${printerName}", which is no longer installed on this machine. Reassign it.`,
      'MAPPING_INVALID',
    );
  }
}

export class InvalidDriverConfigError extends PortixError {
  constructor(details: string) {
    super(`Printer driver is not configured correctly: ${details}`, 'INVALID_DRIVER_CONFIG');
  }
}

/** Thrown before a request body is fully read, not after parsing — protects an unauthenticated endpoint (e.g. /pairing/request) from an unbounded-memory DoS. */
export class PayloadTooLargeError extends PortixError {
  constructor(maxBytes: number) {
    super(`Request body exceeds the ${maxBytes}-byte limit.`, 'PAYLOAD_TOO_LARGE');
  }
}
