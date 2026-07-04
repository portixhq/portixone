# @portixone/sdk

JavaScript SDK for printing from a web app to the local Portix Runtime.

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

`connect()` uses the local-dev defaults (`localhost`, the runtime's default port, and the `dev-local-key` API key from `runtime/.env.example`) unless you override them:

```js
const portix = new Portix({ apiKey: "...", host: "127.0.0.1", port: 17321 });
```

`printerName` and `copies` are optional on `print()` — they're there for when a developer needs to pick a specific printer or multiple copies, without breaking the basic call.

## Mock mode — no runtime, no printer

Don't have a Portix Runtime or a thermal printer nearby? Pass `mode: "mock"` and try the exact same API — `print()` renders a text preview of the receipt instead of sending it anywhere:

```js
import { Portix } from "@portixone/sdk";

const portix = new Portix({ mode: "mock" });

await portix.connect();

await portix.print({
    content: "Hello PortixOne!"
});
```

```
┌────────────────────────────────┐
│ PORTIX MOCK PRINT PREVIEW      │
├────────────────────────────────┤
│ Hello PortixOne!                │
├────────────────────────────────┤
│ copies: 1                       │
└────────────────────────────────┘
```

Going to production is a one-word change: `mode: "runtime"` (or just remove the option — that's the default).

## API reference

### `new Portix(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `"runtime" \| "mock"` | `"runtime"` | `"mock"` needs no runtime and no printer |
| `apiKey` | `string` | `"dev-local-key"` | Must match the runtime's `PORTIX_LOCAL_API_KEY` |
| `host` | `string` | `"127.0.0.1"` | Runtime host |
| `port` | `number` | `17321` | Runtime port |

### `portix.connect(): Promise<void>`

Verifies the runtime is reachable (skipped entirely in mock mode). Throws if it isn't — call this before `print()`/`getStatus()`.

### `portix.print({ content, printerName?, copies? }): Promise<{ jobId, status, message? }>`

Sends a print job. `status` is `"queued"` in runtime mode (the job is processed asynchronously) or `"printed"` in mock mode (rendered synchronously).

### `portix.getStatus(): Promise<{ status, version, defaultPrinter? }>`

Reads the runtime's health endpoint (or a static mock status in mock mode).
