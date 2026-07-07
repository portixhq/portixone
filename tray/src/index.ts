import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';
import notifier from 'node-notifier';
import type { ClickEvent, Menu, MenuItem } from 'systray2';
import { APP_VERSION } from '@portixone/shared';
import type { PendingPairingSummary, PrinterInfo } from '@portixone/protocol';
import { checkRuntimeHealth } from './runtime-status.js';
import { readRuntimeConnection } from './runtime-config.js';
import { approvePairing, listPendingPairings, listPrinters } from './runtime-client.js';
import { checkForUpdate } from './updater.js';
import { downloadAndRunInstaller } from './update-installer.js';

// systray2 ships a .d.ts that NodeNext module resolution can't cleanly map
// to its CJS `exports.default = SysTray` output (no `__esModule` marker) —
// load it via a genuine `require()` instead of fighting the static import.
const require = createRequire(import.meta.url);
const { default: SysTray } = require('systray2') as typeof import('systray2');

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconPath = join(__dirname, '..', 'assets', 'icon.ico');
const iconPendingPath = join(__dirname, '..', 'assets', 'icon-pending.ico');
const daemonLogDir = join(__dirname, '..', '..', 'runtime', 'scripts', 'daemon');

const SERVICE_NAME = 'PortixOne Runtime';
const HEALTH_POLL_INTERVAL_MS = 5000;
const PRINTERS_POLL_INTERVAL_MS = 15000;
// Pairing requests need a human to notice and act on them promptly, so this polls as often as health.
const PAIRING_POLL_INTERVAL_MS = 5000;
// Installers don't ship often yet — no need to hit GitHub's API more than a few times a day.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const OPEN_LOGS = 'Open Logs';
const RESTART_SERVICE = 'Restart Runtime';
const CLOSE_TRAY = 'Close Tray';
const PRINTERS_HEADER = 'Printers';
const NO_PRINTERS_ITEM: MenuItem = { title: 'No printers detected', tooltip: '', checked: false, enabled: false };
const PAIRING_HEADER = 'Pairing Requests';
const CHECK_FOR_UPDATES = 'Check for Updates';
const INSTALL_UPDATE_NOW = 'Install Update Now';

const statusItem: MenuItem = {
  title: 'Checking runtime status…',
  tooltip: 'PortixOne Runtime status',
  checked: false,
  enabled: false,
};

const printersSubmenu: MenuItem = {
  title: PRINTERS_HEADER,
  tooltip: 'Printers detected by the runtime',
  checked: false,
  enabled: true,
  items: [NO_PRINTERS_ITEM],
};

// Hidden until there's actually something to approve — this is the tray's
// stand-in for the phase's "Aceptar" step (see runtime/src/pairing/).
const pairingSubmenu: MenuItem = {
  title: PAIRING_HEADER,
  tooltip: 'Apps waiting to be paired with this runtime',
  checked: false,
  enabled: true,
  hidden: true,
  items: [],
};

// Two-step by design, not fully silent: a background check flips this item
// to "Install Update Now" on its own, but *applying* it still needs an
// explicit second click — there's no code-signing cert yet (installer/README)
// and no confirmation dialog in this no-Electron tray, so an unattended
// silent reinstall felt like more risk than "the user doesn't think about
// updating" was worth until both of those exist.
const updateItem: MenuItem = {
  title: CHECK_FOR_UPDATES,
  tooltip: `Currently on v${APP_VERSION}`,
  checked: false,
  enabled: true,
};
let pendingDownloadUrl: string | undefined;
/** Codes already notified about — a native toast should fire once per new request, not once per 5s poll. */
let notifiedCodes = new Set<string>();

function buildMenu(): Menu {
  return {
    icon: pairingSubmenu.hidden ? iconPath : iconPendingPath,
    title: 'PortixOne',
    tooltip: 'PortixOne Runtime',
    items: [
      statusItem,
      SysTray.separator,
      printersSubmenu,
      pairingSubmenu,
      SysTray.separator,
      { title: OPEN_LOGS, tooltip: 'Open the service log folder', checked: false, enabled: true },
      { title: RESTART_SERVICE, tooltip: 'Stop and start the Runtime (needs admin)', checked: false, enabled: true },
      updateItem,
      SysTray.separator,
      {
        title: CLOSE_TRAY,
        tooltip: 'Close this tray icon — the Runtime keeps running in the background',
        checked: false,
        enabled: true,
      },
    ],
  };
}

const systray = new SysTray({ menu: buildMenu(), debug: false });

/** Maps a pairing-approval menu item's title back to its code — rebuilt every poll, titles must stay unique to be clickable. */
let approveActionsByTitle = new Map<string, string>();

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
    case CLOSE_TRAY:
      void systray.kill(false);
      process.exit(0);
      break;
    case CHECK_FOR_UPDATES:
      void handleCheckForUpdates();
      break;
    case INSTALL_UPDATE_NOW:
      void handleInstallUpdate();
      break;
    default: {
      const code = approveActionsByTitle.get(action.item.title);
      if (code) {
        void handleApprove(code);
      }
      break;
    }
  }
});

async function handleApprove(code: string): Promise<void> {
  const connection = readRuntimeConnection();
  if (!connection) {
    return;
  }
  const approved = await approvePairing(connection, code);
  if (!approved) {
    console.error(`Failed to approve pairing ${code} — it may have already expired or been handled.`);
  }
  await pollPairing(); // refresh immediately so the handled entry disappears without waiting for the next tick
}

