import { PROTOCOL_VERSION } from '@portixone/protocol';
import { ClientAdapter, RuntimeUnreachableError } from './client.adapter.js';
import { buildConnectionState, isProtocolCompatible } from './connection-state.js';
import { PortixSetup } from './setup.js';
import { PortixEventBus } from './event-bus.js';
import { RuntimeSocket } from './runtime-socket.js';
import { renderMockReceipt } from './mock-preview.js';
import type {
  ConnectionState,
  ConnectOptions,
  JobRecord,
  PairingPhase,
  PairingRequestResult,
  PortixEvent,
  PortixEventHandler,
  PortixOptions,
  PrinterInfo,
  PrinterTargetsView,
  PrintOptions,
  PrintResult,
  PrintTarget,
  RuntimeCapabilities,
  RuntimeMetrics,
  RuntimeStatusResult,
  TargetReadiness,
} from './types.js';

const DEFAULT_LOCAL_API_KEY = 'dev-local-key';
const MOCK_VERSION = 'mock';
const PAIRING_POLL_INTERVAL_MS = 1500;
/**
 * How long `connect()` waits for an approval before reporting `pairing_pending`.
 *
 * Sized for the loopback auto-approval, which lands before the first poll — not for a human, who
 * may take minutes or never arrive. Waiting on a person here is what made `pairing_pending`
 * impossible to represent: the promise just never settled.
 */
