import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkForUpdate,
  isNewer,
  parseRuntimeTag,
  selectRuntimeRelease,
  resolveChannel,
  type GithubRelease,
  type UpdateChannel,
} from './updater.js';

/** A release with both required assets, i.e. one that should not be rejected for missing files. */
function release(tag: string, opts: { prerelease?: boolean; draft?: boolean; assets?: string[] } = {}): GithubRelease {
  const assets = opts.assets ?? ['PortixOne-Setup.exe', 'SHA256SUMS.txt'];
  return {
    tag_name: tag,
    draft: opts.draft,
    prerelease: opts.prerelease,
    assets: assets.map((name) => ({ name, browser_download_url: `https://example.test/${tag}/${name}` })),
  };
}

const CURRENT = { major: 0, minor: 1, patch: 0, channel: 'stable' as UpdateChannel };

function reasonFor(tag: string, outcome: ReturnType<typeof selectRuntimeRelease>) {
  return outcome.rejected.find((r) => r.tag === tag)?.reason;
}

// ── Tag parsing ─────────────────────────────────────────────────────────────────────────────

test('an npm package tag is not a Runtime release — this is the bug that broke every update check', () => {
  assert.equal(parseRuntimeTag('sdk-v0.3.4'), undefined);
  assert.equal(parseRuntimeTag('protocol-v0.2.2'), undefined);
  assert.equal(parseRuntimeTag('shared-v0.2.0'), undefined);
});

test('runtime-v0.1.0 parses as stable', () => {
  assert.deepEqual(parseRuntimeTag('runtime-v0.1.0'), { major: 0, minor: 1, patch: 0, channel: 'stable', pre: undefined });
});

test('runtime-v0.1.1 parses as stable', () => {
  assert.deepEqual(parseRuntimeTag('runtime-v0.1.1'), { major: 0, minor: 1, patch: 1, channel: 'stable', pre: undefined });
});

test('runtime-v0.2.0-beta.1 parses as beta', () => {
  assert.deepEqual(parseRuntimeTag('runtime-v0.2.0-beta.1'), { major: 0, minor: 2, patch: 0, channel: 'beta', pre: 1 });
});

test('a plain tag flagged pre-release on GitHub is treated as internal, never stable', () => {
  // The published pilot (runtime-v0.1.0, marked pre-release) must not reach stable machines.
  assert.equal(parseRuntimeTag('runtime-v0.1.0', true)?.channel, 'internal');
  assert.equal(parseRuntimeTag('runtime-v0.1.0', false)?.channel, 'stable');
});

test('a malformed tag is rejected rather than half-parsed', () => {
  assert.equal(parseRuntimeTag('runtime-v1'), undefined);
  assert.equal(parseRuntimeTag('runtime-0.1.0'), undefined);
  assert.equal(parseRuntimeTag('v0.1.0'), undefined);
});

// ── Version precedence ──────────────────────────────────────────────────────────────────────

test('a stable release outranks the same version as a pre-release', () => {
  const stable = { major: 0, minor: 2, patch: 0, channel: 'stable' as UpdateChannel };
  const beta = { major: 0, minor: 2, patch: 0, channel: 'beta' as UpdateChannel, pre: 1 };
  assert.equal(isNewer(stable, beta), true);
  assert.equal(isNewer(beta, stable), false);
});

test('later pre-release iterations outrank earlier ones', () => {
  const b1 = { major: 0, minor: 2, patch: 0, channel: 'beta' as UpdateChannel, pre: 1 };
  const b2 = { major: 0, minor: 2, patch: 0, channel: 'beta' as UpdateChannel, pre: 2 };
  assert.equal(isNewer(b2, b1), true);
});

// ── Selection, per the ratified fixtures ────────────────────────────────────────────────────

test('sdk-v0.3.4 is ignored, runtime-v0.1.1 is selected', () => {
  const outcome = selectRuntimeRelease([release('sdk-v0.3.4'), release('runtime-v0.1.1')], 'stable', CURRENT);
  assert.equal(outcome.selected?.release.tag_name, 'runtime-v0.1.1');
  assert.equal(reasonFor('sdk-v0.3.4', outcome), 'not_a_runtime_release');
});

test('runtime-v0.2.0-beta.1 is selected ONLY on the beta channel', () => {
  const releases = [release('runtime-v0.2.0-beta.1', { prerelease: true })];

  const onStable = selectRuntimeRelease(releases, 'stable', CURRENT);
  assert.equal(onStable.selected, undefined);
  assert.equal(reasonFor('runtime-v0.2.0-beta.1', onStable), 'channel_mismatch');

  const onBeta = selectRuntimeRelease(releases, 'beta', CURRENT);
  assert.equal(onBeta.selected?.release.tag_name, 'runtime-v0.2.0-beta.1');
});

