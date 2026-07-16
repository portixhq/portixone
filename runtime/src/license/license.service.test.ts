import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { GRACE, type LicenseTokenClaims, type RuntimeLicensePosture } from '@portixone/protocol';
import { derivePosture, LicenseService } from './license.service.js';
import { DEVELOPMENT_KEYRING } from './license.keyring.js';
import { makeClaims, signLicenseToken } from '../../test-support/sign-license-token.js';

const NOW = 1_800_000_000_000; // fixed clock (ms)
const HOUR = 60 * 60 * 1000;

const silentLogger = {
  info() {},
  warn() {},
  error() {},
} as unknown as ConstructorParameters<typeof LicenseService>[0];

// A temp dir per test FILE, since these stores are otherwise pinned to the process cwd and
// node --test runs files in parallel.
const TMP = mkdtempSync(join(tmpdir(), 'portix-lic-'));
const LICENSE_FILE = join(TMP, 'license.json');
const CLOCK_FILE = join(TMP, 'clock.json');

/** Start each test clean so a persisted revocation or clock watermark doesn't leak into the next. */
beforeEach(() => {
  for (const f of [LICENSE_FILE, CLOCK_FILE]) {
    rmSync(f, { force: true });
  }
});

function newService(opts: { applicationId?: string; now?: () => number } = {}): LicenseService {
  return new LicenseService(silentLogger, {
    keyring: DEVELOPMENT_KEYRING,
    licenseFilePath: LICENSE_FILE,
    clockFilePath: CLOCK_FILE,
    ...opts,
  });
}

function claimsWith(status: LicenseTokenClaims['applicationStatus'], expMs: number): LicenseTokenClaims {
  return makeClaims({ applicationStatus: status, exp: Math.floor(expMs / 1000) });
}

// ── derivePosture: the grace/state machine, pure ────────────────────────────────────────────
// Signature: (claims, verificationValid, tokenExpiresAt, hasApplicationId, revoked, nowMs)

test('authenticated revocation wins over everything → action_required', () => {
  const claims = claimsWith('production_active', NOW + 10 * HOUR);
  assert.equal(derivePosture(claims, true, NOW + 10 * HOUR, true, true, NOW), 'action_required');
});

test('no token, no Application configured → development (a dev machine, not a violation)', () => {
  assert.equal(derivePosture(undefined, false, undefined, false, false, NOW), 'development');
});

test('no token but an Application IS configured → unlicensed', () => {
  assert.equal(derivePosture(undefined, false, undefined, true, false, NOW), 'unlicensed');
});

test('valid production token → production_active', () => {
  const claims = claimsWith('production_active', NOW + 10 * HOUR);
  assert.equal(derivePosture(claims, true, NOW + 10 * HOUR, true, false, NOW), 'production_active');
});

test('valid launch-trial token → trial_active', () => {
  const claims = claimsWith('launch_trial', NOW + 10 * HOUR);
  assert.equal(derivePosture(claims, true, NOW + 10 * HOUR, true, false, NOW), 'trial_active');
});

test('valid token with commercial grace_period status → grace_payment', () => {
  const claims = claimsWith('grace_period', NOW + 10 * HOUR);
  assert.equal(derivePosture(claims, true, NOW + 10 * HOUR, true, false, NOW), 'grace_payment');
});

test('valid token with license_action_required / suspended status → action_required', () => {
  for (const status of ['license_action_required', 'suspended'] as const) {
    const claims = claimsWith(status, NOW + 10 * HOUR);
    assert.equal(derivePosture(claims, true, NOW + 10 * HOUR, true, false, NOW), 'action_required');
  }
});

test('expired token WITHIN offline grace → grace_portal_unreachable', () => {
  const expiresAt = NOW - 1 * HOUR;
  const claims = claimsWith('production_active', expiresAt);
  assert.equal(derivePosture(claims, false, expiresAt, true, false, NOW), 'grace_portal_unreachable');
});

test('offline grace is counted from token EXPIRY, not last heartbeat (ratified boundary)', () => {
  const expiresAt = NOW - GRACE.OFFLINE_GRACE_MS + 1 * HOUR;
  const claims = claimsWith('production_active', expiresAt);
  assert.equal(derivePosture(claims, false, expiresAt, true, false, NOW), 'grace_portal_unreachable');

  const justExhausted = NOW - GRACE.OFFLINE_GRACE_MS - 1;
  const claims2 = claimsWith('production_active', justExhausted);
  assert.equal(derivePosture(claims2, false, justExhausted, true, false, NOW), 'action_required');
});

