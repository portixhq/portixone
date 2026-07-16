import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { exec } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import notifier from 'node-notifier';
import type { ClickEvent, Menu, MenuItem } from 'systray2';
import { APP_VERSION } from '@portixone/shared';
import type { PairedAppSummary, PendingPairingSummary, PrinterInfo } from '@portixone/protocol';
import { checkRuntimeHealth } from './runtime-status.js';
import { CONFIG_PATH, readRuntimeConnection } from './runtime-config.js';
import {
  approvePairing,
  downloadDiagnostics,
  listPairedApps,
  listPendingPairings,
  listPrinters,
  revokePairing,
} from './runtime-client.js';
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
const iconOfflinePath = join(__dirname, '..', 'assets', 'icon-offline.ico');
const iconUpdatingPath = join(__dirname, '..', 'assets', 'icon-updating.ico');
const daemonLogDir = join(__dirname, '..', '..', 'runtime', 'scripts', 'daemon');
const diagnosticsDir = join(__dirname, '..', '..', 'runtime', '.data', 'diagnostics');

const SERVICE_NAME = 'PortixOne Runtime';
const HEALTH_POLL_INTERVAL_MS = 5000;
const PRINTERS_POLL_INTERVAL_MS = 15000;
// Pairing requests need a human to notice and act on them promptly, so this polls as often as health.
const PAIRING_POLL_INTERVAL_MS = 5000;
// Connected apps is a management view, not a notification — no need to poll it as eagerly as pending requests.
const CONNECTED_APPS_POLL_INTERVAL_MS = 15000;
// Installers don't ship often yet — no need to hit GitHub's API more than a few times a day.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const OPEN_DASHBOARD = 'Open Dashboard';
const REVIEW_IN_BROWSER = 'Review in browser…';
const OPEN_LOGS = 'Open Logs';
const EXPORT_DIAGNOSTICS = 'Export Diagnostics';
const RESTART_SERVICE = 'Restart Runtime';
const OPEN_SETTINGS = 'Settings';
const CLOSE_TRAY = 'Close Tray';
const PRINTERS_HEADER = 'Printers';
const PAIRING_HEADER = 'Pairing Requests';
const CONNECTED_APPS_HEADER = 'Connected Applications';
const CHECK_FOR_UPDATES = 'Check for Updates';
const INSTALL_UPDATE_NOW = 'Install Update Now';

// systray2's native Windows tray binary only allocates a real menu-item
// handle for whatever was in the very first payload it received (at
// `ready()`); a later `update-menu` naming a brand-new item object — even
// with a fresh, valid `__id` — gets silently dropped. Found by testing
// directly: the JS-side data and the built menu tree were provably correct
// (logged the exact JSON about to be sent), but the item never rendered.
// The fix is a fixed pool of slot objects created once up front, part of
// the initial menu so they get real handles, and mutated in place on every
// poll instead of ever being replaced. Caps how many printers/pending
// pairings/connected apps can show at once — generous for what any single
// runtime realistically has; raise it if that stops being true.
const MAX_DYNAMIC_SLOTS = 20;
/**
 * Slot 0 must already be visible when this pool is built — not just once a
 * poll runs. systray2 sends its very first payload (at `ready()`) before any
 * of our polls ever execute, and that first payload is what the native
 * binary builds its real Win32 submenu handle from. A submenu whose entire
 * initial item list is hidden never gets a working flyout, even after a
 * later `update-menu` flips a slot visible — found by testing: the arrow
 * rendered, but neither hover nor an actual click ever opened it. It's fine
 * if the first poll immediately re-hides slot 0 again afterward (Pairing
 * Requests does exactly that when there's nothing pending) — the handle
 * only needs to have existed once, at construction.
 */
function createSlotPool(count: number, placeholderTitle: string): MenuItem[] {
  const slots: MenuItem[] = Array.from({ length: count }, () => ({
    title: '',
    tooltip: '',
    checked: false,
    enabled: true,
    hidden: true,
  }));
  slots[0].title = placeholderTitle;
  slots[0].enabled = false;
  slots[0].hidden = false;
  return slots;
}
/** Fills a submenu's fixed slot pool from `data`, showing `emptyTitle` in the first slot when there's nothing to show. */
function fillSlots<T>(slots: MenuItem[], data: T[], render: (slot: MenuItem, item: T) => void, emptyTitle: string): void {
  if (data.length === 0) {
    const [placeholder, ...rest] = slots;
    placeholder.title = emptyTitle;
    placeholder.tooltip = '';
    placeholder.enabled = false;
    placeholder.hidden = false;
    rest.forEach((slot) => {
      slot.hidden = true;
    });
    return;
  }
  slots.forEach((slot, i) => {
    const item = data[i];
    if (!item) {
      slot.hidden = true;
      return;
    }
    render(slot, item);
  });
}

