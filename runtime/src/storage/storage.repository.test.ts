import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { StorageRepository } from './storage.repository.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portix-storage-'));
  file = join(dir, 'state.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('round-trips data', () => {
  const repo = new StorageRepository<{ a: number }>(file);
  repo.write({ a: 1 });
  assert.deepEqual(repo.read(), { a: 1 });
});

test('read returns undefined when the file does not exist', () => {
  assert.equal(new StorageRepository(file).read(), undefined);
});

test('overwrites atomically and leaves no temp files behind', () => {
  const repo = new StorageRepository<{ v: number }>(file);
  repo.write({ v: 1 });
  repo.write({ v: 2 });
  assert.deepEqual(repo.read(), { v: 2 });
  const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('a failed write preserves the previous file intact (the core atomicity guarantee)', () => {
  const repo = new StorageRepository<unknown>(file);
  repo.write({ good: true });

  // A circular structure makes JSON.stringify throw — since we serialize BEFORE touching the file,
  // the write must fail without corrupting or truncating what's already on disk.
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => repo.write(circular));

  // The previous, valid JSON is still there and still parses.
  assert.deepEqual(repo.read(), { good: true });
});

test('sweeps orphan temp files from a previously interrupted write', () => {
  mkdirSync(dir, { recursive: true });
  const orphan = join(dir, `.${'state.json'}.999.123.1.tmp`);
  writeFileSync(orphan, 'garbage');
  const repo = new StorageRepository<{ ok: boolean }>(file);
  repo.write({ ok: true });
  assert.equal(existsSync(orphan), false);
  assert.deepEqual(repo.read(), { ok: true });
});
