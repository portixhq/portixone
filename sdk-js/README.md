# @portixone/sdk

JavaScript SDK for printing from a web app to the local Portix Runtime.

## Compatibility

| Environment | `connect()` / `print()` / etc. | `on()` real-time events |
|---|---|---|
| Modern browsers | ✅ | ✅ |
| Node.js 20+ | ✅ (needs global `fetch` and `crypto.randomUUID`) | ⚠️ Node 22+ only — see below |
| Node.js < 20 | ❌ Not supported | ❌ Not supported |

`on()` opens a WebSocket to the runtime, which needs a global `WebSocket` — available in every browser and in Node 22+. On Node 20–21, `on()` logs a warning and simply doesn't fire; poll `getJobs()` instead to track job status there.

## Quickstart

```bash
npm install @portixone/sdk
```

```js
import { Portix } from "@portixone/sdk";

const portix = new Portix({ appId: "my-app", tenant: "default" });

await portix.connect();

await portix.print({
    content: "Hello PortixOne!"
});
```

The printer prints. That's it. `appId`/`tenant` are your integration's identity — the first `connect()` pairs automatically (instant from `localhost`/your own LAN, otherwise it waits for a human to approve it from the PortixOne tray's "Pairing Requests" menu), and every `connect()` after that reuses the same approval.

`connect()` uses the local-dev defaults (`localhost`, the runtime's default port) unless you override them, or pass an explicit `apiKey` to skip pairing entirely (e.g. the runtime's own admin key from `runtime/.env.example`):

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

## Pairing — for multi-tenant SaaS integrations

Don't share the runtime's admin key with your app — pass `tenant`/`appId` instead, and `connect()` handles pairing on its own the first time:

```js
const portix = new Portix({ tenant: "acme-cafe", appId: "kubia" });
await portix.connect();
// Resolves once paired — instant from localhost/your own LAN, otherwise it
// waits for a human to approve "kubia" from the PortixOne tray's
// "Pairing Requests" menu. From here on, print()/getJobs()/cancel() are
// scoped to this tenant/app, and later connect() calls skip pairing again.
```

If you're building a product other people's businesses install PortixOne for (like Kubia) and want to show the pairing code yourself instead of just waiting on `connect()` — e.g. to display it in your own UI — call `pair()` directly:

```js
const { code } = await portix.pair();
// Show `code` (e.g. "M8K4-LPQ9") to whoever is at the machine yourself,
// however fits your product, instead of blocking on connect().

portix.on("paired", ({ deviceId, permissions }) => {
  // From here on, print()/getJobs()/cancel() are scoped to this tenant/app —
  // no repeated authorization, ever.
});
```

`tenant` and `appId` are required for both paths — they're how the runtime tells your integration apart from every other app paired to the same machine.

**No approval needed from `localhost`, `127.0.0.1`, or `::1`** — pairing resolves immediately with no human involved, since only code already running on this exact machine can produce that Origin. This does not extend to LAN/private-IP origins (`192.168.x.x`, `10.x.x.x`, etc.) — `Origin` is a plain HTTP header on this endpoint, not something only a browser can set, so anything else always goes through the normal tray approval, same as a real public domain. Note this is Origin-header-based: a plain Node.js script (no browser) won't send one, so it always needs that one-time tray approval regardless.

## API reference

### `new Portix(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `"runtime" \| "mock"` | `"runtime"` | `"mock"` needs no runtime and no printer |
| `apiKey` | `string` | — | Skips pairing entirely — must match the runtime's `PORTIX_LOCAL_API_KEY` (or a previously-issued token) |
| `host` | `string` | `"127.0.0.1"` | Runtime host |
| `port` | `number` | `17321` | Runtime port |
| `appId` | `string` | — | Your integration's identity. Required for `connect()` to pair automatically, and for `pair()` |
| `tenant` | `string` | — | The specific business/customer this connection is for. Required for `connect()` to pair automatically, and for `pair()` |

### `portix.connect(): Promise<void>`

Verifies the runtime is reachable (skipped entirely in mock mode) — throws a `RuntimeUnreachableError` if it isn't installed or isn't running (message includes the download link; in a browser, also best-effort opens [portix.one/download](https://portix.one/download) itself via `window.open()` — a no-op if `connect()` wasn't called from inside a user gesture like a click handler, since popup blockers require that). Then, unless you passed an explicit `apiKey`: if the current credential doesn't work yet, pairs automatically using `appId`/`tenant` (instant from `localhost`/your own LAN, otherwise blocks until a human approves it from the PortixOne tray's "Pairing Requests" menu, throwing if that never happens within the pairing code's TTL). A previously-approved pairing is remembered in the browser (`localStorage`) so this only blocks once per `appId`/`tenant`, not on every `connect()` — Node has no persistence, so a script re-pairs on every run.

### `portix.disconnect(): Promise<void>`

Ends the SDK session: stops any in-flight pairing poll, closes the live-events socket if one was opened, and drops the connection. Doesn't affect the pairing itself — call `connect()` again later and it's still paired.

### `portix.print({ content, printerName?, copies? }): Promise<{ jobId, status, message? }>`

Sends a print job. `status` is `"pending"` right after this call resolves — the job is processed asynchronously. See `on()` below to follow it to `"printing"`/`"completed"`/`"failed"`.

### `portix.getStatus(): Promise<{ status, version, defaultPrinter? }>`

Reads the runtime's health endpoint (or a static mock status in mock mode).

### `portix.ping(): Promise<{ pong: boolean }>`

A cheaper liveness check than `getStatus()` — no version/printer info, just "is it up".

### `portix.listPrinters(): Promise<PrinterInfo[]>`

Every printer the runtime can see, with `{ name, driver?, port?, status?, online }`. Empty array in mock mode.

### `portix.getPrinter(name): Promise<PrinterInfo>`

Same shape as one entry from `listPrinters()`. Throws `PRINTER_NOT_FOUND` if it doesn't exist.

### `portix.getJobs(): Promise<JobRecord[]>`

Every job this connection is allowed to see — all jobs for the admin key, only this tenant/app's own jobs once paired.

### `portix.cancel(jobId): Promise<{ jobId, status, message? }>`

Cancels a job that hasn't started printing yet. Throws `JOB_NOT_CANCELLABLE` if it's already printing/completed/failed/cancelled, `JOB_NOT_FOUND` if it isn't yours or doesn't exist.

### `portix.pair(): Promise<{ code, expiresAt }>`

Starts pairing and returns the code immediately instead of waiting for approval — for showing it in your own UI rather than letting `connect()` block on it (see above). Requires `tenant`/`appId` in the constructor options.

### `portix.getMetrics(): Promise<RuntimeMetrics>`

Milestone 4's measurement layer: job counts/durations (`jobs.avgDurationMs`, `jobs.byStatus`), pairing duration (`pairing.avgPairingDurationMs`), and WebSocket disconnects (`websocket.totalDisconnects` — named honestly: it counts disconnects, not successful reconnections, since there's no reconnect-on-drop logic yet). Requires the admin key — not available to a paired app.

### `portix.on(event, handler): () => void`

Subscribes to real-time events pushed by the runtime — `"status"`, `"job:queued"`, `"job:printing"`, `"job:printed"`, `"job:error"`, `"job:cancelled"` — plus the SDK-local `"paired"` event. Returns an unsubscribe function. Opens a WebSocket to the runtime on first use; needs a browser or Node 22+ (older Node logs a warning and falls back to no live events — poll `getJobs()` there instead).