// enabled:true is load-bearing, not cosmetic: this item's text is repainted
// live via `update-item`, and on Windows an `enabled:false` top-level item is
// exactly the case where the earlier stuck-text bug lived. Clicking it does
// nothing (its title matches no action in onClick's switch), so keeping it
// enabled is harmless while guaranteeing the status text actually updates.
const statusItem: MenuItem = {
  title: 'Checking runtime status…',
  tooltip: 'PortixOne Runtime status',
  checked: false,
  enabled: true,
};

const printersSubmenu: MenuItem = {
  title: PRINTERS_HEADER,
  tooltip: 'Printers detected by the runtime',
  checked: false,
  enabled: true,
  items: createSlotPool(MAX_DYNAMIC_SLOTS, 'No printers detected'),
};

// Always visible, same as the other two submenus below — a submenu item
// that starts `hidden: true` at construction has the exact same problem
// createSlotPool's own doc comment describes for child items: the native
// tray binary never gives it a working entry, and toggling `hidden` back to
// false later doesn't fix that after the fact (found by testing: the JS
// state was provably correct — logged it — but "Pairing Requests" never
// appeared in the real menu). `hasPendingRequests` below drives the tray
// icon's pending-vs-normal color instead of this item's own hidden flag.
const pairingSubmenu: MenuItem = {
  title: PAIRING_HEADER,
  tooltip: 'Apps waiting to be paired with this runtime',
  checked: false,
  enabled: true,
  items: createSlotPool(MAX_DYNAMIC_SLOTS, 'No pending requests'),
};
let hasPendingRequests = false;

