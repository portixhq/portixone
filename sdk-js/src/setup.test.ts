import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveSetupStep, PortixSetup, type SetupDriver, type SetupEvent, type SetupStep } from './setup.js';
import type { ConnectionState, PrinterInfo, PrinterTargetMapping } from './types.js';

/**
 * The exit criterion for this phase: a developer can build "Configure printer" without writing
 * connection, pairing, selection, or test logic. That is only true if every step is reachable and
 * the actions move between them predictably — so the derivation is tested as a table, and the flow
 * is driven end to end against a fake Runtime.
 */

function conn(over: Partial<ConnectionState>): Pick<ConnectionState, 'runtime' | 'pairing'> {
  return { runtime: 'connected', pairing: 'approved', ...over };
}

const configured: PrinterTargetMapping = { printerName: 'EPSON TM-T20III', updatedAt: '', verified: true };
const unverified: PrinterTargetMapping = { printerName: 'EPSON TM-T20III', updatedAt: '', verified: false };
const stale: PrinterTargetMapping = { printerName: 'OLD', updatedAt: '', verified: true, invalidReason: 'printer_missing' };

// ── Step derivation, as a table ─────────────────────────────────────────────────────────────

const TABLE: { name: string; c: Pick<ConnectionState, 'runtime' | 'pairing'>; m?: PrinterTargetMapping; expect: SetupStep }[] = [
  { name: 'unreachable Runtime', c: conn({ runtime: 'unreachable', pairing: 'required' }), expect: 'runtime_unreachable' },
  { name: 'incompatible Runtime', c: conn({ runtime: 'incompatible', pairing: 'required' }), expect: 'runtime_incompatible' },
  { name: 'pairing required', c: conn({ pairing: 'required' }), expect: 'pairing_required' },
  { name: 'pairing pending', c: conn({ pairing: 'pending' }), expect: 'pairing_pending' },
  { name: 'pairing denied', c: conn({ pairing: 'denied' }), expect: 'pairing_denied' },
  { name: 'pairing expired → denied screen', c: conn({ pairing: 'expired' }), expect: 'pairing_denied' },
  { name: 'authorized, no mapping', c: conn({}), m: undefined, expect: 'selecting_printer' },
  { name: 'authorized, stale mapping needs reselection', c: conn({}), m: stale, expect: 'selecting_printer' },
  { name: 'authorized, assigned but unverified', c: conn({}), m: unverified, expect: 'testing' },
  { name: 'authorized, configured and verified', c: conn({}), m: configured, expect: 'ready' },
  { name: 'apiKey path (not_required) counts as authorized', c: conn({ pairing: 'not_required' }), m: configured, expect: 'ready' },
];

for (const row of TABLE) {
  test(`derive: ${row.name}`, () => {
    assert.equal(deriveSetupStep(row.c, row.m), row.expect);
  });
}

test('unreachable outranks everything — you cannot configure a printer you cannot reach', () => {
  assert.equal(deriveSetupStep({ runtime: 'unreachable', pairing: 'approved' }, configured), 'runtime_unreachable');
});

test('pairing outranks the mapping — cannot judge a printer before you may configure one', () => {
  assert.equal(deriveSetupStep({ runtime: 'connected', pairing: 'pending' }, configured), 'pairing_pending');
});

// ── A controllable fake Runtime ─────────────────────────────────────────────────────────────

class FakeRuntime implements SetupDriver {
  target = 'receipt' as const;
  downloadUrl = 'https://portix.one/download';
  connectResult: ConnectionState = { status: 'ready', runtime: 'connected', pairing: 'approved', targets: {}, runtimeVersion: '0.1.1' };
  mapping: PrinterTargetMapping | undefined;
  printers: PrinterInfo[] = [
    { name: 'EPSON TM-T20III', online: true },
    { name: 'Microsoft Print to PDF', online: true },
  ];
  sent = 0;
  confirmed = 0;
  assignedTo?: string;

  async connect(): Promise<ConnectionState> {
    return this.connectResult;
  }
  async listPrinters(): Promise<PrinterInfo[]> {
    return this.printers;
  }
  async getTargetMapping(): Promise<PrinterTargetMapping | undefined> {
    return this.mapping;
  }
  async assignPrinter(_t: 'receipt', printerName: string): Promise<void> {
    this.assignedTo = printerName;
    this.mapping = { printerName, updatedAt: '', verified: false };
  }
  async sendTest(): Promise<void> {
    this.sent += 1;
  }
  async confirmVerified(): Promise<void> {
    this.confirmed += 1;
    if (this.mapping) this.mapping.verified = true;
  }
}

function recording(setup: PortixSetup): SetupEvent[] {
  const events: SetupEvent[] = [];
  const all: SetupEvent[] = [
    'setup_started', 'runtime_missing', 'pairing_requested', 'pairing_approved',
    'printer_selected', 'test_print_sent', 'test_print_confirmed', 'setup_completed', 'setup_abandoned',
  ];
  all.forEach((e) => setup.on(e, () => events.push(e)));
  return events;
}

// ── The happy path, end to end ──────────────────────────────────────────────────────────────

