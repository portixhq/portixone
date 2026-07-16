import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EscposBuilder } from './escpos.builder.js';

const ESC = 0x1b;
// ESC t 16 — select WPC1252.
const SELECT_CODEPAGE = Buffer.from([ESC, 0x74, 16]);
const INIT = Buffer.from([ESC, 0x40]);

// #6: every build starts by resetting AND selecting the WPC1252 code table, so
// the latin1 bytes below are interpreted as accented Latin characters.
test('output begins with INIT followed by the WPC1252 code-table select', () => {
  const out = new EscposBuilder().text('x').build();
  assert.deepEqual(out.subarray(0, INIT.length), INIT);
  assert.deepEqual(out.subarray(INIT.length, INIT.length + SELECT_CODEPAGE.length), SELECT_CODEPAGE);
});

// #6: accented text must be encoded latin1 (one byte/char), not utf-8 (two).
test('encodes accented characters as single latin1 bytes', () => {
  const out = new EscposBuilder().text('áñ¿°').build();
  // á=0xE1, ñ=0xF1, ¿=0xBF, °=0xB0 in latin1/WPC1252.
  assert.ok(out.includes(Buffer.from([0xe1, 0xf1, 0xbf, 0xb0])), 'expected latin1 bytes for áñ¿°');
  // The utf-8 lead byte 0xC3 must NOT appear — that would be mojibake on the printer.
  assert.equal(out.includes(0xc3), false, 'utf-8 encoding leaked into the output');
});

test('plain ASCII is unchanged and round-trips', () => {
  const out = new EscposBuilder().text('Coffee $4.00').build();
  assert.ok(out.includes(Buffer.from('Coffee $4.00', 'latin1')));
});
