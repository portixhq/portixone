import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';
import type { ClickEvent } from 'systray2';
import { checkRuntimeHealth } from './runtime-status.js';

// systray2 ships a .d.ts that NodeNext module resolution can't cleanly map
// to its CJS `exports.default = SysTray` output (no `__esModule` marker) —
// load it via a genuine `require()` instead of fighting the static import.
const require = createRequire(import.meta.url);
const { default: SysTray } = require('systray2') as typeof import('systray2');

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconPath = join(__dirname, '..', 'assets', 'icon.ico');
const daemonLogDir = join(__dirname, '..', '..', 'runtime', 'scripts', 'daemon');

const SERVICE_NAME = 'PortixOne Runtime';
const POLL_INTERVAL_MS = 5000;

const OPEN_LOGS = 'Open logs folder';
const RESTART_SERVICE = 'Restart service (needs admin)';
const QUIT = 'Quit';

const statusItem = {
  title: 'Checking runtime status…',
  tooltip: 'PortixOne Runtime status',
  checked: false,
  enabled: false,
};

const systray = new SysTray({
  menu: {
    icon: iconPath,
    title: 'PortixOne',
    tooltip: 'PortixOne Runtime',
    items: [
      statusItem,
      SysTray.separator,
      { title: OPEN_LOGS, tooltip: 'Open the service log folder', checked: false, enabled: true },
      { title: RESTART_SERVICE, tooltip: 'Stop and start the Windows Service', checked: false, enabled: true },
      SysTray.separator,
      { title: QUIT, tooltip: 'Quit this tray icon (the service keeps running)', checked: false, enabled: true },
    ],
  },
  debug: false,
});

await systray.onClick((action: ClickEvent) => {
  switch (action.item.title) {
    case OPEN_LOGS:
      exec(`explorer.exe "${daemonLogDir}"`);
      break;
    case RESTART_SERVICE:
      exec(`net stop "${SERVICE_NAME}" && net start "${SERVICE_NAME}"`, (error) => {
        if (error) {
          console.error(
            'Could not restart the service — re-run this tray app as Administrator, or restart it yourself via services.msc:',
            error.message,
          );
        }
      });
      break;
    case QUIT:
      void systray.kill(false);
      process.exit(0);
      break;
    default:
      break;
  }
});

async function pollStatus(): Promise<void> {
  const health = await checkRuntimeHealth();
  statusItem.title = health.online
    ? `● Runtime online${health.defaultPrinter ? ` — ${health.defaultPrinter}` : ''}`
    : '○ Runtime offline';
  await systray.sendAction({ type: 'update-item', item: statusItem });
}

await systray.ready();
await pollStatus();
setInterval(() => {
  void pollStatus();
}, POLL_INTERVAL_MS);
