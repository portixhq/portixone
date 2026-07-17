import type {
  ConnectionState,
  PrinterInfo,
  PrinterTargetMapping,
  PrintTarget,
} from './types.js';

/**
 * The embeddable printer-setup flow.
 *
 * The point: a developer building "Configure printer" in their own settings screen should not have
 * to write connection, pairing, printer selection, or test-print logic. `createSetup()` gives them a
 * headless state machine — the SDK owns the sequence, the application owns the pixels. This is the
 * step that turns Portix from "a runtime you talk to" into "infrastructure you embed".
 *
 * Headless on purpose: every product's settings UI is different, and a fixed component would fight
 * the host's design. The machine exposes a `state` to render and actions to call; a reference
 * wizard lives in the examples, not in here.
 */

/** The step an application renders. A discriminated switch, not a string to parse. */
export type SetupStep =
  | 'detecting' //            probing the Runtime for the first time
  | 'runtime_unreachable' //  nothing answered — offer install/start, then retry
  | 'runtime_incompatible' // answered, but a protocol major this SDK doesn't speak
  | 'pairing_required' //     reachable, but this app has no credential yet
  | 'pairing_pending' //      requested; waiting for a human to approve it in the tray
  | 'pairing_denied' //       the request was denied or expired
  | 'selecting_printer' //    authorized; choose which printer this target maps to
  | 'testing' //              a test ticket was sent; waiting for a human to confirm it printed
  | 'ready' //                the target is configured and confirmed
  | 'cancelled'; //           the caller abandoned the flow

export interface SetupState {
  step: SetupStep;
  target: PrintTarget;
  /** Printers to choose from — populated in `selecting_printer`. */
  printers: PrinterInfo[];
  /** The printer currently assigned to the target, or under test. */
  printerName?: string;
  /** When a previous mapping went stale (its printer was removed), the name that is now missing. */
  missingPrinterName?: string;
  /** A sentence for the current step. Render it; never parse it. */
  detail: string;
  /** Where to get the Runtime — present only when it is unreachable. */
  downloadUrl?: string;
  runtimeVersion?: string;
}

export type SetupEvent =
  | 'setup_started'
  | 'runtime_missing'
  | 'pairing_requested'
  | 'pairing_approved'
  | 'printer_selected'
  | 'test_print_sent'
  | 'test_print_confirmed'
  | 'setup_completed'
  | 'setup_abandoned';

export type SetupEventHandler = (state: SetupState) => void;

/**
 * Derives the step from what was observed — the connection state and this target's current mapping.
 * Pure, so the whole flow is verifiable without a Runtime, a printer, or a human: the exit criterion
 * is "a correct screen for every state", and that is only checkable if every state is reachable in a
 * test.
 *
 * The precedence reads top to bottom: you can't pair with a Runtime you can't reach, and you can't
 * judge a printer before you're allowed to configure one.
 */
export function deriveSetupStep(
  connection: Pick<ConnectionState, 'runtime' | 'pairing'>,
  mapping: PrinterTargetMapping | undefined,
): SetupStep {
  if (connection.runtime === 'unreachable') {
    return 'runtime_unreachable';
  }
  if (connection.runtime === 'incompatible') {
    return 'runtime_incompatible';
  }
  switch (connection.pairing) {
    case 'required':
      return 'pairing_required';
    case 'pending':
      return 'pairing_pending';
    case 'denied':
    case 'expired':
      return 'pairing_denied';
    default:
      break;
  }
  // Authorized from here on.
  if (!mapping || mapping.invalidReason) {
    // No mapping, or one whose printer vanished — either way a printer must be (re)chosen. A stale
    // mapping is treated as needing selection, not as configured, because it cannot actually print.
    return 'selecting_printer';
  }
  // Assigned but nobody has confirmed a real ticket came out yet — that is what `testing` is for.
  return mapping.verified ? 'ready' : 'testing';
}

/** The subset of the Portix client that setup drives — narrowed so the flow is unit-testable with a fake. */
export interface SetupDriver {
  target: PrintTarget;
  connect(): Promise<ConnectionState>;
  listPrinters(): Promise<PrinterInfo[]>;
  /** The current mapping for this setup's target on this machine, or undefined if none. */
  getTargetMapping(target: PrintTarget): Promise<PrinterTargetMapping | undefined>;
  assignPrinter(target: PrintTarget, printerName: string): Promise<void>;
  sendTest(target: PrintTarget): Promise<void>;
  confirmVerified(target: PrintTarget): Promise<void>;
  downloadUrl: string;
}

const STEP_DETAIL: Record<SetupStep, string> = {
  detecting: 'Checking whether the Portix Runtime is available…',
  runtime_unreachable: 'The Portix Runtime is not responding. Install it, or start it if it is already installed, then try again.',
  runtime_incompatible: 'The installed Runtime is too old for this application. Update the Runtime.',
  pairing_required: 'Allow this application to print on this machine to continue.',
  pairing_pending: 'Waiting for approval — open the Portix tray and approve this application.',
  pairing_denied: 'The request was not approved. Try again to send a new one.',
  selecting_printer: 'Choose which printer this destination should use.',
  testing: 'A test ticket was sent. Confirm whether it actually printed.',
  ready: 'Printing is configured and confirmed.',
  cancelled: 'Setup was cancelled.',
};