test('expired token PAST offline grace → action_required (still prints, only admin degrades)', () => {
  const expiresAt = NOW - (GRACE.OFFLINE_GRACE_MS + 10 * HOUR);
  const claims = claimsWith('production_active', expiresAt);
  assert.equal(derivePosture(claims, false, expiresAt, true, false, NOW), 'action_required');
});

test('well-formed unexpired token we cannot verify (bad sig / unknown kid) → unlicensed', () => {
  const claims = claimsWith('production_active', NOW + 10 * HOUR);
  assert.equal(derivePosture(claims, false, NOW + 10 * HOUR, true, false, NOW), 'unlicensed');
});

test('INVARIANT: the service exposes no print gate at all', () => {
  const allPostures: RuntimeLicensePosture[] = [
    'production_active',
    'trial_active',
    'development',
    'grace_portal_unreachable',
    'grace_payment',
    'action_required',
    'unlicensed',
  ];
  const service = newService();
  assert.equal(typeof (service as unknown as Record<string, unknown>).canPrint, 'undefined');
  assert.equal(typeof (service as unknown as Record<string, unknown>).assertLicensed, 'undefined');
  assert.equal(allPostures.length, 7);
});

// ── LicenseService: token application + revocation, verified before persistence ──────────────

test('applyToken accepts a valid token and reports production authorization', () => {
  const service = newService();
  const accepted = service.applyToken(signLicenseToken(makeClaims({ applicationStatus: 'production_active' })));
  assert.equal(accepted, true);
  assert.equal(service.getState().posture, 'production_active');
  assert.equal(service.isProductionAuthorized(), true);
});

test('applyToken rejects an expired token without disturbing state', () => {
  const service = newService();
  const iatSec = Math.floor(Date.now() / 1000) - 100 * 3600;
  assert.equal(service.applyToken(signLicenseToken(makeClaims({ iat: iatSec, exp: iatSec + 48 * 3600 }))), false);
});

test('applyToken rejects a token from an unknown key', () => {
  const service = newService();
  assert.equal(service.applyToken(signLicenseToken(makeClaims(), { kid: 'key_unknown' })), false);
});

test('applyToken rejects a token bound to a different Application', () => {
  const service = newService({ applicationId: 'app_demo_abc123' });
  // Token is for a different applicationId than the runtime is deployed as.
  const foreign = signLicenseToken(makeClaims({ sub: 'app_foreign_x', applicationId: 'app_foreign_x' }));
  assert.equal(service.applyToken(foreign), false);
});

test('applyRevocation degrades the admin plane immediately and survives re-derivation', () => {
  const service = newService({ applicationId: 'app_demo_abc123' });
  service.applyToken(signLicenseToken(makeClaims({ applicationStatus: 'production_active' })));
  assert.equal(service.getState().posture, 'production_active');
  const applied = service.applyRevocation({
    code: 'license_revoked',
    applicationId: 'app_demo_abc123',
    effectiveAt: new Date().toISOString(),
  });
  assert.equal(applied, true);
  assert.equal(service.getState().posture, 'action_required');
});

test('applyRevocation ignores a notice for a different Application', () => {
  const service = newService({ applicationId: 'app_demo_abc123' });
  const applied = service.applyRevocation({
    code: 'license_revoked',
    applicationId: 'app_someone_else',
    effectiveAt: new Date().toISOString(),
  });
  assert.equal(applied, false);
});

test('a fresh valid token clears a prior revocation', () => {
  const service = newService({ applicationId: 'app_demo_abc123' });
  service.applyRevocation({ code: 'license_revoked', applicationId: 'app_demo_abc123', effectiveAt: new Date().toISOString() });
  assert.equal(service.getState().posture, 'action_required');
  service.applyToken(signLicenseToken(makeClaims({ applicationStatus: 'production_active' })));
  assert.equal(service.getState().posture, 'production_active');
});

test('trial posture flips to grace_portal_unreachable as the injected clock crosses expiry', () => {
  let clock = Date.now();
  const service = newService({ applicationId: 'app_demo_abc123', now: () => clock });
  const expSec = Math.floor(clock / 1000) + 2 * 3600;
  service.applyToken(signLicenseToken(makeClaims({ applicationStatus: 'launch_trial', exp: expSec })));
  assert.equal(service.getState().posture, 'trial_active');
  clock = expSec * 1000 + 1 * HOUR;
  assert.equal(service.getState().posture, 'grace_portal_unreachable');
});
