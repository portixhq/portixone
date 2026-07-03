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
npm install @portix/sdk
```

```js
import { Portix } from "@portix/sdk";

const portix = new Portix();

await portix.connect();

await portix.print({
    content: "Hello PortixOne!"
});
```

The printer prints. That's it.

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

| Folder | Status | Description |
|---|---|---|
| [`runtime/`](runtime) | Active (MVP) | Portix Runtime — headless local bridge (HTTP + WebSocket API + printer manager) |
| [`sdk-js/`](sdk-js) | Active (MVP) | JavaScript SDK (`@portix/sdk`) for calling `print()` from a web app |
| [`packages/protocol/`](packages/protocol) | Active (MVP) | Shared message contract between the runtime and SDKs |
| [`packages/shared/`](packages/shared) | Active (MVP) | Shared constants and error types |
| [`packages/escpos/`](packages/escpos) | Active (MVP) | ESC/POS command building |
| [`examples/`](examples) | Active (MVP) | Minimal HTML demo — Time to First Print |
| [`docs/`](docs) | Placeholder | Quickstart and troubleshooting |
| [`cloud/`](cloud) | Planned | Auth, projects, API keys, dashboard |
| [`sdk-dotnet/`](sdk-dotnet) | Planned | .NET SDK |
| [`sdk-python/`](sdk-python) | Planned | Python SDK |
| [`sdk-go/`](sdk-go) | Planned | Go SDK |
| [`playground/`](playground) | Planned | Full Edge Platform |

## Layered architecture

1. **Cloud Platform** — authentication, projects, API keys, analytics, licensing, dashboard.
2. **Secure Communication Layer** — HTTPS/WebSockets/TLS between cloud and runtime.
3. **Portix Runtime (Edge Runtime)** — authenticates, validates, routes commands, and executes jobs locally.
4. **Hardware Abstraction Layer** — printers, cash drawers, scanners, scales, displays, USB, Serial, Bluetooth, TCP/IP.

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

MIT — see [LICENSE](LICENSE).
