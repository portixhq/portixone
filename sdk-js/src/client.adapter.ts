import { API_KEY_HEADER } from '@portixone/protocol';
import { DEFAULT_RUNTIME_HOST, DEFAULT_RUNTIME_PORT } from '@portixone/shared';
import type {
  JobRecord,
  PairingRequestResult,
  PairingStatusResult,
  PortixClientOptions,
  PrinterInfo,
  PrinterTargetsView,
  PrintOptions,
  PrintResult,
  PrintTarget,
  RuntimeMetrics,
  RuntimeStatusResult,
} from './types.js';

interface RequestOptions {
  body?: unknown;
  /** Pairing endpoints are called before an app has any credential — skip the header for those. */
  authenticated?: boolean;
}

/**
 * Thrown when `fetch()` itself never got a response — as opposed to a
 * response we didn't like (handled separately below). Distinct from a
 * generic `Error` so callers (see `Portix.connect()`) can reliably tell
 * "nothing is listening at this host:port" apart from every other failure
 * mode, instead of guessing from a message string.
 */
export class RuntimeUnreachableError extends Error {
  constructor(baseUrl: string) {
    super(`Could not reach the Portix Runtime at ${baseUrl} — it's probably not installed or not running.`);
    this.name = 'RuntimeUnreachableError';
  }
}

export class ClientAdapter {
  private readonly baseUrl: string;
  private apiKey: string;

  constructor(options: PortixClientOptions) {
    const host = options.host ?? DEFAULT_RUNTIME_HOST;
    const port = options.port ?? DEFAULT_RUNTIME_PORT;
    this.baseUrl = `http://${host}:${port}`;
    this.apiKey = options.apiKey;
  }

  /** Swaps in a per-pairing scoped token once `pair()` is approved, replacing the shared admin key. */
  setCredential(token: string): void {
    this.apiKey = token;
  }

  /** The currently-active credential — used by RuntimeSocket to authenticate its WebSocket handshake with the exact same key this adapter's HTTP calls already use. */
  getCredential(): string {
    return this.apiKey;
  }

  async print(job: PrintOptions): Promise<PrintResult> {
    return this.requestJson<PrintResult>('POST', '/print', { body: job });
  }

  async getStatus(): Promise<RuntimeStatusResult> {
    return this.requestJson<RuntimeStatusResult>('GET', '/health', { authenticated: false });
  }

  async ping(): Promise<{ pong: boolean }> {
    return this.requestJson('GET', '/ping', { authenticated: false });
  }

  async listPrinters(): Promise<PrinterInfo[]> {
    return this.requestJson('GET', '/printers');
  }

  /** This app's own target configuration on this machine — how it knows whether setup is still needed. */
  async getPrinterTargets(): Promise<PrinterTargetsView> {
    return this.requestJson('GET', '/printer-targets');
  }

  async assignPrinterTarget(appId: string, target: PrintTarget, printerName: string): Promise<unknown> {
    return this.requestJson('PUT', `/printer-targets/${encodeURIComponent(appId)}/${encodeURIComponent(target)}`, {
      body: { printerName },
    });
  }

  async testPrinterTarget(appId: string, target: PrintTarget): Promise<PrintResult> {
    return this.requestJson('POST', `/printer-targets/${encodeURIComponent(appId)}/${encodeURIComponent(target)}/test`);
  }

  async confirmPrinterTarget(appId: string, target: PrintTarget): Promise<unknown> {
    return this.requestJson(
      'POST',
      `/printer-targets/${encodeURIComponent(appId)}/${encodeURIComponent(target)}/confirm`,
    );
  }

  async getPrinter(name: string): Promise<PrinterInfo> {
    return this.requestJson('GET', `/printers/${encodeURIComponent(name)}`);
  }

  async getJobs(): Promise<JobRecord[]> {
    return this.requestJson('GET', '/jobs');
  }

  async cancel(jobId: string): Promise<PrintResult> {
    return this.requestJson('POST', `/jobs/${encodeURIComponent(jobId)}/cancel`);
  }

  async requestPairing(tenant: string, appId: string): Promise<PairingRequestResult> {
    return this.requestJson('POST', '/pairing/request', { body: { tenant, appId }, authenticated: false });
  }

  async getPairingStatus(code: string): Promise<PairingStatusResult> {
    return this.requestJson('GET', `/pairing/status?code=${encodeURIComponent(code)}`, { authenticated: false });
  }

  async getMetrics(): Promise<RuntimeMetrics> {
    return this.requestJson('GET', '/metrics');
  }

  private async requestJson<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const { body, authenticated = true } = options;
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (authenticated) {
      headers[API_KEY_HEADER] = this.apiKey;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new RuntimeUnreachableError(this.baseUrl);
    }

    // A runtime error is always JSON, but a wrong host/port can just as
    // easily hit a captive portal, a reverse proxy, or nothing at all —
    // any of which return HTML or an empty body. Parse defensively so that
    // case fails with a clear message instead of a raw JSON.parse error.
    const rawBody = await response.text();
    let parsedBody: unknown;
    try {
      parsedBody = rawBody.length > 0 ? JSON.parse(rawBody) : undefined;
    } catch {
      parsedBody = undefined;
    }

    if (!response.ok) {
      const message = (parsedBody as { message?: string } | undefined)?.message;
      throw new Error(message ?? `PortixOne request failed (${response.status} ${response.statusText})`);
    }
    if (parsedBody === undefined) {
      throw new Error(
        `PortixOne runtime returned a non-JSON response (${response.status} ${response.statusText}) — is a Portix Runtime actually listening at ${this.baseUrl}?`,
      );
    }
    return parsedBody as T;
  }
}
