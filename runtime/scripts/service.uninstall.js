import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import nodeWindows from 'node-windows';

const { Service } = nodeWindows;
const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const SERVICE_NAME = 'PortixOne Runtime';

/**
 * Bypasses node-windows' own svc.uninstall()/svc.stop() — same reasoning as
 * service.install.js: both route their actual privileged command through
 * daemon.execute(), which calls wincmd.elevate() (bin/elevate/elevate.cmd ->
 * elevate.vbs) unconditionally, even when already running elevated. See
 * service.install.js's comment for the full root cause (found via a
 * genuinely clean-machine test — Windows Sandbox, build 10.0.26200 — where
 * Windows Script Host had no VBScript engine registered at all).
 *
 * Stops the service via sc.exe directly, then unregisters it via the
 * wrapper exe's own `uninstall` command — the same one node-windows would
 * have run, just invoked directly instead of through elevate.vbs. Doesn't
 * replicate node-windows' own file cleanup (wrapper.log/xml/exe/etc.):
 * portixone.iss's own [UninstallDelete] already force-removes the whole
 * daemon folder afterwards, so redoing that here would just be redundant.
 */
const svc = new Service({
  name: SERVICE_NAME,
  script: join(runtimeRoot, 'scripts', 'service-entry.js'),
});

const wrapperExePath = join(svc.directory(), svc._exe);

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

function stopService() {
  return new Promise((resolve) => {
    // Non-fatal either way: "service not running" is the common, expected
    // case on an already-stopped install — uninstall should proceed regardless.
    execFile('sc.exe', ['stop', SERVICE_NAME], () => resolve());
  });
}

async function main() {
  if (!svc.exists) {
    console.log('PortixOne Runtime service is already uninstalled.');
    return;
  }
  await stopService();
  await runWrapperCommand(['uninstall']);
  console.log('PortixOne Runtime service uninstalled.');
}

main().catch((error) => {
  console.error('Service error:', error.message);
  process.exitCode = 1;
});
