import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildConnectionState, deriveStatus, isProtocolCompatible } from './connection-state.js';
import type { ConnectionStatus } from './types.js';

/**
 * The exit criterion for this phase is that an application can render a correct screen for every
 * state without parsing exception strings. That is only checkable if every state is reachable
 * deterministically — hence a pure function and a table.
 */

// ── The state table ─────────────────────────────────────────────────────────────────────────

const TABLE: { name: string; observed: Parameters<typeof deriveStatus>[0]; expect: ConnectionStatus }[] = [
  {
    name: 'nothing answered → runtime_unreachable',
    observed: { runtime: 'unreachable', pairing: 'required' },
    expect: 'runtime_unreachable',
  },
  {
    name: 'answered but wrong protocol major → runtime_incompatible',
    observed: { runtime: 'incompatible', pairing: 'required' },
    expect: 'runtime_incompatible',
  },
  {
    name: 'reachable, no usable credential → pairing_required',
    observed: { runtime: 'connected', pairing: 'required' },
    expect: 'pairing_required',
  },
  {
    name: 'reachable, waiting on a human → pairing_pending',
    observed: { runtime: 'connected', pairing: 'pending' },
    expect: 'pairing_pending',
  },
  {
    name: 'pairing denied → pairing_denied',
    observed: { runtime: 'connected', pairing: 'denied' },
    expect: 'pairing_denied',
  },
  {
    name: 'pairing expired is reported as denied — the app shows the same screen either way',
    observed: { runtime: 'connected', pairing: 'expired' },
    expect: 'pairing_denied',
  },
  {
    name: 'authorized but targets unreadable → connected, NOT ready',
    observed: { runtime: 'connected', pairing: 'approved', targets: undefined },
    expect: 'connected',
  },
  {
    name: 'authorized, needs receipt, it is configured → ready',
    observed: { runtime: 'connected', pairing: 'approved', targets: { receipt: 'configured' }, expectedTarget: 'receipt' },
    expect: 'ready',
  },
  {
    name: 'authorized, needs receipt, nothing configured → target_not_configured',
    observed: { runtime: 'connected', pairing: 'approved', targets: {}, expectedTarget: 'receipt' },
    expect: 'target_not_configured',
  },
  {
    name: 'authorized, needs kitchen, only receipt configured → target_not_configured',
    observed: { runtime: 'connected', pairing: 'approved', targets: { receipt: 'configured' }, expectedTarget: 'kitchen' },
    expect: 'target_not_configured',
  },
  {
    name: 'authorized, no target demanded → ready',
    observed: { runtime: 'connected', pairing: 'approved', targets: {} },
    expect: 'ready',
  },
  {
    name: 'an explicit apiKey means pairing never applies → ready',
    observed: { runtime: 'connected', pairing: 'not_required', targets: {} },
    expect: 'ready',
  },
];

for (const row of TABLE) {
  test(`state: ${row.name}`, () => {
    assert.equal(deriveStatus(row.observed), row.expect);
  });
}

test('every declared status is reachable — no dead states in the union', () => {
  const reachable = new Set(TABLE.map((r) => r.expect));
  const declared: ConnectionStatus[] = [
    'runtime_unreachable',
    'runtime_incompatible',
    'pairing_required',
    'pairing_pending',
    'pairing_denied',
    'connected',
    'target_not_configured',
    'ready',
  ];
  const dead = declared.filter((s) => !reachable.has(s));
  assert.deepEqual(dead, [], 'a status nobody can ever observe is API that lies about what it reports');
});

// ── Precedence ──────────────────────────────────────────────────────────────────────────────

test('an unreachable Runtime outranks everything — you cannot pair with what you cannot reach', () => {
  const status = deriveStatus({
    runtime: 'unreachable',
    pairing: 'approved',
    targets: { receipt: 'configured' },
    expectedTarget: 'receipt',
  });
  assert.equal(status, 'runtime_unreachable');
});

test('pairing outranks targets — a target cannot be judged before you may ask about it', () => {
  const status = deriveStatus({
    runtime: 'connected',
    pairing: 'pending',
    targets: {},
    expectedTarget: 'receipt',
  });
  assert.equal(status, 'pairing_pending');
});

// ── Protocol compatibility ──────────────────────────────────────────────────────────────────

test('a matching protocol major is compatible; a different major is not', () => {
  assert.equal(isProtocolCompatible('0.2.0', '0.2.0'), true);
  assert.equal(isProtocolCompatible('0.9.9', '0.2.0'), true, 'minor differences do not break the wire contract');
  assert.equal(isProtocolCompatible('1.0.0', '0.2.0'), false);
});

test('a Runtime too old to report a protocol version is assumed compatible, not locked out', () => {
  // Refusing here would break every install that predates the field, over a version string we never
  // received. A real mismatch shows up as a request failing.
  assert.equal(isProtocolCompatible(undefined, '0.2.0'), true);
});

// ── The returned shape ──────────────────────────────────────────────────────────────────────

test('the state carries the dimensions, not just a verdict', () => {
  const state = buildConnectionState({
    runtime: 'connected',
    pairing: 'approved',
    targets: { receipt: 'configured', kitchen: 'not_configured' },
    expectedTarget: 'receipt',
    runtimeVersion: '0.1.1',
    protocolVersion: '0.2.0',
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.runtime, 'connected');
  assert.equal(state.pairing, 'approved');
  assert.equal(state.targets.kitchen, 'not_configured');
  assert.equal(state.runtimeVersion, '0.1.1');
});

test('unreadable targets surface as an empty map plus a non-ready status, never as "none configured"', () => {
  const state = buildConnectionState({ runtime: 'connected', pairing: 'approved', targets: undefined });
  assert.deepEqual(state.targets, {});
  assert.equal(state.status, 'connected', 'not knowing is not the same as knowing there are none');
});
