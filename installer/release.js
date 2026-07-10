import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after portixone.iss (and, optionally, build-portable.js) have
// produced their output in installer/dist/ — this doesn't build anything
// itself, it just publishes a checksum and release notes for whatever
// artifacts are already there (installer/README.md's Definition of Done:
// "Hash SHA256 publicado", "Release Notes").
const installerDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(installerDir, '..');
const distDir = join(installerDir, 'dist');

const ARTIFACT_PATTERN = /^PortixOne-.*\.exe$|^PortixOneRuntimePortable\.zip$/;

function findArtifacts() {
  const entries = readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ARTIFACT_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) {
    throw new Error(
      `No release artifacts found in ${distDir} — compile portixone.iss and/or run build-portable.js first.`,
    );
  }
  return entries;
}

function writeChecksums(artifacts) {
  const lines = artifacts.map((name) => {
    const hash = createHash('sha256').update(readFileSync(join(distDir, name))).digest('hex');
    return `${hash}  ${name}`;
  });
  const outPath = join(distDir, 'SHA256SUMS.txt');
  writeFileSync(outPath, `${lines.join('\n')}\n`);
  return outPath;
}

/** Extracts the topmost dated section of CHANGELOG.md — "whatever shipped most recently" rather than a version-keyed lookup, since this changelog is organized by milestone/date, not by semver entry. */
function extractLatestChangelogSection() {
  const changelog = readFileSync(join(rootDir, 'CHANGELOG.md'), 'utf-8');
  const headingPattern = /^## .+$/m;
  const firstMatch = headingPattern.exec(changelog);
  if (!firstMatch) {
    throw new Error('Could not find a "## " section heading in CHANGELOG.md to extract release notes from.');
  }
  const startIndex = firstMatch.index;
  const rest = changelog.slice(startIndex + firstMatch[0].length);
  const nextMatch = headingPattern.exec(rest);
  const sectionBody = nextMatch ? rest.slice(0, nextMatch.index) : rest;
  return `${firstMatch[0]}${sectionBody}`.trim();
}

function writeReleaseNotes(version, artifacts) {
  const section = extractLatestChangelogSection();
  const body = [
    `# PortixOne Runtime ${version} — Release Notes`,
    '',
    `Generated ${new Date().toISOString()} from CHANGELOG.md's latest entry.`,
    '',
    `**Artifacts:** ${artifacts.join(', ')}`,
    '',
    section,
    '',
  ].join('\n');
  const outPath = join(distDir, 'RELEASE_NOTES.md');
  writeFileSync(outPath, body);
  return outPath;
}

function main() {
  const rootPackageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
  const version = rootPackageJson.version;

  const artifacts = findArtifacts();
  console.log(`Found artifacts: ${artifacts.join(', ')}`);

  const checksumsPath = writeChecksums(artifacts);
  console.log(`Wrote ${checksumsPath}`);

  const notesPath = writeReleaseNotes(version, artifacts);
  console.log(`Wrote ${notesPath}`);
}

main();
