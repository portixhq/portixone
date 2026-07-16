import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { ADMIN_APP_ID, resolveJobPrinter, scopeFor } from './print.controller.js';
import { PrinterTargetsService } from '../printer/printer-targets.service.js';
import { PrinterTargetsStore } from '../printer/printer-targets.store.js';
import { assertOwnAppOrAdmin } from '../auth/auth.middleware.js';
import type { AuthContext } from '../auth/auth.service.js';

const DIR = mkdtempSync(join(tmpdir(), 'portix-print-'));
const STORE_FILE = join(DIR, 'printer-targets.json');

beforeEach(() => {
  rmSync(STORE_FILE, { force: true });
});

function newService(legacyDefault?: string): PrinterTargetsService {
  return new PrinterTargetsService(new PrinterTargetsStore(STORE_FILE), legacyDefault);
}

const nerionCtx: AuthContext = {
  isAdmin: false,
  appId: 'nerion',
  tenant: 'restaurant-42',
  origin: 'https://app.nerion.mx',
  permissions: ['print'],
};
const adminCtx: AuthContext = { isAdmin: true };

// ── The exit criterion, at the layer the app actually touches ────────────────────────────────

test('EXIT CRITERION: an app prints with only a target and never names a printer', () => {
  const targets = newService();
  targets.set({ appId: 'nerion', origin: 'https://app.nerion.mx' }, 'receipt', 'EPSON TM-T20III');

  const job = resolveJobPrinter({ content: 'ticket', target: 'receipt' }, targets, nerionCtx);

  assert.equal(job.printerName, 'EPSON TM-T20III');
  assert.equal(job.target, 'receipt');
});

test('the same app code resolves to a DIFFERENT printer on a different installation', () => {
  // This is the property that makes one integration serve 200 customers: identical job payload,
  // different machine, different printer — decided locally, never by the app.
  const machineA = newService();
  machineA.set({ appId: 'nerion', origin: 'https://app.nerion.mx' }, 'receipt', 'EPSON TM-T20III');
  const jobA = resolveJobPrinter({ content: 'ticket', target: 'receipt' }, machineA, nerionCtx);

  rmSync(STORE_FILE, { force: true });
  const machineB = newService();
  machineB.set({ appId: 'nerion', origin: 'https://app.nerion.mx' }, 'receipt', 'XP-80C');
  const jobB = resolveJobPrinter({ content: 'ticket', target: 'receipt' }, machineB, nerionCtx);

  assert.equal(jobA.printerName, 'EPSON TM-T20III');
  assert.equal(jobB.printerName, 'XP-80C');
});

test('an unconfigured target fails at enqueue, not silently inside the queue', () => {
  const targets = newService();
  assert.throws(
    () => resolveJobPrinter({ content: 'ticket', target: 'kitchen' }, targets, nerionCtx),
    (e: Error & { code?: string }) => e.code === 'TARGET_NOT_CONFIGURED',
  );
});

// ── Backwards compatibility ─────────────────────────────────────────────────────────────────

test('an explicit printerName still wins — the advanced escape hatch is untouched', () => {
  const targets = newService();
  targets.set({ appId: 'nerion', origin: 'https://app.nerion.mx' }, 'receipt', 'EPSON TM-T20III');
  const job = resolveJobPrinter(
    { content: 'ticket', target: 'receipt', printerName: 'Microsoft Print to PDF' },
    targets,
    nerionCtx,
  );
  assert.equal(job.printerName, 'Microsoft Print to PDF');
});

test('a job with neither target nor printerName is left alone — the pre-targets contract still works', () => {
  const job = resolveJobPrinter({ content: 'ticket' }, newService('Legacy Default'), nerionCtx);
  assert.equal(job.printerName, undefined); // the driver applies the machine default, as before
});

test('receipt falls back to the legacy global default, so existing installs survive the update', () => {
  const job = resolveJobPrinter({ content: 'ticket', target: 'receipt' }, newService('Legacy Default'), nerionCtx);
  assert.equal(job.printerName, 'Legacy Default');
});

// ── Scoping ─────────────────────────────────────────────────────────────────────────────────

test('an admin-key print gets its own scope rather than being a special case', () => {
  assert.equal(scopeFor(adminCtx).appId, ADMIN_APP_ID);
  assert.equal(scopeFor(nerionCtx).appId, 'nerion');
  assert.equal(scopeFor(nerionCtx).origin, 'https://app.nerion.mx');
});

test('an app cannot resolve another app\'s target configuration', () => {
  const targets = newService();
  targets.set({ appId: 'kubia', origin: 'https://app.kubia.mx' }, 'receipt', 'XP-80C');
  // Nerion asks for receipt; Kubia's mapping must not answer for it.
  assert.throws(
    () => resolveJobPrinter({ content: 'ticket', target: 'receipt' }, targets, nerionCtx),
    (e: Error & { code?: string }) => e.code === 'TARGET_NOT_CONFIGURED',
  );
});

// ── Cross-app authorization ─────────────────────────────────────────────────────────────────

test('an app cannot configure another app\'s targets; admin can configure anyone\'s', () => {
  // Without this guard, any paired app could repoint a competitor's receipt target on a shared till.
  assert.throws(
    () => assertOwnAppOrAdmin(nerionCtx, 'kubia'),
    (e: Error & { code?: string }) => e.code === 'PERMISSION_DENIED',
  );
  assert.doesNotThrow(() => assertOwnAppOrAdmin(nerionCtx, 'nerion'));
  assert.doesNotThrow(() => assertOwnAppOrAdmin(adminCtx, 'kubia'));
});
