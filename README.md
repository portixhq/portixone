# PortixOne

Local device infrastructure for modern web applications.

```
Browser
  ↓
PortixOne Runtime
  ↓
Driver
  ↓
Hardware
```

**One API. Multiple devices. Cross-platform.**

PortixOne connects browser-based applications to local hardware — printers today, cash drawers, barcode scanners, scales, and customer displays next — through a single runtime and a unified capability model (`Print`, `Cut`, `OpenDrawer`, `ReadWeight`, ...), instead of a different integration per device and per OS.

**Status**: Experimental (`v0.0.1-alpha`) · **Current scope**: Windows local printing only.

## Milestones

✅ **First Physical Print** — 2026-07-03

```
Browser
  ↓
Runtime
  ↓
Windows Spooler
  ↓
Thermal Printer
```

See [CHANGELOG.md](CHANGELOG.md) for what shipped and [ROADMAP.md](ROADMAP.md) for what's next.

## Quickstart

```bash
npm install @portixone/sdk
```

```js
import { Portix } from "@portixone/sdk";

const portix = new Portix();

await portix.connect();

await portix.print({
    content: "Hello PortixOne!"
});
```

The printer prints. That's it.

No printer or runtime handy? Add `{ mode: "mock" }` and try the exact same code — no setup at all:

```js
const portix = new Portix({ mode: "mock" });
```

`print()` renders a text preview of the receipt instead of sending it anywhere. See [`examples/basic-print`](examples/basic-print) for a runnable, standalone version — just `npm install && npm start`, nothing else.

### Running this repo locally

```bash
npm install
npm run dev        # starts the runtime on localhost
npm run build       # builds all workspaces
npm run typecheck
```

Then open [`examples/quickstart-html/index.html`](examples/quickstart-html/index.html) to try the end-to-end printing flow above in a browser.

## Engineering Milestones

A running log of what actually shipped and got validated — not a promise, a record.

### 2026-07-03 — ✅ First Physical Print

Validated Runtime → Windows Spooler → Thermal Printer, end-to-end, from a real browser tab against a physical USB thermal printer.

## Monorepo structure

| Folder | Status | License | Description |
|---|---|---|---|
| [`runtime/`](runtime) | Active (MVP) | Open source | Portix Runtime — headless local bridge (HTTP + WebSocket API + printer manager) |
| [`sdk-js/`](sdk-js) | Active (MVP) | Open source | JavaScript SDK (`@portixone/sdk`) for calling `print()` from a web app |
| [`packages/protocol/`](packages/protocol) | Active (MVP) | Open source | Shared message contract between the runtime and SDKs |
| [`packages/shared/`](packages/shared) | Active (MVP) | Open source | Shared constants and error types |
| [`packages/escpos/`](packages/escpos) | Active (MVP) | Open source | ESC/POS command building |
| [`examples/`](examples) | Active (MVP) | Open source | Standalone Node.js example (npm-installed) + minimal HTML demo |
| [`docs/`](docs) | Placeholder | Open source | Quickstart and troubleshooting |
| [`cli/`](cli) | Planned | Open source | Command-line interface for the runtime |
| [`sdk-dotnet/`](sdk-dotnet) | Planned | Open source | .NET SDK |
| [`sdk-python/`](sdk-python) | Planned | Open source | Python SDK |
| [`sdk-go/`](sdk-go) | Planned | Open source | Go SDK |
| [`playground/`](playground) | Planned | Open source | Full Edge Platform |
| [`cloud/`](cloud) | Planned | **Closed — private repo** | Placeholder only; see [Open source vs. closed](#open-source-vs-closed) |

## Layered architecture

1. **Cloud Platform** (closed) — authentication, projects, API keys, dashboard, device fleet management, licensing, telemetry, team organizations, managed updates, billing, enterprise sync.
2. **Secure Communication Layer** (open) — HTTPS/WebSockets/TLS between cloud and runtime.
3. **Portix Runtime (Edge Runtime)** (open) — authenticates, validates, routes commands, and executes jobs locally.
4. **Hardware Abstraction Layer** (open) — printers, cash drawers, scanners, scales, displays, USB, Serial, Bluetooth, TCP/IP.

## Open source vs. closed

PortixOne is open-core. Everything a developer needs to run local printing — and every device capability in the Hardware Abstraction Layer — is open source. The multi-tenant Cloud Platform around it is a separate, closed product.

| | |
|---|---|
| **Open source** (MIT, this repo) | Runtime · SDK (JS, .NET, Go, Python) · Protocol · Examples · CLI · Documentation |
| **Closed** ([`portixhq/portix-cloud`](https://github.com/portixhq/portix-cloud), private) | Cloud — dashboard, device fleet management, licensing, telemetry, team organizations, managed updates, billing, enterprise sync |

The [`cloud/`](cloud) folder in this repo is a structural placeholder only, so the layered architecture is visible from the root — it contains no proprietary code and never will.

## Try it

`npm install @portixone/sdk` and see for yourself — the [Quickstart](#quickstart) above is the whole thing.

Looking for feedback from developers building POS, kiosk, logistics, or web-to-print tools — [open an issue](https://github.com/portixhq/portixone/issues) with what worked, what didn't, or what's missing.

## PortixOne repo network

This monorepo is the source of truth for development. The rest of the knowledge network lives in separate repos, each targeting a distinct search intent:

| Repo | What it is |
|---|---|
| [`portix.dev`](https://github.com/portixhq/portix.dev) | Developer portal — landing, docs, tutorials, examples, roadmap, changelog |
| [`portix-runtime`](https://github.com/portixhq/portix-runtime) | Read-only mirror of the runtime (`runtime/` here) |
| [`portix-sdk-js`](https://github.com/portixhq/portix-sdk-js) | Read-only mirror of the JS SDK (`sdk-js/` here) |
| [`awesome-web-printing`](https://github.com/portixhq/awesome-web-printing) | Curated list of the web printing ecosystem |
| [`browser-printing-examples`](https://github.com/portixhq/browser-printing-examples) | Runnable examples by framework (vanilla, React, Vue) |
| [`escpos-cheatsheet`](https://github.com/portixhq/escpos-cheatsheet) | Quick ESC/POS command reference |
| [`thermal-printer-test-files`](https://github.com/portixhq/thermal-printer-test-files) | Real `.bin` ESC/POS files for testing printers/parsers |

## License

MIT — see [LICENSE](LICENSE). Applies to everything in this repo (the Cloud Platform is closed and lives elsewhere — see [Open source vs. closed](#open-source-vs-closed)).
