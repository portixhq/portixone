# Portix Runtime

Headless local bridge (Node.js + TypeScript). Listens on `localhost:<port>` (see `.env.example`), accepts print jobs over HTTP, and reports live status over WebSocket.

## Running in development

```bash
npm run dev
```

First run generates `.data/config.json` with an auto-generated local `apiKey` (or picks up `PORTIX_LOCAL_API_KEY` from the environment) and `.data/runtime.log`. Both are gitignored.

## Endpoints

- `GET /health` → bridge status
- `POST /print` → requires `x-portix-api-key` header, body `{ content, printerName?, copies? }`
- WebSocket (same root) → `status`, `job:queued`, `job:printed`, `job:error` events

## Printer drivers

Set `PORTIX_PRINTER_DRIVER` in `.env` (see `.env.example`):

- `mock` (default) — logs the job as printed, no hardware needed. Good for developing without a printer attached.
- `network` — sends raw ESC/POS bytes to an Ethernet/WiFi thermal printer's raw port (`PORTIX_NETWORK_PRINTER_HOST` / `PORTIX_NETWORK_PRINTER_PORT`, default `9100`). Pure Node `net` socket, no native dependencies. Verified byte-for-byte against a local test listener.
- `windows-spooler` — sends raw ESC/POS bytes to a USB thermal printer installed as a named Windows printer (`PORTIX_DEFAULT_PRINTER`, or per-request `printerName`), via `winspool.drv` through a PowerShell P/Invoke helper (`scripts/send-raw-print.ps1`) — no node-gyp / native addon required. Verified end-to-end against real hardware (a USB ESC/POS thermal printer), including the `/print` API route.

Both real drivers build their byte stream with `packages/escpos`.

## Windows Service

Run the runtime like a real background service instead of a terminal window — starts with Windows, keeps running with no one logged in (e.g. a kiosk), and restarts itself on crash.

Uses [`node-windows`](https://www.npmjs.com/package/node-windows) — no native modules, no extra tools to install (it wraps a precompiled `winsw`-based binary).

```powershell
npm run build             # dist/ must exist first
npm run service:install    # needs an elevated/Administrator shell
npm run service:uninstall  # ditto
npm run service:start      # net start "PortixOne Runtime"
npm run service:stop       # net stop "PortixOne Runtime"
```

- Installs as `PortixOne Runtime` (internal service name `portixoneruntime.exe`), auto-start, runs as `LocalSystem`.
- Reads `.env` the same way `npm start` does (`scripts/service-entry.js` loads it via `process.loadEnvFile`, and forces the working directory to `runtime/` regardless of the service's actual launch context).
- Logs: `scripts/daemon/portixoneruntime.out.log` / `.err.log` (gitignored, machine-specific).
- Verified: installed and started for real, `/health` responded correctly, and a `/print` job was accepted by the Windows print queue with the runtime running as `LocalSystem` (not the logged-in user) — physical output pending a printer being connected to re-test.

Pair this with [`tray/`](../tray) for a visible status icon — the service itself has no UI.

## Module status

**Future capability managers** (not implemented, not even as empty folders, by design — off-limits in the first 90 days): USB Manager, Bluetooth Manager, TCP Manager, Serial Manager, Driver Registry, Updater. These get added once the roadmap reaches cash drawer/scales/other devices.
