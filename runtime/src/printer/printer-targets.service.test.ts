import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { PrinterTargetsService } from './printer-targets.service.js';
import { PrinterTargetsStore } from './printer-targets.store.js';

// A temp file per test file: the store path is otherwise cwd-fixed, and node --test runs files in
// parallel, so they would silently overwrite each other's state.
const DIR = mkdtempSync(join(tmpdir(), 'portix-targets-'));
const STORE_FILE = join(DIR, 'printer-targets.json');

beforeEach(() => {
  rmSync(STORE_FILE, { force: true });
});

function newService(legacyDefault?: string): PrinterTargetsService {
  return new PrinterTargetsService(new PrinterTargetsStore(STORE_FILE), legacyDefault);
}

const NERION = { appId: 'nerion', origin: 'https://app.nerion.mx' };
const KUBIA = { appId: 'kubia', origin: 'https://app.kubia.mx' };

// ── The exit criterion: print by target, never by printer name ───────────────────────────────

test('an app resolves its own target to this machine\'s printer', () => {
  const s = newService();
  s.set(NERION, 'receipt', 'EPSON TM-T20III');
  assert.equal(s.resolve(NERION, 'receipt'), 'EPSON TM-T20III');
});

test('one app with two targets resolves each to a different printer', () => {
  const s = newService();
  s.set(NERION, 'receipt', 'EPSON TM-T20III');
  s.set(NERION, 'kitchen', 'Generic / Text Only');
  assert.equal(s.resolve(NERION, 'receipt'), 'EPSON TM-T20III');
  assert.equal(s.resolve(NERION, 'kitchen'), 'Generic / Text Only');
});

test('two apps on the same machine keep separate mappings for the same target', () => {
  const s = newService();
  s.set(NERION, 'receipt', 'EPSON TM-T20III');
  s.set(KUBIA, 'receipt', 'XP-80C');
  assert.equal(s.resolve(NERION, 'receipt'), 'EPSON TM-T20III');
  assert.equal(s.resolve(KUBIA, 'receipt'), 'XP-80C');
});

test('two origins of the same app are scoped separately (staging must not print on production)', () => {
  const s = newService();
  const prod = { appId: 'nerion', origin: 'https://app.nerion.mx' };
  const staging = { appId: 'nerion', origin: 'https://staging.nerion.mx' };
  s.set(prod, 'receipt', 'EPSON TM-T20III');
  s.set(staging, 'receipt', 'Microsoft Print to PDF');
  assert.equal(s.resolve(prod, 'receipt'), 'EPSON TM-T20III');
  assert.equal(s.resolve(staging, 'receipt'), 'Microsoft Print to PDF');
});

test('a caller with no origin (CLI/server-side) gets its own scope, not a crash', () => {
  const s = newService();
  const noOrigin = { appId: 'nerion' };
  s.set(noOrigin, 'receipt', 'EPSON TM-T20III');
  assert.equal(s.resolve(noOrigin, 'receipt'), 'EPSON TM-T20III');
  assert.equal(s.list('nerion').origin, '*');
  // …and it is NOT the same bucket as a browser origin.
  assert.throws(() => s.resolve(NERION, 'receipt'), /No printer is configured/);
});

// ── Unconfigured and stale mappings ─────────────────────────────────────────────────────────

test('an unconfigured target throws TARGET_NOT_CONFIGURED, it does not guess a printer', () => {
  const s = newService();
  assert.throws(() => s.resolve(NERION, 'receipt'), (e: Error & { code?: string }) => e.code === 'TARGET_NOT_CONFIGURED');
});

test('a target bound to a printer that no longer exists is invalid, never a silent fallback', () => {
  const s = newService();
  s.set(NERION, 'receipt', 'EPSON TM-T20III');
  // The printer was uninstalled or renamed; only these two remain.
  assert.throws(
    () => s.resolve(NERION, 'receipt', ['Microsoft Print to PDF', 'OneNote']),
    (e: Error & { code?: string }) => e.code === 'MAPPING_INVALID',
  );
  // The mapping is KEPT and flagged — it's the record of what needs reassigning.
  assert.equal(s.list('nerion', NERION.origin).targets.receipt?.printerName, 'EPSON TM-T20III');
  assert.equal(s.list('nerion', NERION.origin).targets.receipt?.invalidReason, 'printer_missing');
});

