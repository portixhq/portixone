import { PaperOutError, PrinterBusyError, PrinterNotReadyError, PrinterOfflineError } from '@portixone/shared';
import type { LoggerService } from '../logger/logger.service.js';

/** Windows' Get-Printer PrinterStatus values that mean "another job has it occupied" rather than a hardware fault. */
const BUSY_STATUSES = new Set(['Busy', 'Printing', 'Processing', 'Waiting']);

/**
 * Generic/USB thermal-printer drivers (this project has only ever seen it on
 * the "Generic / Text Only" driver) have proven to report these transiently
 * and inconsistently — the same printer read "Error" seconds before and
 * after a real, physically-confirmed print succeeded (see
 * portixone_distribution_packaging_validation memory, 2026-07-10). Blocking
 * on them outright produced false negatives; a real hardware fault behind
 * one of these readings still surfaces as a concrete error from the actual
 * WritePrinter call moments later.
 */
const UNRELIABLE_STATUSES = new Set(['Error', 'Unknown']);

/**
 * Maps a Windows `Get-Printer` status string to a specific, human-readable
 * error — or does nothing if the printer looks ready. This exists because
 * `winspool.drv`'s `WritePrinter` (used by windows-spooler.driver.ts) can
 * report success even when the physical printer is offline or out of paper —
 * the spooler just queues the job — so this is the only way to catch those
 * conditions before a job "succeeds" but nothing comes out.
 */
export function assertPrinterStatusReady(status: string | undefined, printerName: string, logger: LoggerService): void {
  if (status === undefined || status === 'Normal') {
    return;
  }
  if (status === 'Offline') {
    throw new PrinterOfflineError();
  }
  if (status === 'PaperOut') {
    throw new PaperOutError();
  }
  if (BUSY_STATUSES.has(status)) {
    throw new PrinterBusyError();
  }
  if (UNRELIABLE_STATUSES.has(status)) {
    logger.warn(`Printer "${printerName}" reports status "${status}" — attempting the print anyway since generic/USB drivers report this inconsistently`, {
      printerName,
      status,
    });
    return;
  }
  throw new PrinterNotReadyError(status);
}
