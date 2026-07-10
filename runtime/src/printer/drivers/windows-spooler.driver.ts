import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrintJobInput } from '@portixone/protocol';
import { EscposBuilder } from '@portixone/escpos';
import { PrinterConnectionError, PrinterConnectionLostError, PrinterNotFoundError, PrinterTimeoutError } from '@portixone/shared';
import type { PrinterDriver } from './printer-driver.types.js';

const execFileAsync = promisify(execFile);

const SCRIPT_PATH = fileURLToPath(new URL('../../../scripts/send-raw-print.ps1', import.meta.url));
/** Guards against winspool.drv / the spooler service hanging — execFile has no timeout by default. */
const SPOOLER_TIMEOUT_MS = 10000;

/**
 * Unlike the per-call temp file (deleted immediately after send), these are
 * kept on disk so a failed/questionable physical print can be replayed
 * outside PortixOne (send-raw-print.ps1 directly) to tell apart a bad ESC/POS
 * payload from a spooler/USB/hardware problem — the gap identified 2026-07-10
 * where the runtime reported "completed" but no paper came out. Capped to the
 * most recent 20 so this can't grow unbounded on a busy printer.
 */
const PRINT_BUFFER_DIR = join(process.cwd(), '.data', 'print-buffers');
const MAX_KEPT_BUFFERS = 20;

async function persistBufferForDiagnostics(printerName: string, buffer: Buffer): Promise<void> {
  await mkdir(PRINT_BUFFER_DIR, { recursive: true });
  const safeName = printerName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeName}.bin`;
  await writeFile(join(PRINT_BUFFER_DIR, fileName), buffer);

  const files = (await readdir(PRINT_BUFFER_DIR)).sort();
  const excess = files.length - MAX_KEPT_BUFFERS;
  if (excess > 0) {
    await Promise.all(files.slice(0, excess).map((file) => unlink(join(PRINT_BUFFER_DIR, file))));
  }
}

/** send-raw-print.ps1's own thrown messages for a call that started but failed partway through. */
const MID_OPERATION_FAILURES = ['StartDocPrinter failed', 'StartPagePrinter failed', 'WritePrinter failed', 'WritePrinter wrote'];

/**
 * Sends raw ESC/POS bytes to a USB thermal printer installed as a named
 * Windows printer, via winspool.drv (through a PowerShell P/Invoke helper —
 * see scripts/send-raw-print.ps1). No native Node addon / node-gyp needed.
 */
export class WindowsSpoolerPrinterDriver implements PrinterDriver {
  constructor(private readonly defaultPrinterName?: string) {}

  async print(job: PrintJobInput): Promise<void> {
    const printerName = job.printerName ?? this.defaultPrinterName;
    if (!printerName) {
      throw new PrinterNotFoundError();
    }

    const buffer = new EscposBuilder().text(job.content).feed(5).cut().build();
    const copies = job.copies ?? 1;

    // Best-effort — a diagnostics write failure (e.g. disk full) must never
    // block an actual print.
    await persistBufferForDiagnostics(printerName, buffer).catch(() => undefined);

    const dir = await mkdtemp(join(tmpdir(), 'portix-print-'));
    const dataFile = join(dir, 'job.bin');
    try {
      await writeFile(dataFile, buffer);
      for (let i = 0; i < copies; i += 1) {
        await this.sendToSpooler(printerName, dataFile);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async sendToSpooler(printerName: string, dataFile: string): Promise<void> {
    try {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, '-PrinterName', printerName, '-DataFile', dataFile],
        { timeout: SPOOLER_TIMEOUT_MS },
      );
    } catch (error) {
      const err = error as Error & { killed?: boolean; signal?: string | null };
      if (err.killed || err.signal) {
        throw new PrinterTimeoutError(printerName);
      }

      const message = err.message;
      if (message.includes('OpenPrinter failed')) {
        throw new PrinterNotFoundError(printerName);
      }
      if (MID_OPERATION_FAILURES.some((fragment) => message.includes(fragment))) {
        throw new PrinterConnectionLostError(printerName);
      }
      throw new PrinterConnectionError(message);
    }
  }
}
