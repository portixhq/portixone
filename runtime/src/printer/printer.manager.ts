import type { PrinterInfo, PrintJobInput, PrintTarget } from '@portixone/protocol';
import { InvalidDriverConfigError, MappingInvalidError, PrinterNotFoundError } from '@portixone/shared';
import { detectWindowsPrinters } from './detectors/windows.detector.js';
import { detectLanPrinters } from './detectors/lan.detector.js';
import { MockPrinterDriver } from './drivers/mock.driver.js';
import { NetworkPrinterDriver } from './drivers/network.driver.js';
import { WindowsSpoolerPrinterDriver } from './drivers/windows-spooler.driver.js';
import type { PrinterDriver } from './drivers/printer-driver.types.js';
import { assertPrinterStatusReady } from './printer-status.js';
import type { RuntimeConfig } from '../config/config.types.js';
import type { LoggerService } from '../logger/logger.service.js';

function createDriver(config: RuntimeConfig, logger: LoggerService): PrinterDriver {
  switch (config.printerDriver) {
    case 'network':
      if (!config.networkPrinterHost) {
        throw new InvalidDriverConfigError('PORTIX_NETWORK_PRINTER_HOST is required when printerDriver is "network"');
      }
      return new NetworkPrinterDriver(config.networkPrinterHost, config.networkPrinterPort);
    case 'windows-spooler':
      return new WindowsSpoolerPrinterDriver(config.defaultPrinter);
    case 'mock':
    default:
      return new MockPrinterDriver(logger);
  }
}

export class PrinterManager {
  private readonly driver: PrinterDriver;
  private readonly driverType: RuntimeConfig['printerDriver'];
  private readonly defaultPrinter?: string;

  constructor(
    config: RuntimeConfig,
    private readonly logger: LoggerService,
  ) {
    this.driver = createDriver(config, logger);
    this.driverType = config.printerDriver;
    this.defaultPrinter = config.defaultPrinter;
  }

  /**
   * The full discovery view — Windows-installed printers plus anything
   * found on the local subnet. Used by `GET /printers` and the SDK's
   * `listPrinters()`. Deliberately *not* used by the print-time pre-flight
   * check below (`assertPrinterReady`) — a LAN sweep takes a second or more,
   * and that check runs on every single print job, so it goes straight to
   * `detectWindowsPrinters()` instead to keep printing fast.
   */
  async listPrinters(): Promise<PrinterInfo[]> {
    const [windowsPrinters, lanPrinters] = await Promise.all([detectWindowsPrinters(), detectLanPrinters()]);
    return [...windowsPrinters, ...lanPrinters];
  }

  async getPrinter(name: string): Promise<PrinterInfo> {
    const printers = await this.listPrinters();
    const printer = printers.find((candidate) => candidate.name === name);
    if (!printer) {
      throw new PrinterNotFoundError(name);
    }
    return printer;
  }

  async print(job: PrintJobInput): Promise<void> {
    if (this.driverType === 'windows-spooler') {
      await this.assertPrinterReady(job.printerName ?? this.defaultPrinter, job.target);
    }
    await this.driver.print(job);
  }

  /**
   * winspool.drv's WritePrinter can report success even when the physical
   * printer is offline, out of paper, or busy — the spooler just queues the
   * job — so this is the only way to catch those conditions up front instead
   * of a job silently "succeeding" with nothing coming out.
   */
  private async assertPrinterReady(name: string | undefined, target?: PrintTarget): Promise<void> {
    if (!name) {
      return;
    }
    const printers = await detectWindowsPrinters();
    if (printers.length === 0) {
      return; // discovery unavailable — don't block printing on a detection failure
    }
    const printer = printers.find((candidate) => candidate.name === name);
    if (!printer) {
      // A missing printer means something different depending on how we got here. If the caller named
      // the printer, they named one that isn't there. If we resolved it from a target, the app did
      // nothing wrong — this installation's mapping went stale (printer uninstalled or renamed), and
      // the fix is to reassign the target, not to change the app.
      throw target ? new MappingInvalidError(target, name) : new PrinterNotFoundError(name);
    }
    assertPrinterStatusReady(printer.status, name, this.logger);
  }
}