test('revalidate flags a vanished printer and clears the flag when it comes back', () => {
  const s = newService();
  s.set(NERION, 'receipt', 'EPSON TM-T20III');

  const gone = s.revalidate(['Microsoft Print to PDF']);
  assert.deepEqual(gone, [{ appId: 'nerion', origin: NERION.origin, target: 'receipt', valid: false }]);
  assert.equal(s.list('nerion', NERION.origin).targets.receipt?.invalidReason, 'printer_missing');

  // A driver reinstall brings it back — the mapping recovers instead of needing a redo.
  const back = s.revalidate(['EPSON TM-T20III']);
  assert.deepEqual(back, [{ appId: 'nerion', origin: NERION.origin, target: 'receipt', valid: true }]);
  assert.equal(s.list('nerion', NERION.origin).targets.receipt?.invalidReason, undefined);
});

test('revalidate reports nothing when nothing changed', () => {
  const s = newService();
  s.set(NERION, 'receipt', 'EPSON TM-T20III');
  assert.deepEqual(s.revalidate(['EPSON TM-T20III']), []);
});

// ── Legacy bridge ───────────────────────────────────────────────────────────────────────────

test('receipt falls back to the pre-targets global defaultPrinter, so existing installs keep printing', () => {
  const s = newService('Legacy Default Printer');
  assert.equal(s.resolve(NERION, 'receipt'), 'Legacy Default Printer');
});

test('the legacy fallback covers receipt only — it says nothing about where a kitchen ticket goes', () => {
  const s = newService('Legacy Default Printer');
  assert.throws(() => s.resolve(NERION, 'kitchen'), /No printer is configured/);
});

test('an explicit mapping beats the legacy default', () => {
  const s = newService('Legacy Default Printer');
  s.set(NERION, 'receipt', 'EPSON TM-T20III');
  assert.equal(s.resolve(NERION, 'receipt'), 'EPSON TM-T20III');
});

// ── Persistence ─────────────────────────────────────────────────────────────────────────────

test('mappings survive a restart — the whole point of configuring once', () => {
  newService().set(NERION, 'receipt', 'EPSON TM-T20III');
  // A brand-new service instance, as if the runtime had restarted.
  assert.equal(newService().resolve(NERION, 'receipt'), 'EPSON TM-T20III');
});

test('assignment starts unverified and becomes verified only when a human confirms', () => {
  const s = newService();
  s.set(NERION, 'receipt', 'EPSON TM-T20III');
  assert.equal(s.list('nerion', NERION.origin).targets.receipt?.verified, false);
  s.markVerified(NERION, 'receipt');
  assert.equal(newService().list('nerion', NERION.origin).targets.receipt?.verified, true);
});

test('markVerified on an unconfigured target reports nothing rather than inventing a mapping', () => {
  assert.equal(newService().markVerified(NERION, 'receipt'), undefined);
});

test('remove deletes a mapping and reports whether there was one', () => {
  const s = newService();
  s.set(NERION, 'receipt', 'EPSON TM-T20III');
  assert.equal(s.remove(NERION, 'receipt'), true);
  assert.equal(s.remove(NERION, 'receipt'), false);
  assert.throws(() => s.resolve(NERION, 'receipt'), /No printer is configured/);
});

test('listAll sees every app and origin on the machine — the dashboard view', () => {
  const s = newService();
  s.set(NERION, 'receipt', 'EPSON TM-T20III');
  s.set(KUBIA, 'receipt', 'XP-80C');
  const all = s.listAll();
  assert.equal(all.length, 2);
  assert.ok(all.some((v) => v.appId === 'nerion' && v.targets.receipt?.printerName === 'EPSON TM-T20III'));
  assert.ok(all.some((v) => v.appId === 'kubia' && v.targets.receipt?.printerName === 'XP-80C'));
});
