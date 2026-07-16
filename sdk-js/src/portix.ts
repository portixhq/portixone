import { ClientAdapter, RuntimeUnreachableError } from './client.adapter.js';
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
  PrinterTargetsView,
  PrintOptions,
  PrintResult,
  PrintTarget,
  RuntimeMetrics,
  RuntimeStatusResult,
} from './types.js';

const DEFAULT_LOCAL_API_KEY = 'dev-local-key';
const MOCK_VERSION = 'mock';
const PAIRING_POLL_INTERVAL_MS = 1500;
const TOKEN_STORAGE_PREFIX = 'portix:token:';
const DOWNLOAD_URL = 'https://portix.one/download';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenStorageKey(tenant: string, appId: string): string {
  return `${TOKEN_STORAGE_PREFIX}${tenant}:${appId}`;
}

// Node has no localStorage — `typeof` never throws on an undeclared global,
// so this degrades to "never persisted" there instead of a ReferenceError.
// A CLI script re-pairing on every run is an acceptable gap for now; a page
// reload doing that would not be.
function loadPersistedToken(tenant: string, appId: string): string | undefined {
  if (typeof localStorage === 'undefined') {
    return undefined;
  }
  return localStorage.getItem(tokenStorageKey(tenant, appId)) ?? undefined;
}

function persistToken(tenant: string, appId: string, token: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(tokenStorageKey(tenant, appId), token);
}

/**
 * The PortixOne SDK entry point.
 *
 * ```ts
 * const portix = new Portix({ appId: "my-app", tenant: "default" });
 * await portix.connect(); // pairs automatically the first time — see connect()
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

  /**
   * Verifies the runtime is reachable and, if this app isn't authorized yet,
   * pairs automatically — no separate `.pair()` call needed for the common
   * case. Requires `tenant`/`appId` in the constructor so the pairing
   * request can identify who's asking; skipped entirely if you passed an
   * explicit `apiKey` (that's a deliberate credential, not something to
   * silently replace). A previously-approved pairing is remembered (browser
   * `localStorage` only, see `loadPersistedToken`) so this only blocks on a
   * human once per app/tenant, not on every `connect()`.
   */
  async connect(): Promise<void> {
    if (this.mode === 'mock') {
      return;
    }
    const { tenant, appId } = this.options;
    const persistedToken = tenant && appId ? loadPersistedToken(tenant, appId) : undefined;
    const adapter = new ClientAdapter({
      apiKey: this.options.apiKey ?? persistedToken ?? DEFAULT_LOCAL_API_KEY,
      host: this.options.host,
      port: this.options.port,
    });
    try {
      await adapter.getStatus();
    } catch (error) {
      if (error instanceof RuntimeUnreachableError) {
        // Best-effort: browsers only let `window.open()` bypass the popup
        // blocker when it's a direct result of a user gesture (e.g. this
        // `connect()` call happening inside a button's click handler) —
        // silently does nothing otherwise, which is why the download URL is
        // always in the thrown message too, not just this side effect.
        if (typeof window !== 'undefined') {
          window.open(DOWNLOAD_URL, '_blank');
        }
        // Enrich in place rather than wrapping in a plain Error, so a caller
        // doing `instanceof RuntimeUnreachableError` still works.
        error.message = `${error.message} Download it from ${DOWNLOAD_URL} and try again.`;
        throw error;
      }
      throw error;
    }
    this.adapter = adapter;

    if (this.options.apiKey) {
      return;
    }
    if (await this.isAuthorized(adapter)) {
      return;
    }
    if (!tenant || !appId) {
      throw new Error(
        'portix.connect() reached the Runtime but has no valid credential — pass { tenant, appId } to `new Portix(...)` so it can pair automatically, or pass { apiKey } if you already have one.',
      );
    }
    await this.autoPair(adapter, tenant, appId);
  }

  /** A cheap authenticated call, used only to answer "does our current credential actually work?" */
  private async isAuthorized(adapter: ClientAdapter): Promise<boolean> {
    try {
      await adapter.listPrinters();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Requests pairing and blocks until it's approved — instantly for a
   * localhost origin (the runtime auto-trusts only that, not LAN/private-IP
   * origins — see pairing.service.ts's isTrustedOrigin), or until a human
   * approves it from the PortixOne tray's Pairing Requests menu otherwise.
   * Distinct from the public `pair()` below, which returns the code
   * immediately for callers (like a multi-tenant SaaS) that want to show it
   * to a human themselves instead of waiting here.
   */
  private async autoPair(adapter: ClientAdapter, tenant: string, appId: string): Promise<void> {
    const result = await adapter.requestPairing(tenant, appId);
    const expiresAtMs = new Date(result.expiresAt).getTime();
    while (Date.now() < expiresAtMs) {
      await sleep(PAIRING_POLL_INTERVAL_MS);
      const status = await adapter.getPairingStatus(result.code).catch(() => undefined);
      if (status?.status === 'approved' && status.token) {
        adapter.setCredential(status.token);
        persistToken(tenant, appId, status.token);
        this.events.emit('paired', { deviceId: status.deviceId, permissions: status.permissions });
        return;
      }
    }
    throw new Error(
      `Pairing request for "${appId}" expired waiting for approval — open the PortixOne tray's "Pairing Requests" menu and approve it, then call connect() again.`,
    );
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
      return { status: 'online', version: MOCK_VERSION, simulated: true };
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

  /**
   * This app's logical print targets on this machine, and what they resolve to.
   *
   * The names in here (`EPSON TM-T20III`, …) are this one installation's business — read them to
   * build a setup screen, not to hardcode into `print()`. Print with `{ target: 'receipt' }` and the
   * Runtime resolves it per machine, which is what lets one integration serve every customer.
   */
  async getPrinterTargets(): Promise<PrinterTargetsView> {
    if (this.mode === 'mock') {
      return { appId: this.options.appId ?? 'mock', origin: '*', targets: {} };
    }
    return this.requireAdapter().getPrinterTargets();
  }

  /** Binds a logical target to a physical printer on this machine. The setup screen's "assign" step. */
  async assignPrinterTarget(target: PrintTarget, printerName: string): Promise<void> {
    const appId = this.requireAppId('assignPrinterTarget');
    await this.requireAdapter().assignPrinterTarget(appId, target, printerName);
  }

  /** Prints a test ticket through a target, so a human can confirm paper came out of the right device. */
  async testPrinterTarget(target: PrintTarget): Promise<PrintResult> {
    const appId = this.requireAppId('testPrinterTarget');
    return this.requireAdapter().testPrinterTarget(appId, target);
  }

  /** Records that a human confirmed the test ticket — the difference between "assigned" and "verified". */
  async confirmPrinterTarget(target: PrintTarget): Promise<void> {
    const appId = this.requireAppId('confirmPrinterTarget');
    await this.requireAdapter().confirmPrinterTarget(appId, target);
  }

  private requireAppId(method: string): string {
    if (!this.options.appId) {
      throw new Error(`${method}() needs an \`appId\` — targets are configured per application.`);
    }
    return this.options.appId;
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
      const adapter = this.requireAdapter();
      this.socket = new RuntimeSocket(this.options.host, this.options.port, adapter.getCredential(), this.events);
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
      if (this.options.tenant && this.options.appId) {
        persistToken(this.options.tenant, this.options.appId, status.token);
      }
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
