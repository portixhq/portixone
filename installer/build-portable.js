import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Packages installer/staging/{node,runtime,tray} — already built by
// build-staging.js — into a no-install, no-admin, no-Windows-Service zip.
// Unlike the full PortixOne installer (portixone.iss), this doesn't survive
// a reboot or run without a logged-in user; it's for quick local testing or
// environments where installing a service isn't wanted. See ROADMAP.md Fase 4.
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const stagingDir = join(rootDir, 'installer', 'staging');
const distDir = join(rootDir, 'installer', 'dist');
const portableDir = join(distDir, 'PortixOneRuntimePortable');

if (!existsSync(join(stagingDir, 'node', 'node.exe'))) {
  throw new Error('installer/staging is missing or incomplete — run `node installer/build-staging.js` first.');
}

rmSync(portableDir, { recursive: true, force: true });
mkdirSync(portableDir, { recursive: true });

for (const dir of ['node', 'runtime', 'tray']) {
  cpSync(join(stagingDir, dir), join(portableDir, dir), { recursive: true });
}

// Same fix as runtime/scripts/service.install.js's seedProductionDefaults(),
// applied at build time instead of first-run time since the portable build
// has no install step to hook into: without this, ConfigService's own
// hardcoded 'mock' fallback (kept for `npm run dev` and local testing
// without hardware) would silently become this *packaged* Runtime's
// production default too — reporting every print job "completed" while
// never touching the spooler. Only writes if absent, so re-running this
// build script never clobbers a config a previous run of the portable
// Runtime itself may have already written.
const portableConfigPath = join(portableDir, 'runtime', '.data', 'config.json');
if (!existsSync(portableConfigPath)) {
  mkdirSync(dirname(portableConfigPath), { recursive: true });
  writeFileSync(portableConfigPath, JSON.stringify({ printerDriver: 'windows-spooler' }, null, 2));
}

writeFileSync(
  join(portableDir, 'Start PortixOne.bat'),
  [
    '@echo off',
    'cd /d "%~dp0runtime"',
    'start "PortixOne Runtime" /min ..\\node\\node.exe --env-file-if-exists=.env dist\\index.js',
    'cd /d "%~dp0tray"',
    // powershell.exe -WindowStyle Hidden + launch-hidden.ps1, not node.exe
    // directly — a console window can only be minimized, not hidden, so
    // it'd flash and sit in the taskbar. See tray/launch-hidden.ps1's own
    // comment for why this isn't wscript.exe + a .vbs anymore.
    'powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File launch-hidden.ps1',
    '',
  ].join('\r\n'),
);

writeFileSync(
  join(portableDir, 'README.txt'),
  [
    'PortixOne Runtime -- Portable',
    '',
    'No installation, no admin rights, no Windows Service -- everything here',
    'runs directly out of this folder using the bundled Node.js runtime.',
    '',
    'To start: double-click "Start PortixOne.bat". One minimized console',
    'window opens for the Runtime; the Tray runs fully hidden in the',
    'background -- look for its icon in the system tray (you may need to',
    'click the "^" arrow to see hidden icons).',
    'To stop: close the Runtime window, and use the tray icon\'s "Close',
    'Tray" menu item (or end both from Task Manager).',
    '',
    'This does NOT auto-start on boot and does NOT run without a user',
    'logged in. For that, use the full PortixOne installer instead, which',
    'registers a proper Windows Service.',
  ].join('\r\n'),
);

const zipPath = join(distDir, 'PortixOneRuntimePortable.zip');
rmSync(zipPath, { force: true });
execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path "${portableDir}\\*" -DestinationPath "${zipPath}" -Force`,
]);

console.log(`\nPortable build complete: ${zipPath}`);
