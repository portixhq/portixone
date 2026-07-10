import { APP_VERSION } from '@portixone/shared';

const RELEASES_API_URL = 'https://api.github.com/repos/portixhq/portixone/releases/latest';
const REQUEST_TIMEOUT_MS = 5000;

export interface UpdateCheckResult {
  /** false if the check itself failed (network error, unparseable response) — distinct from "checked, no update". */
  checked: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
  /** The exact filename of the installer asset — needed to look it up by name inside SHA256SUMS.txt. */
  installerFileName?: string;
  /** SHA256SUMS.txt's own download URL, published alongside the installer by installer/release.js — undefined if this release predates that. */
  checksumsUrl?: string;
  error?: string;
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubReleaseAsset[];
}

type SemVer = [number, number, number];

function parseVersion(tag: string): SemVer | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(latest: SemVer, current: SemVer): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (latest[i] !== current[i]) {
      return latest[i] > current[i];
    }
  }
  return false;
}

/**
 * Checks GitHub Releases for a newer published installer than this build.
 * As of this writing the repo has no releases published yet, so a 404 here
 * is the real, expected, common case — not an error condition.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const base = { checked: false, updateAvailable: false, currentVersion: APP_VERSION };
  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404) {
      return { ...base, checked: true };
    }
    if (!response.ok) {
      return { ...base, error: `GitHub returned ${response.status}` };
    }

    const release = (await response.json()) as GithubRelease;
    const latestVersion = parseVersion(release.tag_name);
    const currentVersion = parseVersion(APP_VERSION);
    if (!latestVersion || !currentVersion) {
      return { ...base, checked: true, error: 'Could not parse a version number to compare' };
    }

    const asset = release.assets.find((candidate) => candidate.name.endsWith('.exe'));
    const checksumsAsset = release.assets.find((candidate) => candidate.name === 'SHA256SUMS.txt');
    return {
      checked: true,
      updateAvailable: isNewer(latestVersion, currentVersion),
      currentVersion: APP_VERSION,
      latestVersion: release.tag_name,
      downloadUrl: asset?.browser_download_url,
      installerFileName: asset?.name,
      checksumsUrl: checksumsAsset?.browser_download_url,
    };
  } catch (error) {
    return { ...base, error: (error as Error).message };
  }
}
