import { APP_VERSION } from '@portixone/shared';

/**
 * ── Runtime update discovery ────────────────────────────────────────────────────────────────
 *
 * Deliberately NOT `/releases/latest`. This repo publishes releases for several different products
 * from one feed — the Runtime installer, but also npm package tags (`sdk-v0.3.4`,
 * `protocol-v0.2.2`, …). `/releases/latest` answers with whichever of those is newest regardless of
 * what it is, so it kept returning an SDK tag: a release with no installer and a version number
 * that isn't the Runtime's. The old parser then failed on `sdk-v0.3.4` and the whole check died
 * with "Could not parse a version number to compare" — silently, on every install, forever.
 *
 * So: list every release and select by the Runtime's own tag convention. This makes updates
 * independent of which release happens to hold the repo's "Latest" pointer, which is the invariant
 * that was violated (publishing an npm tag must never be able to break the Runtime updater).
 *
 * TRANSITIONAL: the intended end state is a product-owned signed manifest
 * (`https://releases.portix.one/runtime/<channel>.json`) that doesn't depend on GitHub's release
 * feed at all. This module is shaped so that swapping the discovery source touches only
 * `fetchReleases()` — the channel/selection/rejection logic stays as-is.
 */
const RELEASES_API_URL = 'https://api.github.com/repos/portixhq/portixone/releases?per_page=100';
const REQUEST_TIMEOUT_MS = 5000;

/**
 * The Runtime's release tag convention:
 *   `runtime-v0.1.0`            → stable
 *   `runtime-v0.2.0-beta.1`     → beta
 *   `runtime-v0.1.1-internal.2` → internal
 *
 * The `runtime-` prefix is what separates a Runtime release from an npm package tag in the same
 * feed. A Runtime release published without it is invisible to every installed tray.
 */
const RUNTIME_TAG_PATTERN = /^runtime-v(\d+)\.(\d+)\.(\d+)(?:-(beta|internal)\.(\d+))?$/;

export type UpdateChannel = 'stable' | 'beta' | 'internal';

/** Channels are inclusive downward: a beta machine still takes a newer stable, never the reverse. */
const CHANNEL_ACCEPTS: Record<UpdateChannel, ReadonlySet<UpdateChannel>> = {
  stable: new Set<UpdateChannel>(['stable']),
  beta: new Set<UpdateChannel>(['stable', 'beta']),
  internal: new Set<UpdateChannel>(['stable', 'beta', 'internal']),
};

/** Why a release in the feed was not selected. Surfaced so a check never fails silently. */
export type RejectionReason =
  | 'not_a_runtime_release'
  | 'draft'
  | 'channel_mismatch'
  | 'missing_installer'
  | 'missing_checksums'
  | 'not_newer';

export interface RejectedRelease {
  tag: string;
  reason: RejectionReason;
}

export interface UpdateCheckResult {
  /** false if the check itself failed (network error, unparseable response) — distinct from "checked, no update". */
  checked: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  channel: UpdateChannel;
  latestVersion?: string;
  downloadUrl?: string;
  /** The exact filename of the installer asset — needed to look it up by name inside SHA256SUMS.txt. */
  installerFileName?: string;
  /** SHA256SUMS.txt's own download URL, published alongside the installer by installer/release.js. */
  checksumsUrl?: string;
  /** Every candidate that was passed over, and why — the raw material for an actionable log line. */
  rejected?: RejectedRelease[];
  error?: string;
}

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GithubRelease {
  tag_name: string;
  assets: GithubReleaseAsset[];
  draft?: boolean;
  prerelease?: boolean;
}

interface RuntimeVersion {
  major: number;
  minor: number;
  patch: number;
  channel: UpdateChannel;
  /** The `.N` of `-beta.N` / `-internal.N`; absent on a stable tag. */
  pre?: number;
}

/** Parses this build's own version (a bare semver like `0.1.0`), not a release tag. */
export function parseAppVersion(version: string): RuntimeVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), channel: 'stable' };
}

/**
 * Parses a Runtime release tag. Returns undefined for anything that isn't one — an npm package tag,
 * a malformed tag, a tag from some future product. `ghPrerelease` is a safety input, not decoration:
 * a stable-looking tag that GitHub has flagged as a pre-release is treated as `internal`, never as
 * stable, so a pilot build published under a plain tag can't be pushed to everyone by accident.
 */
export function parseRuntimeTag(tag: string, ghPrerelease = false): RuntimeVersion | undefined {
  const match = RUNTIME_TAG_PATTERN.exec(tag);
  if (!match) {
    return undefined;
  }
  const [, major, minor, patch, suffix, pre] = match;
  const channel: UpdateChannel = suffix ? (suffix as UpdateChannel) : ghPrerelease ? 'internal' : 'stable';
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    channel,
    pre: pre === undefined ? undefined : Number(pre),
  };
}

