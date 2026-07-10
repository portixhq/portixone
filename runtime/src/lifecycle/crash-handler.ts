import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CRASH_LOG_PATH = join(process.cwd(), '.data', 'crash.log');

function writeCrashEntry(kind: string, error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const line = `[${new Date().toISOString()}] ${kind}: ${detail}`;
  console.error(line);
  try {
    mkdirSync(dirname(CRASH_LOG_PATH), { recursive: true });
    appendFileSync(CRASH_LOG_PATH, `${line}\n`, 'utf-8');
  } catch {
    // Nothing left to do if even the crash log can't be written — the
    // console.error above and the exit below still happen regardless.
  }
}

/**
 * Registered before bootstrap() runs so a crash during startup itself is
 * captured too, not just once services exist. Exits with a non-zero code on
 * purpose: node-windows' wrapper (runtime/scripts/service.install.js) and the
 * Windows Service Control Manager's own recovery actions both only restart
 * the process on an abnormal exit — swallowing the error and limping on
 * would silently disable that recovery instead of triggering it.
 */
export function registerCrashHandlers(): void {
  process.on('uncaughtException', (error) => {
    writeCrashEntry('uncaughtException', error);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    writeCrashEntry('unhandledRejection', reason);
    process.exit(1);
  });
}
