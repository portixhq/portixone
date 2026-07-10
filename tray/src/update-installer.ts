import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

/** Thrown for every way the downloaded installer failed to verify — distinct type so callers can tell this apart from a plain network/IO failure. */
export class InstallerVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallerVerificationError';
  }
}

async function fetchExpectedHash(checksumsUrl: string, fileName: string): Promise<string> {
  const response = await fetch(checksumsUrl);
  if (!response.ok) {
    throw new InstallerVerificationError(`Failed to download SHA256SUMS.txt (${response.status}) — refusing to install unverified.`);
  }
  const text = await response.text();
  // installer/release.js's own format: "<hash>  <filename>", one per line.
  const line = text.split('\n').find((candidate) => candidate.trim().endsWith(fileName));
  if (!line) {
    throw new InstallerVerificationError(`No checksum entry for "${fileName}" in SHA256SUMS.txt — refusing to install unverified.`);
  }
  return line.trim().split(/\s+/)[0];
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Downloads the installer asset, verifies its SHA256 against the release's
 * published SHA256SUMS.txt (installer/release.js), and only then launches it
 * silently. Fails closed: no checksums asset, a download failure, or a hash
 * mismatch all refuse to run the installer rather than falling back to
 * "unverified but probably fine" — this is the one place a downloaded binary
 * runs with the elevation an install needs, so it's the one place a
 * compromised or tampered release actually matters.
 *
 * Uses the same `/VERYSILENT /CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS`
 * flags documented in installer/README.md for a scripted install over a
 * running tray/service — the installer's own `PrepareToInstall` step
 * (portixone.iss) already kills this tray process and the [Run] section
 * relaunches it after reinstalling, so nothing more needs to happen here
 * once it's spawned.
 */
export async function downloadAndRunInstaller(
  downloadUrl: string,
  installerFileName: string | undefined,
  checksumsUrl: string | undefined,
): Promise<void> {
  if (!installerFileName || !checksumsUrl) {
    throw new InstallerVerificationError(
      'This release has no published checksum — refusing to install an unverified update.',
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'portix-update-'));
  const installerPath = join(dir, installerFileName);

  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download installer (${response.status})`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(installerPath));

  const expectedHash = await fetchExpectedHash(checksumsUrl, installerFileName);
  const actualHash = sha256File(installerPath);
  if (actualHash !== expectedHash) {
    throw new InstallerVerificationError(
      `Downloaded installer does not match its published checksum (expected ${expectedHash}, got ${actualHash}) — refusing to run it.`,
    );
  }

  spawn(installerPath, ['/VERYSILENT', '/CLOSEAPPLICATIONS', '/FORCECLOSEAPPLICATIONS'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}
