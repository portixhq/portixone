import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SecurityService } from './security.service.js';

/** Captures the headers a response would carry, without a real ServerResponse. */
function captureCorsHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; } };
  new SecurityService().applyCorsHeaders(res as unknown as import('node:http').ServerResponse);
  return headers;
}

test('CORS allows the methods the printer-target API actually uses from a browser', () => {
  // Regression guard: PUT and DELETE were missing, so a cross-origin browser app could not configure
  // or remove printer targets through the SDK — the preflight rejected the method and setup() saw the
  // Runtime as unreachable. Only same-origin callers (the dashboard) were unaffected.
  const methods = captureCorsHeaders()['access-control-allow-methods'];
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.ok(method === 'OPTIONS' ? methods.includes('OPTIONS') : methods.includes(method), `CORS must allow ${method}`);
  }
});

test('CORS allows the api-key header a browser sends on every authenticated call', () => {
  const headers = captureCorsHeaders();
  assert.match(headers['access-control-allow-headers'], /x-portix-api-key/i);
  assert.equal(headers['access-control-allow-origin'], '*');
});
