import { cpSync, rmSync, mkdirSync, existsSync, realpathSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Assembles a clean, production-only deployable copy of the runtime and tray
// apps under installer/staging/ — no devDependencies, no TypeScript source,
// no workspace symlinks (Inno Setup just zips this folder up as-is). Deps
// are the exact production closure per `npm ls --omit=dev --all -w <app>`.
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const stagingDir = join(rootDir, 'installer', 'staging');
const cacheDir = join(rootDir, 'installer', '.cache');

// Embedded so end users never need Node.js pre-installed — see ROADMAP.md
// Fase 4. Pinned to a specific version rather than "latest" so builds are
// reproducible; bump deliberately for security patches.
const EMBEDDED_NODE_VERSION = '20.20.2';

async function ensureEmbeddedNode() {
  const versionDir = join(cacheDir, `node-v${EMBEDDED_NODE_VERSION}-win-x64`);
  const nodeExePath = join(versionDir, 'node.exe');
  if (existsSync(nodeExePath)) {
    console.log(`Using cached embedded Node v${EMBEDDED_NODE_VERSION}`);
    return nodeExePath;
  }

  console.log(`Downloading embedded Node v${EMBEDDED_NODE_VERSION}...`);
  const fileName = `node-v${EMBEDDED_NODE_VERSION}-win-x64.zip`;
  const distBase = `https://nodejs.org/dist/v${EMBEDDED_NODE_VERSION}`;
  mkdirSync(cacheDir, { recursive: true });

  const zipRes = await fetch(`${distBase}/${fileName}`);
  if (!zipRes.ok) throw new Error(`Failed to download ${fileName}: HTTP ${zipRes.status}`);
  const zipPath = join(cacheDir, fileName);
  writeFileSync(zipPath, Buffer.from(await zipRes.arrayBuffer()));

  // Verify against Node's published checksums before extracting/shipping
  // an executable — this file ends up running with a user's admin rights.
  const shasumsRes = await fetch(`${distBase}/SHASUMS256.txt`);
  if (!shasumsRes.ok) throw new Error(`Failed to fetch SHASUMS256.txt: HTTP ${shasumsRes.status}`);
  const shasums = await shasumsRes.text();
  const expectedLine = shasums.split('\n').find((line) => line.trim().endsWith(fileName));
  if (!expectedLine) throw new Error(`No checksum entry found for ${fileName} in SHASUMS256.txt`);
  const expectedHash = expectedLine.trim().split(/\s+/)[0];
  const actualHash = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  if (actualHash !== expectedHash) {
    rmSync(zipPath, { force: true });
    throw new Error(`Checksum mismatch for ${fileName}: expected ${expectedHash}, got ${actualHash}`);
  }

  execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${cacheDir}" -Force`,
  ]);
  rmSync(zipPath, { force: true });

  if (!existsSync(nodeExePath)) {
    throw new Error(`node.exe not found at ${nodeExePath} after extracting ${fileName}`);
  }
  return nodeExePath;
}

const WORKSPACE_SCOPE = '@portixone/';

const RUNTIME_DEPS = [
  '@portixone/escpos',
  '@portixone/protocol',
  '@portixone/shared',
  'zod',
  'node-windows',
  'xml',
  'yargs',
  'cliui',
  'string-width',
  'strip-ansi',
  'ansi-regex',
  'wrap-ansi',
  'ansi-styles',
  'color-convert',
  'color-name',
  'escalade',
  'get-caller-file',
  'require-directory',
  'emoji-regex',
  'is-fullwidth-code-point',
  'y18n',
  'yargs-parser',
  'ws',
  'bufferutil',
  'utf-8-validate',
];

const TRAY_DEPS = [
  '@portixone/protocol',
  '@portixone/shared',
  // @portixone/protocol's schema validation imports zod at runtime — missing
  // here crashed the packaged tray on startup with ERR_MODULE_NOT_FOUND
  // (found by actually running the staged output, not just building it).
  'zod',
  'systray2',
  'debug',
  'ms',
  'fs-extra',
  'graceful-fs',
  'jsonfile',
  'universalify',
  // node-notifier (pairing-request toasts) and its own dependency closure
  'node-notifier',
  'growly',
  'is-wsl',
  'is-docker',
  'semver',
  'shellwords',
  'uuid',
  'which',
  'isexe',
];

function copyDependency(name, destNodeModules) {
  const src = join(rootDir, 'node_modules', name);
  if (!existsSync(src)) {
    console.warn(`  (skip) ${name} — not installed (likely an optional native dep)`);
    return;
  }
  const resolved = realpathSync(src);
  const dest = join(destNodeModules, name);
  mkdirSync(dirname(dest), { recursive: true });

  if (name.startsWith(WORKSPACE_SCOPE)) {
    // Local workspace package — only ship its build output, not TS source.
    mkdirSync(dest, { recursive: true });
    cpSync(join(resolved, 'package.json'), join(dest, 'package.json'));
    if (existsSync(join(resolved, 'dist'))) {
      cpSync(join(resolved, 'dist'), join(dest, 'dist'), { recursive: true });
    }
  } else {
    cpSync(resolved, dest, { recursive: true, dereference: true });
  }
}

function stageApp(appName, deps, extraFiles) {
  const src = join(rootDir, appName);
  const dest = join(stagingDir, appName);
  console.log(`Staging ${appName}...`);
  mkdirSync(dest, { recursive: true });
  cpSync(join(src, 'dist'), join(dest, 'dist'), { recursive: true });
  cpSync(join(src, 'package.json'), join(dest, 'package.json'));
  for (const file of extraFiles) {
    if (existsSync(join(src, file))) {
      cpSync(join(src, file), join(dest, file), { recursive: true });
    }
  }
  const destNodeModules = join(dest, 'node_modules');
  for (const dep of deps) {
    copyDependency(dep, destNodeModules);
  }
}

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

const embeddedNodeExe = await ensureEmbeddedNode();
mkdirSync(join(stagingDir, 'node'), { recursive: true });
cpSync(embeddedNodeExe, join(stagingDir, 'node', 'node.exe'));

stageApp('runtime', RUNTIME_DEPS, ['scripts', '.env.example']);
stageApp('tray', TRAY_DEPS, ['assets', 'launch-hidden.ps1']);

// The generated node-windows daemon wrapper/logs are machine-specific —
// never ship them, `service.install.js` (re)creates them on the target.
rmSync(join(stagingDir, 'runtime', 'scripts', 'daemon'), { recursive: true, force: true });

console.log(`\nStaging complete: ${stagingDir}`);
