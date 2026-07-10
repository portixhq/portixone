import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import nodeWindows from 'node-windows';
import winsw from 'node-windows/lib/winsw.js';

const { Service } = nodeWindows;
const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(runtimeRoot, '.data', 'config.json');

const SERVICE_NAME = 'PortixOne Runtime';

/**
 * Found via the same clean-machine test as the elevate.vbs fix above, one
 * layer deeper: a fresh install had no config.json yet, so ConfigService's
 * own hardcoded fallback ('mock' — kept for `npm run dev` and local testing
 * without hardware) became this *installed, packaged* Runtime's real
 * production default. It happily reported every print job "completed"
 * while never touching the spooler — the bug went unnoticed until physical
 * output was actually checked by hand.
 *
 * Only runs when config.json doesn't exist yet (a genuinely fresh install)
 * — never touches it on a reinstall/upgrade, so a user's own later choice
 * (e.g. switching to the 'network' driver for a LAN printer) persists
 * across service restarts instead of being silently reset back.
 */
function seedProductionDefaults() {
  if (existsSync(configPath)) {
    return;
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ printerDriver: 'windows-spooler' }, null, 2));
  console.log('Seeded config.json with printerDriver: "windows-spooler" (fresh install).');
}

/**
 * DELIBERATE CHOICE (2026-07-10), not a workaround to revert later: this
 * stopped calling node-windows' own svc.install()/svc.start() methods.
 *
 * Root cause, found via a genuinely clean-machine install test (Windows
 * Sandbox, build 10.0.26200): node-windows' internal daemon.execute() —
 * which svc.install()/svc.start() both go through to actually run the
 * generated wrapper's install/start commands — calls wincmd.isAdminUser()
 * and then, even when that correctly reports "yes, already admin" (verified:
 * `net session` was clean, LanmanServer was running), still routes the
 * actual command through wincmd.elevate() (bin/elevate/elevate.cmd ->
 * elevate.vbs) rather than running it directly. It has no "skip
 * re-elevating, we're already elevated" branch at all. In this test
 * environment, elevate.vbs failed outright with "There is no script engine
 * for file extension '.vbs'" — Windows Script Host had no VBScript engine
 * registered, for any caller — silently breaking service registration
 * during a real install with zero visible error (Setup's own Finished page
 * text is static and shows "success" regardless). Microsoft has been
 * actively deprecating VBScript, so this is a real risk on current Windows
 * builds generally, not just this one test environment.
 *
 * Fix: still use node-windows' Service class to *generate* the winsw
 * wrapper's exe/XML (proven, tested logic not worth reimplementing), but
 * invoke that generated executable's own `install`/`start` commands
 * directly via execFile below — no wincmd.elevate(), no VBScript, nothing
 * routed through a third-party elevation heuristic. This is the exact
 * command manually confirmed to work reliably in the Sandbox test.
 */
const svc = new Service({
  name: SERVICE_NAME,
  description:
    'PortixOne local hardware bridge — HTTP + WebSocket API for printing and other local devices.',
  script: join(runtimeRoot, 'scripts', 'service-entry.js'),
  // node-windows already restarts a crashed process with these exact values
  // by default (undocumented unless set explicitly — confirmed by reading
  // node_modules/node-windows/lib/daemon.js) — spelling them out here so
  // the "runs for days unattended" requirement is a deliberate choice, not
  // an accident of whatever the library's defaults happen to be.
  wait: 1,
  grow: 0.25,
  maxRestarts: 3,
  maxRetries: null,
  abortOnError: false,
});

const wrapperDir = svc.directory();
const wrapperExePath = join(wrapperDir, svc._exe);
const wrapperXmlPath = join(wrapperDir, `${svc.id}.xml`);

function runWrapperCommand(args) {
  return new Promise((resolve, reject) => {
    execFile(wrapperExePath, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${svc._exe} ${args.join(' ')} failed: ${(stderr || error.message).trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * node-windows' own `wait`/`grow`/`maxRestarts` above only cover the wrapped
 * Node script crashing (its wrapper process watches and restarts *that*).
 * This configures the outer Windows Service itself, at the SCM level, to
 * also restart on failure — a second layer in case the wrapper process is
 * the one that dies, not just the script inside it. `failureflag=1`
 * additionally makes the SCM apply these actions even when the process exits
 * non-zero without an unclean/crash-style termination — belt-and-suspenders,
 * not redundant with node-windows' own restart logic above.
 *
 * Uses `svc._exe` ("portixoneruntime.exe"), not SERVICE_NAME ("PortixOne
 * Runtime") — sc.exe only matches a service's actual internal ServiceName,
 * not its Display Name; passing the display name here returns without error
 * yet silently configures nothing. Found by testing a real reinstall over an
 * already-running service: an unrelated `net.exe stop "PortixOne Runtime"`
 * fix (portixone.iss's PrepareToInstall) surfaced this exact ServiceName-vs-
 * DisplayName distinction, which meant this function had been silently
 * failing the same way since it was first written.
 */
function configureRecovery() {
  execFile(
    'sc.exe',
    ['failure', svc._exe, 'reset=86400', 'actions=restart/5000/restart/5000/restart/60000'],
    (error) => {
      if (error) {
        console.error('Could not configure service recovery actions:', error.message);
        return;
      }
      execFile('sc.exe', ['failureflag', svc._exe, '1'], (flagError) => {
        if (flagError) {
          console.error('Could not set the failure-actions flag:', flagError.message);
        }
      });
    },
  );
}

async function main() {
  seedProductionDefaults();

  if (svc.exists) {
    // Found via a real reinstall-over-a-running-install test: portixone.iss
    // stops the old process before [Files] overwrites node.exe (so the file
    // isn't locked), but that leaves the freshly-updated service in a
    // Stopped state — svc.exists only checks that the wrapper's exe/xml
    // are present on disk, not whether it's currently running, so this
    // branch used to just log and return, silently leaving the upgrade
    // installed-but-stopped. winsw's `start` is a safe no-op if it's
    // somehow already running, so this always runs unconditionally rather
    // than checking status first.
    console.log('PortixOne Runtime service is already installed. Ensuring it is running...');
    try {
      await runWrapperCommand(['start']);
      console.log('PortixOne Runtime service is running.');
    } catch (error) {
      console.error('Could not (re)start the service:', error.message);
    }
    return;
  }

  mkdirSync(wrapperDir, { recursive: true });
  writeFileSync(wrapperXmlPath, svc._xml);
  await new Promise((resolve) => winsw.createExe(svc.id, wrapperDir, resolve));
  await runWrapperCommand(['install']);
  console.log('PortixOne Runtime service installed. Starting it...');
  await runWrapperCommand(['start']);
  console.log('PortixOne Runtime service is running.');
  configureRecovery();
}

main().catch((error) => {
  console.error('Service error:', error.message);
  process.exitCode = 1;
});
