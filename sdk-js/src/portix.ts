import { ClientAdapter } from './client.adapter.js';
import { PortixEventBus } from './event-bus.js';
import { RuntimeSocket } from './runtime-socket.js';
import { renderMockReceipt } from './mock-preview.js';
import type {
  JobRecord,
  PairingRequestResult,
  PortixEvent,
  PortixEventHandler,
  PortixOptions,
  PrinterInfo,
  PrintOptions,
  PrintResult,
  RuntimeMetrics,
  RuntimeStatusResult,
} from './types.js';

const DEFAULT_LOCAL_API_KEY = 'dev-local-key';
const MOCK_VERSION = 'mock';
const PAIRING_POLL_INTERVAL_MS = 1500;

/**
 * The PortixOne SDK entry point.
 *
 * ```ts
 * const portix = new Portix();
 * await portix.connect();
 * await portix.print({ content: "Hello PortixOne!" });
 * ```
 *
 * Pass `{ mode: "mock" }` to try it with no runtime and no printer at all.
 */
export class Portix {
  private adapter?: ClientAdapter;
  private socket?: RuntimeSocket;
  private pairingTimer?: ReturnType<typeof setInterval>;
  private readonly events = new PortixEventBus();
  private readonly mode: 'runtime' | 'mock';

  constructor(private readonly options: PortixOptions = {}) {
    this.mode = options.mode ?? 'runtime';
  }

  async connect(): Promise<void> {
    if (this.mode === 'mock') {
      return;
    }
    const adapter = new ClientAdapter({
      apiKey: this.options.apiKey ?? DEFAULT_LOCAL_API_KEY,
      host: this.options.host,
      port: this.options.port,
    });
    await adapter.getStatus();
    this.adapter = adapter;
  }

  /** Ends this SDK session: stops any pairing poll, closes the live-events socket, and drops the connection. */
  async disconnect(): Promise<void> {
    this.stopPairingPoll();
    this.socket?.close();
    this.socket = undefined;
    this.adapter = undefined;
  }

  async print(job: PrintOptions): Promise<PrintResult> {
    if (this.mode === 'mock') {
      return this.mockPrint(job);
    }
    return this.requireAdapter().print(job);
  }

  async getStatus(): Promise<RuntimeStatusResult> {
    if (this.mode === 'mock') {
      return { status: 'online', version: MOCK_VERSION };
    }
    return this.requireAdapter().getStatus();
  }

  /** A lightweight liveness check, distinct from getStatus()'s fuller health payload. */
  async ping(): Promise<{ pong: boolean }> {
    if (this.mode === 'mock') {
      return { pong: true };
    }
    return this.requireAdapter().ping();
  }

  async listPrinters(): Promise<PrinterInfo[]> {
    if (this.mode === 'mock') {
      return [];
    }
    return this.requireAdapter().listPrinters();
  }

  async getPrinter(name: string): Promise<PrinterInfo> {
    return this.requireAdapter().getPrinter(name);
  }

  async getJobs(): Promise<JobRecord[]> {
    if (this.mode === 'mock') {
      return [];
    }
    return this.requireAdapter().getJobs();
  }

  async cancel(jobId: string): Promise<PrintResult> {
    return this.requireAdapter().cancel(jobId);
  }

  /** Milestone 4's measurement layer — job counts/durations, pairing duration, WebSocket disconnect count. */
  async getMetrics(): Promise<RuntimeMetrics> {
    if (this.mode === 'mock') {
      return {
        uptimeMs: 0,
        jobs: { total: 0, byStatus: { pending: 0, printing: 0, completed: 0, failed: 0, cancelled: 0 } },
        pairing: { totalApproved: 0 },
        websocket: { activeConnections: 0, totalDisconnects: 0 },
      };
    }
    return this.requireAdapter().getMetrics();
  }

  /**
   * Requests pairing for this `{ tenant, appId }` and returns the short code
   * to show a human — approval happens locally on the runtime (today via its
   * admin key hitting `/pairing/approve`; a tray UI for this is tracked
   * separately). Once approved, the SDK swaps in a token scoped to this
   * tenant/app and fires a `'paired'` event — no repeated authorization
   * after that.
   */
  async pair(): Promise<PairingRequestResult> {
    if (this.mode === 'mock') {
      throw new Error('pair() needs a real runtime — mock mode has nothing to pair with');
    }
    if (!this.options.tenant || !this.options.appId) {
      throw new Error('pair() requires both `tenant` and `appId` in the Portix constructor options');
    }

    const adapter = this.requireAdapter();
    const result = await adapter.requestPairing(this.options.tenant, this.options.appId);
    this.startPairingPoll(adapter, result.code, new Date(result.expiresAt).getTime());
    return result;
  }

  /** Subscribes to runtime job events (`job:queued`, `job:printing`, ...) or the SDK-local `'paired'` event. */
  on(event: PortixEvent, handler: PortixEventHandler): () => void {
    if (this.mode !== 'mock' && !this.socket) {
      this.socket = new RuntimeSocket(this.options.host, this.options.port, this.events);
    }
    return this.events.on(event, handler);
  }

  private startPairingPoll(adapter: ClientAdapter, code: string, expiresAtMs: number): void {
    this.stopPairingPoll();
    this.pairingTimer = setInterval(() => {
      void this.pollPairingOnce(adapter, code, expiresAtMs);
    }, PAIRING_POLL_INTERVAL_MS);
  }

  private async pollPairingOnce(adapter: ClientAdapter, code: string, expiresAtMs: number): Promise<void> {
    if (Date.now() > expiresAtMs) {
      this.stopPairingPoll();
      return;
    }

    const status = await adapter.getPairingStatus(code).catch(() => undefined);
    if (status?.status === 'approved' && status.token) {
      this.stopPairingPoll();
      adapter.setCredential(status.token);
      this.events.emit('paired', { deviceId: status.deviceId, permissions: status.permissions });
    }
  }

  private stopPairingPoll(): void {
    if (this.pairingTimer) {
      clearInterval(this.pairingTimer);
      this.pairingTimer = undefined;
    }
  }

  private mockPrint(job: PrintOptions): PrintResult {
    const preview = renderMockReceipt(job);
    console.log(preview);
    return {
      jobId: crypto.randomUUID(),
      status: 'completed',
      message: 'mock mode — no runtime or printer involved',
      preview,
    };
  }

  private requireAdapter(): ClientAdapter {
    if (!this.adapter) {
      throw new Error('Call portix.connect() before using the client — no active connection to the PortixOne runtime.');
    }
    return this.adapter;
  }
}