test('a release with no SHA256SUMS.txt is rejected — an unverifiable installer is worse than no update', () => {
  const outcome = selectRuntimeRelease(
    [release('runtime-v0.1.1', { assets: ['PortixOne-Setup.exe'] })],
    'stable',
    CURRENT,
  );
  assert.equal(outcome.selected, undefined);
  assert.equal(reasonFor('runtime-v0.1.1', outcome), 'missing_checksums');
});

test('a release with no installer asset is rejected', () => {
  const outcome = selectRuntimeRelease(
    [release('runtime-v0.1.1', { assets: ['SHA256SUMS.txt'] })],
    'stable',
    CURRENT,
  );
  assert.equal(reasonFor('runtime-v0.1.1', outcome), 'missing_installer');
});

test('a draft is never offered', () => {
  const outcome = selectRuntimeRelease([release('runtime-v0.9.0', { draft: true })], 'internal', CURRENT);
  assert.equal(outcome.selected, undefined);
  assert.equal(reasonFor('runtime-v0.9.0', outcome), 'draft');
});

test('downgrades are refused', () => {
  const outcome = selectRuntimeRelease([release('runtime-v0.0.9')], 'stable', CURRENT);
  assert.equal(outcome.selected, undefined);
  assert.equal(reasonFor('runtime-v0.0.9', outcome), 'not_newer');
});

test('the same version is not an update', () => {
  const outcome = selectRuntimeRelease([release('runtime-v0.1.0')], 'stable', CURRENT);
  assert.equal(reasonFor('runtime-v0.1.0', outcome), 'not_newer');
});

test('channels are inclusive downward: an internal machine still takes a newer stable', () => {
  const outcome = selectRuntimeRelease([release('runtime-v0.1.1')], 'internal', CURRENT);
  assert.equal(outcome.selected?.release.tag_name, 'runtime-v0.1.1');
});

test('the newest acceptable release wins, not merely the first in the feed', () => {
  const outcome = selectRuntimeRelease(
    [release('runtime-v0.1.1'), release('runtime-v0.3.0'), release('runtime-v0.2.0')],
    'stable',
    CURRENT,
  );
  assert.equal(outcome.selected?.release.tag_name, 'runtime-v0.3.0');
});

// ── The real published feed, reproduced ─────────────────────────────────────────────────────

test('REGRESSION: the live feed (SDK tags + a pre-release pilot) yields no update on stable, and no error', () => {
  // This is exactly what api.github.com returns today. The old code asked /releases/latest, got
  // sdk-v0.3.4, failed to parse it, and reported "Could not parse a version number to compare".
  const live = [
    release('sdk-v0.3.4'),
    release('protocol-v0.2.2'),
    release('sdk-v0.3.1'),
    release('runtime-v0.1.0', { prerelease: true }),
  ];
  const outcome = selectRuntimeRelease(live, 'stable', CURRENT);
  assert.equal(outcome.selected, undefined); // correct: the pilot is internal-only
  assert.equal(reasonFor('sdk-v0.3.4', outcome), 'not_a_runtime_release');
  assert.equal(reasonFor('runtime-v0.1.0', outcome), 'channel_mismatch');
});

test('an internal pilot machine DOES see a newer internal build', () => {
  const live = [release('sdk-v0.3.4'), release('runtime-v0.1.1', { prerelease: true })];
  const outcome = selectRuntimeRelease(live, 'internal', CURRENT);
  assert.equal(outcome.selected?.release.tag_name, 'runtime-v0.1.1');
});

// ── checkForUpdate wiring ───────────────────────────────────────────────────────────────────

test('checkForUpdate reports an update with both URLs, never a bare boolean', async () => {
  const result = await checkForUpdate({
    channel: 'stable',
    releases: [release('sdk-v0.3.4'), release('runtime-v0.1.1')],
  });
  assert.equal(result.checked, true);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, '0.1.1');
  assert.ok(result.downloadUrl?.endsWith('PortixOne-Setup.exe'));
  assert.ok(result.checksumsUrl?.endsWith('SHA256SUMS.txt'));
  assert.equal(result.installerFileName, 'PortixOne-Setup.exe');
});

test('checkForUpdate distinguishes "checked, up to date" from "could not check"', async () => {
  const upToDate = await checkForUpdate({ channel: 'stable', releases: [release('sdk-v0.3.4')] });
  assert.equal(upToDate.checked, true);
  assert.equal(upToDate.updateAvailable, false);
  assert.equal(upToDate.error, undefined);
  // And it says WHY it passed everything over, so the log is actionable.
  assert.ok((upToDate.rejected?.length ?? 0) > 0);
});

test('resolveChannel is stable unless a pilot opts in explicitly', () => {
  assert.equal(resolveChannel({}), 'stable');
  assert.equal(resolveChannel({ PORTIX_UPDATE_CHANNEL: 'nonsense' }), 'stable');
  assert.equal(resolveChannel({ PORTIX_UPDATE_CHANNEL: 'internal' }), 'internal');
  assert.equal(resolveChannel({ PORTIX_UPDATE_CHANNEL: 'beta' }), 'beta');
});
