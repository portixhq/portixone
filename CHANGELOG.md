# Changelog

A running log of what actually shipped and got validated — not a promise, a record. Package-level changes are also tracked per-package: [`sdk-js/CHANGELOG.md`](sdk-js/CHANGELOG.md), [`packages/protocol/CHANGELOG.md`](packages/protocol/CHANGELOG.md), [`packages/shared/CHANGELOG.md`](packages/shared/CHANGELOG.md).

## 2026-07-05 — Milestone 4: Productization

Full detail: [MILESTONE_4.md](MILESTONE_4.md). The roadmap itself was also restructured into Fase 1–12 this same day — see [ROADMAP.md](ROADMAP.md).

### Added

- `GET /metrics` — pairing duration, real print latency, failure counts, and WebSocket disconnects (named honestly: disconnects, not reconnections, since the SDK has no reconnect-on-drop logic yet). `portix.getMetrics()` in the SDK.
- `examples/stress-test` — fires N `print()` calls at real concurrency against a live runtime; run for real at 1000 jobs/concurrency 20, 0 failures.
- `examples/kubia-demo` — a full register→pair→print flow using only the public SDK surface, audited for zero PortixOne-internal leakage.
- Embedded Node.js in the installer (`installer/build-staging.js` downloads and checksum-verifies a pinned Node binary) — the target machine no longer needs Node.js pre-installed.
- A portable build (`installer/build-portable.js` → `PortixOneRuntimePortable.zip`) — no install, no admin, no Windows Service.
- Republished `@portixone/sdk@0.3.0`, `@portixone/protocol@0.2.0`, `@portixone/shared@0.2.0` to npm with the full pairing/queue/metrics API surface (`pair`, `disconnect`, `listPrinters`, `getPrinter`, `cancel`, `getJobs`, `ping`, `on`, `getMetrics`) that `0.2.0` predated. Tagged and released on GitHub with changelogs.

### Changed

- `portix.dev`'s landing page rebuilt around a "Developer Preview" positioning: printing-first hero, a browser-vs-PortixOne comparison, a compatibility grid, a public Pricing section (Free/Pro/Business, all non-Business CTAs routing to one qualifying signup form), and a Current Status section.

## 2026-07-05 — Milestone 3: Local API, pairing, and persisted queue

Full detail: [MILESTONE_3.md](MILESTONE_3.md).

### Added

- Per-app pairing: request/approve/poll, scoped tokens, a `'paired'` SDK event.
- Persisted job queue rewritten as service/store/worker, with crash recovery.
- LAN printer discovery, alongside the existing Windows-registered printer list.
- Real printer status parsing (`printer-status.ts`) — catches "out of paper," "offline," "busy," etc. before a job is sent, not after.
- Human-readable hardware errors (`PrinterOfflineError`, `PaperOutError`, `PrinterTimeoutError`, `PrinterBusyError`, and more) instead of raw exceptions.
- Tray pairing support and update-checking (`tray/src/runtime-client.ts`, `updater.ts`).

### Fixed

- An unbounded Windows Spooler PowerShell call that could hang a job forever — now has a timeout, same as the network driver's existing 5s socket timeout.

## 2026-07-04 — Milestone 2.2 hardening

### Fixed

- Three real installer/tray bugs found by testing actual reinstall and uninstall flows, not by reading the script: duplicate tray processes on reinstall, empty folders left behind on uninstall, and a self-matching process-kill command that hung an elevated installer.

## 2026-07-03 — Milestone 2: Developer Zero

### Added

- **2.1** — `@portixone/sdk` published on the public npm registry, verified with a real `npm install` from outside the monorepo.
- **2.2** — Windows Service (`node-windows`) + a lightweight tray app (no Electron) + an Inno Setup installer, verified end-to-end including reinstall-while-running and full uninstall.
- **2.3** — Mock mode (`new Portix({ mode: "mock" })`) — renders a receipt preview with zero hardware or runtime requirement.

## v0.0.1-alpha — 2026-07-03

### Added

- Initial Runtime HTTP API (`/health`, `/print`) with WebSocket status events (`job:queued`, `job:printed`, `job:error`)
- Windows Spooler driver — raw ESC/POS bytes to a named Windows printer via `winspool.drv`, no native addon / node-gyp
- Network driver — raw ESC/POS bytes over TCP/9100 for Ethernet/WiFi thermal printers
- ESC/POS print pipeline (`packages/escpos`)
- JavaScript SDK (`@portixone/sdk`) — `new Portix().connect().print()`

### Fixed

- Print-cut timing — the cutter was firing before the paper cleared the print head, slicing through the last lines of a real receipt. Feed before cut increased from 3 to 5 lines.
- The runtime wasn't loading `.env` at all — `PORTIX_PRINTER_DRIVER` and friends were silently ignored in favor of a stale persisted config. Now loaded via `--env-file-if-exists`.

### Milestone

✅ First successful physical receipt printed.

```
Browser
  ↓
Runtime
  ↓
Windows Spooler
  ↓
Thermal Printer
```

### Notes

Validated on real hardware (a USB ESC/POS thermal printer) via the actual `/print` API route — not the mock driver.