async function handleCheckForUpdates(): Promise<void> {
  updateItem.title = 'Checking for updates…';
  updateItem.enabled = false;
  await systray.sendAction({ type: 'update-item', item: updateItem });

  const result = await checkForUpdate();
  if (result.updateAvailable && result.downloadUrl) {
    pendingDownloadUrl = result.downloadUrl;
    updateItem.title = INSTALL_UPDATE_NOW;
    updateItem.tooltip = `v${result.latestVersion} is available — click to download and install (will restart the Runtime)`;
  } else {
    pendingDownloadUrl = undefined;
    updateItem.title = CHECK_FOR_UPDATES;
    updateItem.tooltip = result.checked
      ? `You're on the latest version (v${APP_VERSION})`
      : `Could not check for updates${result.error ? `: ${result.error}` : ''}`;
  }
  updateItem.enabled = true;
  await systray.sendAction({ type: 'update-item', item: updateItem });
}

async function handleInstallUpdate(): Promise<void> {
  if (!pendingDownloadUrl) {
    return;
  }
  updateItem.title = 'Downloading update…';
  updateItem.enabled = false;
  await systray.sendAction({ type: 'update-item', item: updateItem });

  try {
    // The installer's own PrepareToInstall step kills this tray process and
    // relaunches it once reinstalled — nothing more to do here on success.
    await downloadAndRunInstaller(pendingDownloadUrl);
  } catch (error) {
    console.error('Update install failed:', (error as Error).message);
    updateItem.title = INSTALL_UPDATE_NOW;
    updateItem.enabled = true;
    await systray.sendAction({ type: 'update-item', item: updateItem });
  }
}

function printerMenuItem(printer: PrinterInfo): MenuItem {
  const indicator = printer.online ? '●' : '○';
  return {
    title: `${indicator} ${printer.name}${printer.status ? ` — ${printer.status}` : ''}`,
    tooltip: [printer.driver, printer.port].filter(Boolean).join(' · '),
    checked: false,
    enabled: false,
  };
}

function pairingMenuItem(request: PendingPairingSummary): MenuItem {
  const title = `Approve ${request.appId} (${request.code})`;
  approveActionsByTitle.set(title, request.code);
  const originPart = request.origin ? `${displayOrigin(request.origin)} — ` : '';
  return { title, tooltip: `${originPart}Tenant: ${request.tenant} — expires ${request.expiresAt}`, checked: false, enabled: true };
}

async function pollHealth(): Promise<void> {
  const health = await checkRuntimeHealth();
  statusItem.title = health.online ? `● Runtime online${health.version ? ` (v${health.version})` : ''}` : '○ Runtime offline';
  statusItem.tooltip = health.online
    ? `PortixOne Runtime${health.defaultPrinter ? ` — default printer: ${health.defaultPrinter}` : ''}`
    : 'PortixOne Runtime is not reachable';
  await systray.sendAction({ type: 'update-item', item: statusItem });
}

async function pollPrinters(): Promise<void> {
  const connection = readRuntimeConnection();
  const printers = connection ? await listPrinters(connection) : undefined;
  printersSubmenu.items = printers && printers.length > 0 ? printers.map(printerMenuItem) : [NO_PRINTERS_ITEM];
  await systray.sendAction({ type: 'update-menu', menu: buildMenu() });
}

/** "https://checkout.example.com" -> "checkout.example.com" — the scheme is noise once it's sitting next to "wants to print." */
function displayOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return origin;
  }
}

function notifyNewPairingRequests(pending: PendingPairingSummary[]): void {
  const currentCodes = new Set(pending.map((p) => p.code));
  for (const request of pending) {
    if (!notifiedCodes.has(request.code)) {
      // Favor the Origin (e.g. "localhost:3000 wants to print.") — it's what
      // the person approving actually recognizes, same as a browser/macOS
      // permission prompt. Falls back to the app's own id for non-browser
      // callers, which never send an Origin header.
      const subject = request.origin ? displayOrigin(request.origin) : request.appId;
      notifier.notify({
        // No `title` here on purpose — `appID` already puts "Portix.One" in
        // the toast's own header row; repeating it as the body title too
        // just duplicated the brand name for no reason (caught by actually
        // looking at the rendered toast, not just reading the call).
        title: `${subject} wants to print`,
        message: `Tenant: ${request.tenant}`,
        icon: iconPath,
        appID: 'Portix.One',
        sound: true,
      });
    }
  }
  // Drop codes that are no longer pending (approved, expired, or denied) so
  // the notified-set doesn't grow forever and a reused code can re-notify.
  notifiedCodes = currentCodes;
}

async function pollPairing(): Promise<void> {
  const connection = readRuntimeConnection();
  const pending = connection ? await listPendingPairings(connection) : undefined;
  approveActionsByTitle = new Map();
  if (pending && pending.length > 0) {
    notifyNewPairingRequests(pending);
    pairingSubmenu.hidden = false;
    pairingSubmenu.items = pending.map(pairingMenuItem);
  } else {
    notifiedCodes = new Set();
    pairingSubmenu.hidden = true;
    pairingSubmenu.items = [];
  }
  await systray.sendAction({ type: 'update-menu', menu: buildMenu() });
}

await systray.ready();
await pollHealth();
await pollPrinters();
await pollPairing();
void handleCheckForUpdates(); // background check on startup — doesn't block the tray coming up

setInterval(() => {
  void pollHealth();
}, HEALTH_POLL_INTERVAL_MS);
setInterval(() => {
  void pollPrinters();
}, PRINTERS_POLL_INTERVAL_MS);
setInterval(() => {
  void pollPairing();
}, PAIRING_POLL_INTERVAL_MS);
setInterval(() => {
  void handleCheckForUpdates();
}, UPDATE_CHECK_INTERVAL_MS);
