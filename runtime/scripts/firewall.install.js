import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_RUNTIME_PORT } from '@portixone/shared';

const execFileAsync = promisify(execFile);
const RULE_NAME = 'PortixOne Runtime';

// Mirrors exactly how ConfigService resolves the port at boot
// (config.service.ts: `PORTIX_RUNTIME_PORT` env override, else the shared
// default) so this rule always matches the port the Runtime will actually
// listen on, without duplicating that value as a second hardcoded literal.
const port = Number(process.env.PORTIX_RUNTIME_PORT) || DEFAULT_RUNTIME_PORT;

async function run() {
  // Reinstalling/upgrading shouldn't stack duplicate rules — delete any
  // existing one first (same idempotency pattern as killing a stale tray
  // process before reinstalling, in portixone.iss's PrepareToInstall).
  await execFileAsync('netsh.exe', ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NAME}`]).catch(() => {});

  // Scoped to Private/Domain profiles, not Public — the Runtime only needs
  // to be LAN-reachable (see ROADMAP.md Fase 5's private-network pairing
  // auto-trust), and Private/Domain is the standard Windows convention for
  // that; opening it on Public networks too would be needless exposure.
  await execFileAsync('netsh.exe', [
    'advfirewall',
    'firewall',
    'add',
    'rule',
    `name=${RULE_NAME}`,
    'dir=in',
    'action=allow',
    'protocol=TCP',
    `localport=${port}`,
    'profile=private,domain',
  ]);
  console.log(`Firewall rule added for TCP port ${port} (Private/Domain profiles).`);
}

run().catch((error) => {
  // Non-fatal on purpose: localhost-only usage still works without this
  // rule, so a failure here shouldn't fail the whole install.
  console.error('Could not configure firewall rule:', error.message);
});
