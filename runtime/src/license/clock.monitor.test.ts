import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { ClockMonitor } from './clock.monitor.js';

const silentLogger = {
  info() {},
  warn() {},
  error() {},
} as unknown as ConstructorParameters<typeof ClockMonitor>[0];

const CLOCK_FILE = join(mkdtempSync(join(tmpdir(), 'portix-clock-')), 'clock.json');
const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;

beforeEach(() => {
  rmSync(CLOCK_FILE, { force: true });
});

test('no rollback on a monotonic clock', () => {
  const m = new ClockMonitor(silentLogger, CLOCK_FILE);
  assert.equal(m.observe(NOW), false);
  assert.equal(m.observe(NOW + 10 * MIN), false);
});

test('detects a rollback below the strong (heartbeat-confirmed) watermark', () => {
  const m = new ClockMonitor(silentLogger, CLOCK_FILE);
  m.recordConfirmed(NOW);
  // Clock wound back an hour, well past the jitter threshold.
  assert.equal(m.observe(NOW - 60 * MIN), true);
});

test('a small backward jitter under the threshold is not flagged', () => {
  const m = new ClockMonitor(silentLogger, CLOCK_FILE);
  m.recordConfirmed(NOW);
  assert.equal(m.observe(NOW - 1 * MIN), false); // within the 5-min tolerance
});

test('detects a rollback below the weak (highest-local) watermark', () => {
  const m = new ClockMonitor(silentLogger, CLOCK_FILE);
  m.observe(NOW + 100 * MIN); // raises the local watermark
  assert.equal(m.observe(NOW), true); // 100 min behind the local high-water
});

test('the strong watermark is only ever raised by a confirmation', () => {
  const m = new ClockMonitor(silentLogger, CLOCK_FILE);
  m.observe(NOW + 100 * MIN); // local only
  assert.equal(m.watermarks().highestConfirmedMs, 0);
  m.recordConfirmed(NOW + 50 * MIN);
  assert.equal(m.watermarks().highestConfirmedMs, NOW + 50 * MIN);
});