/**
 * Orchestrates the printer-setup flow for one logical target.
 *
 * Resumable by construction: the mapping lives on the Runtime (with its verified flag), so calling
 * `refresh()` after a page reload re-derives exactly the right step — no local progress to persist
 * and go stale. The only in-memory state is the printer list to render and which step we're on.
 */
export class PortixSetup {
  private readonly handlers = new Map<SetupEvent, Set<SetupEventHandler>>();
  private state: SetupState;
  private started = false;

  constructor(private readonly driver: SetupDriver) {
    this.state = {
      step: 'detecting',
      target: driver.target,
      printers: [],
      detail: STEP_DETAIL.detecting,
    };
  }

  getState(): SetupState {
    return this.state;
  }

  on(event: SetupEvent, handler: SetupEventHandler): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  private emit(event: SetupEvent): void {
    this.handlers.get(event)?.forEach((h) => h(this.state));
  }

  /**
   * Probe the Runtime and settle on a step. Safe to call as often as the UI wants — it is how a
   * "pending" screen advances when a human finally approves, and how the flow resumes after a reload.
   */
  async refresh(): Promise<SetupState> {
    if (!this.started) {
      this.started = true;
      this.emit('setup_started');
    }
    const previous = this.state.step;
    const connection = await this.driver.connect();

    // Only ask about a mapping once we are actually allowed to configure one.
    let mapping: PrinterTargetMapping | undefined;
    let printers: PrinterInfo[] = this.state.printers;
    const authorized = connection.runtime === 'connected' && (connection.pairing === 'approved' || connection.pairing === 'not_required');
    if (authorized) {
      mapping = await this.driver.getTargetMapping(this.driver.target).catch(() => undefined);
    }

    const step = deriveSetupStep(connection, mapping);
    if (step === 'selecting_printer') {
      // The printer list is only meaningful here; fetch it so the UI has something to render.
      printers = await this.driver.listPrinters().catch(() => []);
    }

    this.state = {
      step,
      target: this.driver.target,
      printers,
      printerName: mapping?.printerName,
      missingPrinterName: mapping?.invalidReason ? mapping.printerName : undefined,
      detail: STEP_DETAIL[step],
      downloadUrl: step === 'runtime_unreachable' ? this.driver.downloadUrl : undefined,
      runtimeVersion: connection.runtimeVersion,
    };

    // Fire the transition events an onboarding UI cares about.
    if (step === 'runtime_unreachable' && previous !== 'runtime_unreachable') {
      this.emit('runtime_missing');
    }
    const wasPairing = previous === 'pairing_required' || previous === 'pairing_pending';
    const isPairing = step === 'pairing_required' || step === 'pairing_pending';
    if (isPairing && !wasPairing) {
      this.emit('pairing_requested');
    }
    // Only announce approval if we were actually waiting on pairing — reaching an authorized step
    // straight from detecting (an app that was already paired) is not a pairing event.
    if (authorized && wasPairing) {
      this.emit('pairing_approved');
    }
    if (step === 'ready' && previous !== 'ready') {
      this.emit('setup_completed');
    }
    return this.state;
  }

  /** Alias for the first `refresh()`, so calling code reads as a flow. */
  start(): Promise<SetupState> {
    return this.refresh();
  }

  /**
   * Assign a printer to the target and immediately send a test ticket, moving to `testing`. Only
   * valid while selecting — calling it otherwise is a programming error, so it throws rather than
   * failing quietly.
   */
  async assignPrinter(printerName: string): Promise<SetupState> {
    this.assertStep('assignPrinter', ['selecting_printer']);
    await this.driver.assignPrinter(this.driver.target, printerName);
    this.state = { ...this.state, step: 'testing', printerName, missingPrinterName: undefined, detail: STEP_DETAIL.testing };
    this.emit('printer_selected');
    await this.driver.sendTest(this.driver.target);
    this.emit('test_print_sent');
    return this.state;
  }

  /** Re-send the test ticket — for when the first one didn't come out and the user is retrying. */
  async printTest(): Promise<SetupState> {
    this.assertStep('printTest', ['testing']);
    await this.driver.sendTest(this.driver.target);
    this.emit('test_print_sent');
    return this.state;
  }

  /**
   * Record the human's answer to "did it print?". `true` confirms the mapping and completes setup;
   * `false` returns to selection, because a mapping nobody could verify is not one to keep.
   */
  async confirm(printed: boolean): Promise<SetupState> {
    this.assertStep('confirm', ['testing']);
    if (!printed) {
      const printers = await this.driver.listPrinters().catch(() => []);
      this.state = { ...this.state, step: 'selecting_printer', printers, detail: STEP_DETAIL.selecting_printer };
      return this.state;
    }
    await this.driver.confirmVerified(this.driver.target);
    this.emit('test_print_confirmed');
    this.state = { ...this.state, step: 'ready', detail: STEP_DETAIL.ready };
    this.emit('setup_completed');
    return this.state;
  }

  /** Abandon the flow. A sticky terminal state until `refresh()` is called again. */
  cancel(): SetupState {
    this.state = { ...this.state, step: 'cancelled', detail: STEP_DETAIL.cancelled };
    this.emit('setup_abandoned');
    return this.state;
  }

  private assertStep(action: string, allowed: SetupStep[]): void {
    if (!allowed.includes(this.state.step)) {
      throw new Error(
        `setup.${action}() cannot run in step "${this.state.step}" — it is valid only in: ${allowed.join(', ')}.`,
      );
    }
  }
}