/** Standard semver precedence: a pre-release sorts below the same stable version. */
export function isNewer(candidate: RuntimeVersion, current: RuntimeVersion): boolean {
  const triple: (keyof RuntimeVersion)[] = ['major', 'minor', 'patch'];
  for (const part of triple) {
    if (candidate[part] !== current[part]) {
      return (candidate[part] as number) > (current[part] as number);
    }
  }
  if (candidate.pre === undefined && current.pre !== undefined) {
    return true; // 0.2.0 beats 0.2.0-beta.1
  }
  if (candidate.pre !== undefined && current.pre === undefined) {
    return false;
  }
  if (candidate.pre !== undefined && current.pre !== undefined) {
    return candidate.pre > current.pre;
  }
  return false;
}

export function formatVersion(v: RuntimeVersion): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  return v.pre === undefined ? base : `${base}-${v.channel}.${v.pre}`;
}

export interface SelectionOutcome {
  selected?: { release: GithubRelease; version: RuntimeVersion };
  rejected: RejectedRelease[];
}

/**
 * Picks the newest Runtime release the given channel will accept, and reports what it passed over.
 *
 * Rejects, explicitly and traceably: releases of other products, drafts, releases from a channel
 * this machine doesn't follow, releases with no installer asset, and — importantly — releases with
 * no `SHA256SUMS.txt`, because the tray refuses to run an installer it cannot verify. A release we
 * can't verify is worse than no update at all.
 */
export function selectRuntimeRelease(
  releases: GithubRelease[],
  channel: UpdateChannel,
  current: RuntimeVersion,
): SelectionOutcome {
  const accepts = CHANNEL_ACCEPTS[channel];
  const rejected: RejectedRelease[] = [];
  let selected: { release: GithubRelease; version: RuntimeVersion } | undefined;

  for (const release of releases) {
    const tag = release.tag_name;

    if (release.draft) {
      rejected.push({ tag, reason: 'draft' });
      continue;
    }
    const version = parseRuntimeTag(tag, release.prerelease === true);
    if (!version) {
      rejected.push({ tag, reason: 'not_a_runtime_release' });
      continue;
    }
    if (!accepts.has(version.channel)) {
      rejected.push({ tag, reason: 'channel_mismatch' });
      continue;
    }
    if (!release.assets.some((a) => a.name.endsWith('.exe'))) {
      rejected.push({ tag, reason: 'missing_installer' });
      continue;
    }
    if (!release.assets.some((a) => a.name === 'SHA256SUMS.txt')) {
      // No checksums means no verification path, and we never run an unverified installer.
      rejected.push({ tag, reason: 'missing_checksums' });
      continue;
    }
    if (!isNewer(version, current)) {
      rejected.push({ tag, reason: 'not_newer' });
      continue;
    }
    if (!selected || isNewer(version, selected.version)) {
      selected = { release, version };
    }
  }

  return { selected, rejected };
}

/** Resolves the channel this installation follows. Defaults to `stable` — pilots opt in explicitly. */
export function resolveChannel(env: NodeJS.ProcessEnv = process.env): UpdateChannel {
  const configured = env.PORTIX_UPDATE_CHANNEL;
  if (configured === 'beta' || configured === 'internal' || configured === 'stable') {
    return configured;
  }
  return 'stable';
}

async function fetchReleases(): Promise<GithubRelease[] | { error: string; status?: number }> {
  const response = await fetch(RELEASES_API_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    return { error: `GitHub returned ${response.status}`, status: response.status };
  }
  return (await response.json()) as GithubRelease[];
}

/**
 * Checks for a newer Runtime installer than this build on the configured channel.
 *
 * `checked: false` means the check itself couldn't run (offline, API error) — that is NOT the same
 * as "you're up to date", and the tray must not render it as such.
 */
export async function checkForUpdate(
  options: { channel?: UpdateChannel; releases?: GithubRelease[] } = {},
): Promise<UpdateCheckResult> {
  const channel = options.channel ?? resolveChannel();
  const base = { checked: false, updateAvailable: false, currentVersion: APP_VERSION, channel };

  const current = parseAppVersion(APP_VERSION);
  if (!current) {
    return { ...base, error: `This build's own version (${APP_VERSION}) is not parseable` };
  }

  try {
    const releases = options.releases ?? (await fetchReleases());
    if (!Array.isArray(releases)) {
      return { ...base, error: releases.error };
    }

    const { selected, rejected } = selectRuntimeRelease(releases, channel, current);
    if (!selected) {
      return { ...base, checked: true, rejected };
    }

    const installer = selected.release.assets.find((a) => a.name.endsWith('.exe'))!;
    const checksums = selected.release.assets.find((a) => a.name === 'SHA256SUMS.txt')!;
    return {
      checked: true,
      updateAvailable: true,
      currentVersion: APP_VERSION,
      channel,
      latestVersion: formatVersion(selected.version),
      downloadUrl: installer.browser_download_url,
      installerFileName: installer.name,
      checksumsUrl: checksums.browser_download_url,
      rejected,
    };
  } catch (error) {
    return { ...base, error: (error as Error).message };
  }
}
