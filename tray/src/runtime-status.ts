import { DEFAULT_RUNTIME_HOST, DEFAULT_RUNTIME_PORT } from '@portixone/shared';

export interface RuntimeHealth {
  online: boolean;
  version?: string;
  defaultPrinter?: string;
}

const baseUrl = `http://${DEFAULT_RUNTIME_HOST}:${DEFAULT_RUNTIME_PORT}`;

export async function checkRuntimeHealth(): Promise<RuntimeHealth> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      return { online: false };
    }
    const body = (await response.json()) as { version?: string; defaultPrinter?: string };
    return { online: true, version: body.version, defaultPrinter: body.defaultPrinter };
  } catch {
    return { online: false };
  }
}
