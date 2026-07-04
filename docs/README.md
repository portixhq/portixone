# Docs

Placeholder — the public-facing docs site is [`portix.dev/docs`](https://github.com/portixhq/portix.dev). Real, deeper content (driver internals, capability model) is upcoming work per the operating manual. This page covers what's needed today.

## Installation

```bash
npm install @portixone/sdk
```

No printer or runtime handy? Skip straight to [mock mode](#troubleshooting) below — `npm install` is the only step.

## Quickstart

```js
import { Portix } from "@portixone/sdk";

const portix = new Portix();

await portix.connect();

await portix.print({
    content: "Hello PortixOne!"
});
```

The printer prints. That's it. See [`examples/basic-print`](../examples/basic-print) for a runnable, standalone version of this.

## API reference

- **`new Portix(options?)`** — `mode` (`"runtime"` default, or `"mock"`), `apiKey`, `host`, `port`.
- **`portix.connect()`** — verifies the runtime is reachable. Call before `print()`/`getStatus()`.
- **`portix.print({ content, printerName?, copies? })`** — sends a print job, returns `{ jobId, status, message? }`.
- **`portix.getStatus()`** — returns `{ status, version, defaultPrinter? }`.

Full reference with types and defaults → [`sdk-js/README.md`](../sdk-js/README.md).

## Troubleshooting

**No printer, or just trying it out?** Use mock mode — zero hardware, zero runtime:
```js
const portix = new Portix({ mode: "mock" });
```

**`Call portix.connect() before using the client`** — you called `print()`/`getStatus()` without awaiting `connect()` first.

**`INVALID_API_KEY`** — the `apiKey` you passed doesn't match the runtime's `PORTIX_LOCAL_API_KEY` (default `dev-local-key`, see `runtime/.env.example`).

**`connect()` throws / runtime unreachable** — the Portix Runtime isn't running, or `host`/`port` don't match it. Start it with `npm run dev` in [`runtime/`](../runtime) (default `127.0.0.1:17321`), or switch to mock mode.

**`PRINTER_NOT_FOUND`** — no `printerName` was given and no default printer is configured (`PORTIX_DEFAULT_PRINTER` in `runtime/.env`), or the name doesn't match `Get-Printer` exactly.

**`PRINTER_CONNECTION_FAILED`** — the runtime found the printer but couldn't talk to it (unplugged, wrong port, spooler paused).

Still stuck? [Open an issue](https://github.com/portixhq/portixone/issues) — Milestone 2.5 of the [roadmap](../ROADMAP.md) is specifically about finding and fixing exactly these kinds of gaps.

For more:
- SDK reference → [`sdk-js/README.md`](../sdk-js/README.md)
- Running the runtime → [`runtime/README.md`](../runtime/README.md)
