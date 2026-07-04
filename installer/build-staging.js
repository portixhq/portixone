import { cpSync, rmSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Assembles a clean, production-only deployable copy of the runtime and tray
// apps under installer/staging/ — no devDependencies, no TypeScript source,
// no workspace symlinks (Inno Setup just zips this folder up as-is). Deps
// are the exact production closure per `npm ls --omit=dev --all -w <app>`.
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const stagingDir = join(rootDir, 'installer', 'staging');

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

const TRAY_DEPS = ['@portixone/shared', 'systray2', 'debug', 'ms', 'fs-extra', 'graceful-fs', 'jsonfile', 'universalify'];

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

stageApp('runtime', RUNTIME_DEPS, ['scripts', '.env.example']);
stageApp('tray', TRAY_DEPS, ['assets']);

// The generated node-windows daemon wrapper/logs are machine-specific —
// never ship them, `service.install.js` (re)creates them on the target.
rmSync(join(stagingDir, 'runtime', 'scripts', 'daemon'), { recursive: true, force: true });

console.log(`\nStaging complete: ${stagingDir}`);
