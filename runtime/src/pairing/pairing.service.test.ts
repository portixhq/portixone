import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PairingService } from './pairing.service.js';
import { PairingStore } from './pairing.store.js';

// Same alphabet as pairing.service.ts (ambiguous chars excluded).
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

// A request with no origin stays pending (not loopback-approved), so this
// exercises code generation without persisting anything to disk.
function newService(): PairingService {
  return new PairingService(new PairingStore());
}

// S3: crypto-generated codes must still be well-formed and only use the charset.
test('generates codes matching the XXXX-XXXX charset pattern', () => {
  const service = newService();
  for (let i = 0; i < 500; i += 1) {
    const { code } = service.request('tenant', `app-${i}`);
    assert.match(code, CODE_PATTERN, `bad code: ${code}`);
  }
});

test('randomInt never produces an out-of-range (undefined) character', () => {
  const service = newService();
  for (let i = 0; i < 500; i += 1) {
    const { code } = service.request('tenant', `app-${i}`);
    assert.equal(code.includes('undefined'), false);
  }
});