test('a full setup: detect → select → test → confirm → ready, with the right events', async () => {
  const rt = new FakeRuntime();
  const setup = new PortixSetup(rt);
  const events = recording(setup);

  const s1 = await setup.start();
  assert.equal(s1.step, 'selecting_printer');
  assert.deepEqual(s1.printers.map((p) => p.name), ['EPSON TM-T20III', 'Microsoft Print to PDF']);

  const s2 = await setup.assignPrinter('EPSON TM-T20III');
  assert.equal(s2.step, 'testing');
  assert.equal(s2.printerName, 'EPSON TM-T20III');
  assert.equal(rt.sent, 1, 'assigning also sends the first test ticket');

  const s3 = await setup.confirm(true);
  assert.equal(s3.step, 'ready');
  assert.equal(rt.confirmed, 1);

  assert.deepEqual(events, [
    'setup_started', 'printer_selected', 'test_print_sent', 'test_print_confirmed', 'setup_completed',
  ]);
});

test('confirming "no, it did not print" returns to selection rather than keeping a bad mapping', async () => {
  const rt = new FakeRuntime();
  const setup = new PortixSetup(rt);
  await setup.start();
  await setup.assignPrinter('EPSON TM-T20III');
  const state = await setup.confirm(false);
  assert.equal(state.step, 'selecting_printer');
  assert.equal(rt.confirmed, 0, 'nothing gets marked verified');
});

test('a re-test can be sent while in testing', async () => {
  const rt = new FakeRuntime();
  const setup = new PortixSetup(rt);
  await setup.start();
  await setup.assignPrinter('EPSON TM-T20III');
  await setup.printTest();
  assert.equal(rt.sent, 2);
});

// ── Resumption & unhappy paths ──────────────────────────────────────────────────────────────

test('resumes at testing when a mapping exists but was never verified', async () => {
  const rt = new FakeRuntime();
  rt.mapping = { printerName: 'EPSON TM-T20III', updatedAt: '', verified: false };
  const setup = new PortixSetup(rt);
  const state = await setup.start();
  assert.equal(state.step, 'testing');
  assert.equal(state.printerName, 'EPSON TM-T20III');
});

test('resumes directly at ready when the mapping is already verified', async () => {
  const rt = new FakeRuntime();
  rt.mapping = { printerName: 'EPSON TM-T20III', updatedAt: '', verified: true };
  const setup = new PortixSetup(rt);
  const events = recording(setup);
  const state = await setup.start();
  assert.equal(state.step, 'ready');
  assert.ok(events.includes('setup_completed'));
});

test('a stale mapping surfaces the missing printer and asks for reselection', async () => {
  const rt = new FakeRuntime();
  rt.mapping = { printerName: 'GONE-PRINTER', updatedAt: '', verified: true, invalidReason: 'printer_missing' };
  const setup = new PortixSetup(rt);
  const state = await setup.start();
  assert.equal(state.step, 'selecting_printer');
  assert.equal(state.missingPrinterName, 'GONE-PRINTER');
});

test('an unreachable Runtime reports the download url and emits runtime_missing', async () => {
  const rt = new FakeRuntime();
  rt.connectResult = { status: 'runtime_unreachable', runtime: 'unreachable', pairing: 'required', targets: {} };
  const setup = new PortixSetup(rt);
  const events = recording(setup);
  const state = await setup.start();
  assert.equal(state.step, 'runtime_unreachable');
  assert.equal(state.downloadUrl, 'https://portix.one/download');
  assert.ok(events.includes('runtime_missing'));
});

test('pending → approved emits pairing_approved across two refreshes', async () => {
  const rt = new FakeRuntime();
  rt.connectResult = { status: 'pairing_pending', runtime: 'connected', pairing: 'pending', targets: {} };
  const setup = new PortixSetup(rt);
  const events = recording(setup);

  const pending = await setup.start();
  assert.equal(pending.step, 'pairing_pending');
  assert.ok(events.includes('pairing_requested'));

  // The human approves in the tray; the next refresh sees it.
  rt.connectResult = { status: 'ready', runtime: 'connected', pairing: 'approved', targets: {} };
  const approved = await setup.refresh();
  assert.equal(approved.step, 'selecting_printer');
  assert.ok(events.includes('pairing_approved'));
});

// ── Guards ──────────────────────────────────────────────────────────────────────────────────

test('actions are rejected in the wrong step — a programming error, not a silent no-op', async () => {
  const rt = new FakeRuntime();
  const setup = new PortixSetup(rt);
  await setup.start(); // selecting_printer
  await assert.rejects(() => setup.confirm(true), /cannot run in step "selecting_printer"/);
  await assert.rejects(() => setup.printTest(), /cannot run in step "selecting_printer"/);
});

test('cancel is a sticky terminal state and emits setup_abandoned', async () => {
  const rt = new FakeRuntime();
  const setup = new PortixSetup(rt);
  const events = recording(setup);
  await setup.start();
  const state = setup.cancel();
  assert.equal(state.step, 'cancelled');
  assert.ok(events.includes('setup_abandoned'));
  assert.equal(setup.getState().step, 'cancelled');
});
