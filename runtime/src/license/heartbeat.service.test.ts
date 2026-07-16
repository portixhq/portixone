import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { HeartbeatService } from './heartbeat.service.js';
import { LicenseService } from './license.service.js';
import { DEVELOPMENT_KEYRING } from './license.keyring.js';
import { makeClaims, signLicenseToken } from '../../test-support/sign-license-token.js';

const silentLogger = {
  info() {},
  warn() {},
  error() {},
} as unknown as ConstructorParameters<typeof LicenseService>[0];

// A temp dir per test FILE. These stores are otherwise pinned to the process cwd, and node --test
// runs files in parallel, so they would quietly overwrite each other's state — passing alone and
// failing together, or passing together by luck.
const TMP = mkdtempSync(join(tmpdir(), 'portix-hb-'));
const LICENSE_FILE = join(TMP, 'license.json');
const CLOCK_FILE = join(TMP, 'clock.json');

beforeEach(() => {
  for (const f of [LICENSE_FILE, CLOCK_FILE]) {
    rmSync(f, { force: true });
  }
});

function newLicense(): LicenseService {
  return new LicenseService(silentLogger, {
    keyring: DEVELOPMENT_KEYRING,
    applicationId: 'app_demo_abc123',
    now: () => Date.now(),
    licenseFilePath: LICENSE_FILE,
    clockFilePath: CLOCK_FILE,
  });
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

test('inert when no heartbeatUrl is configured — never touches the network', async () => {
  let called = false;
  const heartbeat = new HeartbeatService(newLicense(), silentLogger, {
    fetchImpl: async () => {
      called = true;
      return okResponse({});
    },
  });
  assert.equal(await heartbeat.runOnce(), false);
  assert.equal(called, false);
});

test('applies a fresh token returned by the Portal', async () => {
  const license = newLicense();
  const fresh = signLicenseToken(makeClaims({ applicationStatus: 'production_active' }));
  const heartbeat = new HeartbeatService(license, silentLogger, {
    heartbeatUrl: 'https://portal.example.com/renew',
    fetchImpl: async () => okResponse({ token: fresh }),
  });
  assert.equal(await heartbeat.runOnce(), true);
  assert.equal(license.getState().posture, 'production_active');
});

test('a network error is swallowed, not thrown (technical grace, not a print failure)', async () => {
  const heartbeat = new HeartbeatService(newLicense(), silentLogger, {
    heartbeatUrl: 'https://portal.example.com/renew',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  // Must resolve false rather than reject — the print path must never see a heartbeat error.
  assert.equal(await heartbeat.runOnce(), false);
});

test('a non-OK response keeps the cached token', async () => {
  const heartbeat = new HeartbeatService(newLicense(), silentLogger, {
    heartbeatUrl: 'https://portal.example.com/renew',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(await heartbeat.runOnce(), false);
});

test('a 200 response carrying no token is ignored', async () => {
  const heartbeat = new HeartbeatService(newLicense(), silentLogger, {
    heartbeatUrl: 'https://portal.example.com/renew',
    fetchImpl: async () => okResponse({ notAToken: true }),
  });
  assert.equal(await heartbeat.runOnce(), false);
});

// ── Recognized revocation vs generic negatives (hardening #3) ────────────────────────────────

test('applies a recognized revocation contract delivered over TLS', async () => {
  const license = newLicense();
  license.applyToken(signLicenseToken(makeClaims({ applicationStatus: 'production_active' })));
  const heartbeat = new HeartbeatService(license, silentLogger, {
    heartbeatUrl: 'https://portal.example.com/renew',
    fetchImpl: async () =>
      okResponse({
        revocation: {
          code: 'license_revoked',
          applicationId: 'app_demo_abc123',
          effectiveAt: new Date().toISOString(),
        },
      }),
  });
  assert.equal(await heartbeat.runOnce(), true);
  assert.equal(license.getState().posture, 'action_required');
});

test('refuses a revocation delivered over a non-TLS URL', async () => {
  const license = newLicense();
  license.applyToken(signLicenseToken(makeClaims({ applicationStatus: 'production_active' })));
  const heartbeat = new HeartbeatService(license, silentLogger, {
    heartbeatUrl: 'http://portal.example.com/renew', // not https
    fetchImpl: async () =>
      okResponse({
        revocation: { code: 'license_revoked', applicationId: 'app_demo_abc123', effectiveAt: new Date().toISOString() },
      }),
  });
  assert.equal(await heartbeat.runOnce(), false);
  assert.equal(license.getState().posture, 'production_active');
});

test('a generic 403 is NOT treated as revocation — token conserved', async () => {
  const license = newLicense();
  license.applyToken(signLicenseToken(makeClaims({ applicationStatus: 'production_active' })));
  const heartbeat = new HeartbeatService(license, silentLogger, {
    heartbeatUrl: 'https://portal.example.com/renew',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }),
  });
  assert.equal(await heartbeat.runOnce(), false);
  assert.equal(license.getState().posture, 'production_active');
});

test('unknown JSON shaped like a revocation but missing fields is ignored', async () => {
  const license = newLicense();
  license.applyToken(signLicenseToken(makeClaims({ applicationStatus: 'production_active' })));
  const heartbeat = new HeartbeatService(license, silentLogger, {
    heartbeatUrl: 'https://portal.example.com/renew',
    fetchImpl: async () => okResponse({ revocation: { code: 'license_revoked' } }), // no applicationId/effectiveAt
  });
  assert.equal(await heartbeat.runOnce(), false);
  assert.equal(license.getState().posture, 'production_active');
});