const PAIRING_WAIT_MS = 2500;
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
  private capabilities?: RuntimeCapabilities;
  private runtimeVersion?: string;

  constructor(private readonly options: PortixOptions = {}) {
    this.mode = options.mode ?? 'runtime';
  }

  /**
   * Establishes a connection and REPORTS WHAT HAPPENED, rather than throwing and leaving the caller
   * to interpret an exception.
   *
   * ── Behaviour change in this version, deliberate ──────────────────────────────────────────────
   * This used to reject when the Runtime was missing, when there was no usable credential, or when
   * a pairing wasn't approved in time — so an application had to catch technical errors and guess
   * which screen to show. Those are all normal operating conditions and are now returned as state:
   * `runtime_unreachable`, `pairing_required`, `pairing_pending`, `target_not_configured`, `ready`.
   * Exceptions are kept for what is genuinely unexpected (a corrupt response, a broken protocol).
   *
   * It also no longer blocks for minutes waiting for a human to click Approve. That made
   * `pairing_pending` unrepresentable: the promise simply didn't settle. It now waits only long
   * enough for the loopback auto-approval to land, then hands back `pairing_pending` so the
   * application can render "approve this in the tray" and re-check when it wants.
   *
   * And it no longer opens the download page by itself. The application knows the state now and
   * decides — a library that opens tabs during a status check is a surprise, not a feature.
   */
  async connect(options: ConnectOptions = {}): Promise<ConnectionState> {
    if (this.mode === 'mock') {
      return buildConnectionState({
        runtime: 'connected',
        pairing: 'not_required',
        targets: options.expectTarget ? { [options.expectTarget]: 'configured' } : {},
        runtimeVersion: MOCK_VERSION,
        detail: 'Mock mode — no Runtime and no printer involved.',
      });
    }

    const { tenant, appId } = this.options;
    const persistedToken = tenant && appId ? loadPersistedToken(tenant, appId) : undefined;
    const adapter = new ClientAdapter({
      apiKey: this.options.apiKey ?? persistedToken ?? DEFAULT_LOCAL_API_KEY,
      host: this.options.host,
      port: this.options.port,
      timeoutMs: options.timeoutMs,
    });

    let health: RuntimeStatusResult;
    try {
      health = await adapter.getStatus();
    } catch (error) {
      if (error instanceof RuntimeUnreachableError) {
        // Cannot tell "not installed" from "installed but stopped" — a failed fetch is a failed
        // fetch. Say only what is true and let the application offer both paths.
        return buildConnectionState({
          runtime: 'unreachable',
          pairing: 'required',
          detail: `No Runtime answered at ${this.options.host ?? '127.0.0.1'}:${this.options.port ?? 17321}. It may not be installed, or not running. ${DOWNLOAD_URL}`,
        });
      }
      throw error; // genuinely unexpected — not an operating condition
    }

    this.capabilities = health.capabilities;
    this.runtimeVersion = health.runtimeVersion ?? health.version;
    if (!isProtocolCompatible(health.protocolVersion)) {
      return buildConnectionState({
        runtime: 'incompatible',
        pairing: 'required',
        runtimeVersion: this.runtimeVersion,
        protocolVersion: health.protocolVersion,
        detail: `This Runtime speaks protocol ${health.protocolVersion}; this SDK speaks ${PROTOCOL_VERSION}. Update whichever is older.`,
      });
    }

    const pairing = await this.establishPairing(adapter, options);
    if (pairing !== 'approved' && pairing !== 'not_required') {
      return buildConnectionState({
        runtime: 'connected',
        pairing,
        runtimeVersion: this.runtimeVersion,
        protocolVersion: health.protocolVersion,
        detail:
          pairing === 'pending'
            ? 'Waiting for someone to approve this application in the Portix tray.'
            : pairing === 'required'
              ? 'No usable credential. Pass { tenant, appId } so this can pair, or { apiKey } if you already have one.'
              : 'The pairing request was not approved.',
      });
    }

    this.adapter = adapter;
    return buildConnectionState({
      runtime: 'connected',
      pairing,
      targets: await this.readTargets(adapter),
      expectedTarget: options.expectTarget,
      runtimeVersion: this.runtimeVersion,
      protocolVersion: health.protocolVersion,
    });
  }

  /** Resolves how this app is authorized, without ever blocking on a human for more than a moment. */
  private async establishPairing(adapter: ClientAdapter, options: ConnectOptions): Promise<PairingPhase> {
    const { tenant, appId } = this.options;
    if (this.options.apiKey) {
      return 'not_required'; // a deliberate credential — never silently replaced
    }
    if (await this.isAuthorized(adapter)) {
      return 'approved'; // a remembered pairing still works
    }
    if (!tenant || !appId) {
      return 'required';
    }
    return this.requestPairing(adapter, tenant, appId, options.pairingWaitMs ?? PAIRING_WAIT_MS);
  }

  /**
   * Requests pairing and waits only briefly. A loopback origin auto-approves before the first poll,
   * so this settles instantly in development; a public origin needs a human, and that is reported
   * rather than waited on.
   */
  private async requestPairing(
    adapter: ClientAdapter,
    tenant: string,
    appId: string,
    waitMs: number,
  ): Promise<PairingPhase> {
    const result = await adapter.requestPairing(tenant, appId);
    const deadline = Date.now() + waitMs;
    do {
      const status = await adapter.getPairingStatus(result.code).catch(() => undefined);
      if (status?.status === 'approved' && status.token) {
        adapter.setCredential(status.token);
        persistToken(tenant, appId, status.token);
        this.events.emit('paired', { deviceId: status.deviceId, permissions: status.permissions });
        return 'approved';
      }
      if (status?.status === 'expired') {
        return 'expired';
      }
      if (Date.now() >= deadline) {
        break;
      }
      await sleep(Math.min(PAIRING_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    } while (Date.now() < deadline);
    return 'pending';
  }

  /** Reads this app's own target configuration. Undefined means "could not read", never "none". */
  private async readTargets(adapter: ClientAdapter): Promise<Partial<Record<PrintTarget, TargetReadiness>> | undefined> {
    try {
      const view = await adapter.getPrinterTargets();
      const targets: Partial<Record<PrintTarget, TargetReadiness>> = {};
      for (const [target, mapping] of Object.entries(view.targets ?? {})) {
        // A mapping whose printer vanished is configured on paper but cannot print — reporting it as
        // configured would send the app straight into a failing job.
        targets[target as PrintTarget] = mapping?.invalidReason ? 'not_configured' : 'configured';
      }
      return targets;
    } catch {
      return undefined;
    }
  }

  /** Re-probes and returns the current connection state. Same contract as `connect()`. */
  async getConnectionState(options: ConnectOptions = {}): Promise<ConnectionState> {
    return this.connect(options);
  }

  /** True only when everything needed to print is in place. */
  async isReady(options: ConnectOptions = {}): Promise<boolean> {
    return (await this.connect(options)).status === 'ready';
  }

  /** What this Runtime supports — populated by `connect()`. Undefined until then, or on an older Runtime. */
  getCapabilities(): RuntimeCapabilities | undefined {
    return this.capabilities;
  }

  /**
   * The embeddable printer-setup flow for a logical target.
   *
   * Returns a headless state machine so an application can build "Configure printer" in its own
   * settings screen — detect, pair, choose a printer, print a test, confirm — without writing any of
   * that logic itself. The application renders `setup.getState()` and calls its actions; the SDK owns
   * the sequence. See PortixSetup.
   */
  createSetup(options: { target: PrintTarget }): PortixSetup {
    // Required up front, so the failure is "setup needs an appId" here rather than a confusing error
    // three actions deep when the first target write happens.
    this.requireAppId('createSetup');

    // Read and write MUST use the same scope, or setup lies: it would write a mapping the caller's
    // own prints never resolve. The runtime scopes a target by the CALLER'S identity, which is the
    // pairing's appId for a paired app but the admin appId for an apiKey caller — not necessarily
    // options.appId. So discover the scope appId from the own-scope read and configure THAT, which
    // is exactly the identity this client prints as.
    let scopeAppId = this.options.appId!;
    return new PortixSetup({
      target: options.target,
      downloadUrl: DOWNLOAD_URL,
      connect: () => this.connect({ expectTarget: options.target }),
      listPrinters: () => this.listPrinters(),
      getTargetMapping: async (target) => {
        const view = await this.getPrinterTargets();
        scopeAppId = view.appId;
        return view.targets[target];
      },
      assignPrinter: async (target, printerName) => {
        await this.requireAdapter().assignPrinterTarget(scopeAppId, target, printerName);
      },
      sendTest: async (target) => {
        await this.requireAdapter().testPrinterTarget(scopeAppId, target);
      },
      confirmVerified: async (target) => {
        await this.requireAdapter().confirmPrinterTarget(scopeAppId, target);
      },
    });
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
      return {
        status: 'online',
        version: MOCK_VERSION,
        runtimeVersion: MOCK_VERSION,
        protocolVersion: MOCK_VERSION,
        simulated: true,
      };
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
