import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_RUNTIME_HOST, DEFAULT_RUNTIME_PORT } from '@portixone/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Tray and runtime are installed as sibling folders on the same machine —
// same pattern already used for daemonLogDir in index.ts, no IPC needed.
// Exported so the tray's "Settings" menu item can reveal this exact file
// without a second, independently-maintained path computation.
export const CONFIG_PATH = join(__dirname, '..', '..', 'runtime', '.data', 'config.json');

export interface RuntimeConnection {
  apiKey: string;
  host: string;
  port: number;
}

/**
 * Reads the runtime's own persisted config directly off disk to get its
 * admin API key — needed for the tray's admin-only features (printer list,
 * pairing approval). Returns undefined if the runtime hasn't booted yet (no
 * config.json written); those features just stay unavailable until it has.
 */
export function readRuntimeConnection(): RuntimeConnection | undefined {
  if (!existsSync(CONFIG_PATH)) {
    return undefined;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as { apiKey?: string; host?: string; port?: number };
    if (!config.apiKey) {
      return undefined;
    }
    return {
      apiKey: config.apiKey,
      host: config.host ?? DEFAULT_RUNTIME_HOST,
      port: config.port ?? DEFAULT_RUNTIME_PORT,
    };
  } catch {
    return undefined;
  }
}
