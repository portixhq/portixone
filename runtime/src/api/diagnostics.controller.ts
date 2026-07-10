import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, release, type as osType, version as osVersion } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { APP_VERSION } from '@portixone/shared';
import type { ConfigService } from '../config/config.service.js';
import type { PrinterManager } from '../printer/printer.manager.js';

const execFileAsync = promisify(execFile);
const RUNTIME_LOG_PATH = join(process.cwd(), '.data', 'runtime.log');
const CRASH_LOG_PATH = join(process.cwd(), '.data', 'crash.log');

/**
 * Bundles everything a support conversation needs into one downloadable
 * `diagnostics.zip` — ROADMAP.md's "Export Diagnostics" (Fase 4/packaging).
 * Shells out to `Compress-Archive`, the same PowerShell-via-execFile pattern
 * already used for printer detection (windows.detector.ts) and installer
 * staging (build-staging.js) — no new zip dependency needed on a
 * Windows-only runtime.
 */
export async function handleDiagnostics(
  res: ServerResponse,
  configService: ConfigService,
  printerManager: PrinterManager,
): Promise<void> {
  const stagingDir = join(process.cwd(), '.data', `diagnostics-${randomUUID()}`);
  const zipPath = `${stagingDir}.zip`;

  try {
    mkdirSync(stagingDir, { recursive: true });

    if (existsSync(RUNTIME_LOG_PATH)) {
      writeFileSync(join(stagingDir, 'runtime.log'), readFileSync(RUNTIME_LOG_PATH));
    }
    if (existsSync(CRASH_LOG_PATH)) {
      writeFileSync(join(stagingDir, 'crash.log'), readFileSync(CRASH_LOG_PATH));
    }

    // apiKey redacted — this zip is meant to be handed to support, not to
    // leak the admin credential it's protected by.
    const config = configService.get();
    writeFileSync(join(stagingDir, 'config.json'), JSON.stringify({ ...config, apiKey: '[REDACTED]' }, null, 2));

    const printers = await printerManager.listPrinters().catch(() => []);
    writeFileSync(
      join(stagingDir, 'system-info.json'),
      JSON.stringify(
        {
          appVersion: APP_VERSION,
          hostname: hostname(),
          windows: { release: release(), version: osVersion(), type: osType() },
          printers,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path "${stagingDir}\\*" -DestinationPath "${zipPath}" -Force`,
    ]);

    const zipBuffer = readFileSync(zipPath);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="diagnostics.zip"',
    });
    res.end(zipBuffer);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(zipPath, { force: true });
  }
}