// A management view of already-approved apps, not a notification, so
// "nothing connected yet" is itself useful information rather than noise to hide.
const connectedAppsSubmenu: MenuItem = {
  title: CONNECTED_APPS_HEADER,
  tooltip: 'Apps paired with this runtime — click one to revoke its access',
  checked: false,
  enabled: true,
  items: createSlotPool(MAX_DYNAMIC_SLOTS, 'No connected apps'),
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
/** installerFileName/checksumsUrl travel alongside pendingDownloadUrl — all three come from the same checkForUpdate() result and are needed together to verify the installer before running it (see update-installer.ts). */
let pendingInstallerFileName: string | undefined;
let pendingChecksumsUrl: string | undefined;
/** Codes already notified about — a native toast should fire once per new request, not once per 5s poll. */
let notifiedCodes = new Set<string>();
/** True once we've either auto-opened the dashboard for first-run setup or the user opened it themselves — either way, stop offering to auto-open it again this session. */
let dashboardOffered = false;
/** Drives the red tray icon — takes priority over every other state below since an unreachable Runtime makes everything else moot. */
let isRuntimeOffline = false;
/** Drives the blue tray icon while a downloaded installer is being run — set right before `downloadAndRunInstaller`, see handleInstallUpdate. */
let isUpdating = false;

/** Opens one of the runtime's local pages (dashboard, pairing approval UI) in the default browser, with the admin key in the URL so its own JS can call the API — see dashboard.controller.ts's route comment for the trust model. */
function openLocalPage(connection: { host: string; port: number; apiKey: string }, path: string): void {
  const url = `http://${connection.host}:${connection.port}${path}?key=${encodeURIComponent(connection.apiKey)}`;
  exec(`start "" "${url}"`);
}

/** Priority order matches how urgently each state needs the user's attention: unreachable beats an in-progress update beats a pending pairing beats "everything's fine". */
function currentIconPath(): string {
  if (isRuntimeOffline) {
    return iconOfflinePath;
  }
  if (isUpdating) {
    return iconUpdatingPath;
  }
  if (hasPendingRequests) {
    return iconPendingPath;
  }
  return iconPath;
}

function buildMenu(): Menu {
  return {
    icon: currentIconPath(),
    title: 'PortixOne',
    tooltip: 'PortixOne Runtime',
    items: [
      statusItem,
      SysTray.separator,
      { title: OPEN_DASHBOARD, tooltip: 'Set up your default printer and print a test ticket', checked: false, enabled: true },
      printersSubmenu,
      pairingSubmenu,
      connectedAppsSubmenu,
      SysTray.separator,
      { title: OPEN_LOGS, tooltip: 'Open the service log folder', checked: false, enabled: true },
      { title: EXPORT_DIAGNOSTICS, tooltip: 'Save a diagnostics.zip (logs, config, printers) for support', checked: false, enabled: true },
      { title: RESTART_SERVICE, tooltip: 'Stop and start the Runtime (needs admin)', checked: false, enabled: true },
      updateItem,
      SysTray.separator,
      { title: OPEN_SETTINGS, tooltip: 'Reveal the Runtime config file (restart the Runtime after editing it)', checked: false, enabled: true },
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
/** Maps a connected-app menu item's title back to its deviceId — same rebuild-every-poll pattern as approveActionsByTitle. */
let revokeActionsByTitle = new Map<string, string>();

await systray.onClick((action: ClickEvent) => {
  switch (action.item.title) {
    case OPEN_DASHBOARD: {
      dashboardOffered = true;
      const connection = readRuntimeConnection();
      if (connection) {
        openLocalPage(connection, '/dashboard');
      }
      break;
    }
    case REVIEW_IN_BROWSER: {
      const connection = readRuntimeConnection();
      if (connection) {
        openLocalPage(connection, '/pairing/approve-ui');
      }
      break;
    }
    case OPEN_LOGS:
      exec(`explorer.exe "${daemonLogDir}"`);
      break;
    case EXPORT_DIAGNOSTICS:
      void handleExportDiagnostics();
      break;
    case OPEN_SETTINGS:
      exec(`explorer.exe /select,"${CONFIG_PATH}"`);
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
        break;
      }
      const deviceId = revokeActionsByTitle.get(action.item.title);
      if (deviceId) {
        void handleRevoke(deviceId);
      }
      break;
    }
  }
});

async function handleExportDiagnostics(): Promise<void> {
  const connection = readRuntimeConnection();
  const zipBuffer = connection ? await downloadDiagnostics(connection) : undefined;
  if (!zipBuffer) {
    notifier.notify({
      title: 'Export Diagnostics failed',
      message: 'Could not reach the Runtime — is it running?',
      icon: iconPath,
      appID: 'Portix.One',
      sound: false,
    });
    return;
  }
  mkdirSync(diagnosticsDir, { recursive: true });
  const fileName = `diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
  const filePath = join(diagnosticsDir, fileName);
  writeFileSync(filePath, zipBuffer);
  // /select reveals the file itself in an open Explorer window rather than
  // just opening its parent folder — one less step to find it among any
  // previous exports.
  exec(`explorer.exe /select,"${filePath}"`);
}

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

async function handleRevoke(deviceId: string): Promise<void> {
  const connection = readRuntimeConnection();
  if (!connection) {
    return;
  }
  const revoked = await revokePairing(connection, deviceId);
  if (!revoked) {
    console.error(`Failed to revoke pairing ${deviceId} — it may have already been removed.`);
  }
  await pollConnectedApps(); // refresh immediately so the revoked entry disappears without waiting for the next tick
}

/**
 * `manual` fires a toast with the result — on by default for the tray's own
 * "Check for Updates" click, off for the silent background check (startup +
 * every `UPDATE_CHECK_INTERVAL_MS`), since nobody's watching that one and a
 * toast every few hours saying "you're up to date" would just be noise.
 * Without this, the only feedback was the menu item's tooltip — invisible
 * unless you happened to hover it, so a click looked like it did nothing.
 */
async function handleCheckForUpdates(manual = true): Promise<void> {
  updateItem.title = 'Checking for updates…';
  updateItem.enabled = false;
  await systray.sendAction({ type: 'update-item', item: updateItem });

  const result = await checkForUpdate();
  // Never let a check disappear without a trace. "No update" and "couldn't check" look identical
  // from the outside, and when a check finds nothing the interesting part is WHY it passed each
  // candidate over — a channel mismatch and a missing checksum are very different problems.
  console.log(
    `[update] channel=${result.channel} checked=${result.checked} available=${result.updateAvailable}` +
      `${result.latestVersion ? ` latest=${result.latestVersion}` : ''}` +
      `${result.error ? ` error=${result.error}` : ''}` +
      `${result.rejected?.length ? ` rejected=${result.rejected.map((r) => `${r.tag}:${r.reason}`).join(',')}` : ''}`,
  );
  if (result.updateAvailable && result.downloadUrl) {
    pendingDownloadUrl = result.downloadUrl;
    pendingInstallerFileName = result.installerFileName;
    pendingChecksumsUrl = result.checksumsUrl;
    updateItem.title = INSTALL_UPDATE_NOW;
    updateItem.tooltip = `v${result.latestVersion} is available — click to download and install (will restart the Runtime)`;
    if (manual) {
      notifier.notify({
        title: 'Update available',
        message: `${result.latestVersion} is ready — click "Install Update Now" in the tray to install it.`,
        icon: iconPath,
        appID: 'Portix.One',
        sound: true,
      });
    }
  } else {
    pendingDownloadUrl = undefined;
    pendingInstallerFileName = undefined;
    pendingChecksumsUrl = undefined;
    updateItem.title = CHECK_FOR_UPDATES;
    updateItem.tooltip = result.checked
      ? `You're on the latest version (v${APP_VERSION})`
      : `Could not check for updates${result.error ? `: ${result.error}` : ''}`;
    if (manual) {
      notifier.notify({
        title: result.checked ? "You're up to date" : 'Could not check for updates',
        message: result.checked ? `Portix.One Runtime v${APP_VERSION} is the latest version.` : (result.error ?? 'Unknown error'),
        icon: iconPath,
        appID: 'Portix.One',
        sound: false,
      });
    }
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
  isUpdating = true;
  await systray.sendAction({ type: 'update-menu', menu: buildMenu() }); // update-item alone wouldn't repaint the icon

  try {
    // The installer's own PrepareToInstall step kills this tray process and
    // relaunches it once reinstalled — nothing more to do here on success,
    // including reverting isUpdating: this process won't be alive to see it.
    await downloadAndRunInstaller(pendingDownloadUrl, pendingInstallerFileName, pendingChecksumsUrl);
  } catch (error) {
    const message = (error as Error).message;
    console.error('Update install failed:', message);
    // A console.error alone is invisible on a no-window tray app — this is
    // the one place a failed update (including a rejected/mismatched
    // checksum) needs to actually reach the person running it.
    notifier.notify({
      title: 'Update failed',
      message,
      icon: iconPath,
      appID: 'Portix.One',
      sound: true,
    });
    updateItem.title = INSTALL_UPDATE_NOW;
    updateItem.enabled = true;
    isUpdating = false;
    await systray.sendAction({ type: 'update-menu', menu: buildMenu() });
  }
}

function renderPrinterSlot(slot: MenuItem, printer: PrinterInfo): void {
  const indicator = printer.online ? '●' : '○';
  slot.title = `${indicator} ${printer.name}${printer.status ? ` — ${printer.status}` : ''}`;
  slot.tooltip = [printer.driver, printer.port].filter(Boolean).join(' · ');
  slot.enabled = false;
  slot.hidden = false;
}

function renderPairingSlot(slot: MenuItem, request: PendingPairingSummary): void {
  const title = `Approve ${request.appId} (${request.code})`;
  approveActionsByTitle.set(title, request.code);
  const originPart = request.origin ? `${displayOrigin(request.origin)} — ` : '';
  slot.title = title;
  slot.tooltip = `${originPart}Tenant: ${request.tenant} — expires ${request.expiresAt}`;
  slot.enabled = true;
  slot.hidden = false;
}

function renderConnectedAppSlot(slot: MenuItem, app: PairedAppSummary): void {
  const subject = app.origin ? displayOrigin(app.origin) : app.appId;
  // Short deviceId suffix keeps the title unique (two apps of the same subject) without showing a raw UUID.
  const title = `${subject} (${app.deviceId.slice(0, 8)})`;
  revokeActionsByTitle.set(title, app.deviceId);
  const lastUsedPart = app.lastUsedAt ? `last used ${app.lastUsedAt}` : 'never used';
  const jobsPart = `${app.recentJobCount} recent job${app.recentJobCount === 1 ? '' : 's'}`;
  slot.title = title;
  slot.tooltip = `Tenant: ${app.tenant} — ${lastUsedPart} — ${jobsPart} — click to revoke`;
  slot.enabled = true;
  slot.hidden = false;
}

async function pollHealth(): Promise<void> {
  const health = await checkRuntimeHealth();
  statusItem.title = health.online ? `● Runtime online${health.version ? ` (v${health.version})` : ''}` : '○ Runtime offline';
  statusItem.tooltip = health.online
    ? `PortixOne Runtime${health.defaultPrinter ? ` — default printer: ${health.defaultPrinter}` : ''}`
    : 'PortixOne Runtime is not reachable';
  isRuntimeOffline = !health.online;
  // Two separate actions on purpose — proven necessary by a standalone
  // systray2 repro on this OS: an item repainted via `update-item` updated
  // correctly, while the same item repainted via `update-menu` or
  // `update-menu-and-item` stayed frozen. The top-level icon color lives on
  // the Menu object and only `update-menu` repaints it; a top-level item's
  // TEXT only repaints via `update-item`. So the icon goes through
  // update-menu and the status text through its own update-item.
  await systray.sendAction({ type: 'update-menu', menu: buildMenu() });
  await systray.sendAction({ type: 'update-item', item: statusItem });

  // First-run welcome: no default printer configured yet means setup was
  // never completed, so open the dashboard once on its own instead of
  // waiting for someone to notice the tray icon exists. Reusing
  // `defaultPrinter` as the "is setup done" signal avoids inventing a
  // separate first-run flag — once it's set, this never fires again.
  if (health.online && !health.defaultPrinter && !dashboardOffered) {
    dashboardOffered = true;
    const connection = readRuntimeConnection();
    if (connection) {
      openLocalPage(connection, '/dashboard');
    }
  }
}

async function pollPrinters(): Promise<void> {
  const connection = readRuntimeConnection();
  const printers = (connection ? await listPrinters(connection) : undefined) ?? [];
  fillSlots(printersSubmenu.items!, printers, renderPrinterSlot, 'No printers detected');
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
  const pending = (connection ? await listPendingPairings(connection) : undefined) ?? [];
  approveActionsByTitle = new Map();
  hasPendingRequests = pending.length > 0;
  if (pending.length > 0) {
    notifyNewPairingRequests(pending);
  } else {
    notifiedCodes = new Set();
  }
  const slots = pairingSubmenu.items!;
  // Slot 0 is reserved for a link to the richer approval page (permissions,
  // the code shown prominently to cross-check against the requesting app,
  // Allow/Deny) — Fase 5's "beyond today's plain toast + submenu". The
  // quick-approve entries below still work too, for when you already trust
  // it and just want the fast path.
  const reviewSlot = slots[0];
  if (pending.length > 0) {
    reviewSlot.title = REVIEW_IN_BROWSER;
    reviewSlot.tooltip = 'Open a detailed approval view — permissions, the code to cross-check, Allow/Deny';
    reviewSlot.enabled = true;
  } else {
    reviewSlot.title = 'No pending requests';
    reviewSlot.tooltip = '';
    reviewSlot.enabled = false;
  }
  reviewSlot.hidden = false;
  for (let i = 1; i < slots.length; i += 1) {
    const request = pending[i - 1];
    const slot = slots[i];
    if (!request) {
      slot.hidden = true;
      continue;
    }
    renderPairingSlot(slot, request);
  }
  await systray.sendAction({ type: 'update-menu', menu: buildMenu() });
}

async function pollConnectedApps(): Promise<void> {
  const connection = readRuntimeConnection();
  const apps = (connection ? await listPairedApps(connection) : undefined) ?? [];
  revokeActionsByTitle = new Map();
  fillSlots(connectedAppsSubmenu.items!, apps, renderConnectedAppSlot, 'No connected apps');
  await systray.sendAction({ type: 'update-menu', menu: buildMenu() });
}

await systray.ready();
await pollHealth();
await pollPrinters();
await pollPairing();
await pollConnectedApps();
void handleCheckForUpdates(false); // background check on startup — doesn't block the tray coming up, and stays silent

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
  void pollConnectedApps();
}, CONNECTED_APPS_POLL_INTERVAL_MS);
setInterval(() => {
  void handleCheckForUpdates(false);
}, UPDATE_CHECK_INTERVAL_MS);
