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

## Pairing — for multi-tenant SaaS integrations

If you're building a product other people's businesses install PortixOne for (like Kubia), don't share the runtime's admin key with your app. Instead, pair each installation once:

```js
const portix = new Portix({ tenant: "acme-cafe", appId: "kubia" });
await portix.connect();

const { code } = await portix.pair();
// Show `code` (e.g. "M8K4-LPQ9") to whoever is at the machine — they approve
// it locally on the runtime. No tray UI for this yet; see the runtime's
// `POST /pairing/approve` (admin-key only) in the meantime.

portix.on("paired", ({ deviceId, permissions }) => {
  // From here on, print()/getJobs()/cancel() are scoped to this tenant/app —
  // no repeated authorization, ever.
});
```

`tenant` and `appId` are required to call `pair()` — they're how the runtime tells your integration apart from every other app paired to the same machine.

## API reference

### `new Portix(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `"runtime" \| "mock"` | `"runtime"` | `"mock"` needs no runtime and no printer |
| `apiKey` | `string` | `"dev-local-key"` | Must match the runtime's `PORTIX_LOCAL_API_KEY` — only needed until `pair()` is used |
| `host` | `string` | `"127.0.0.1"` | Runtime host |
| `port` | `number` | `17321` | Runtime port |
| `appId` | `string` | — | Your integration's identity. Required for `pair()` |
| `tenant` | `string` | — | The specific business/customer this connection is for. Required for `pair()` |

### `portix.connect(): Promise<void>`

Verifies the runtime is reachable (skipped entirely in mock mode). Throws if it isn't — call this before any other method.

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

Starts pairing (see above). Requires `tenant`/`appId` in the constructor options.

### `portix.getMetrics(): Promise<RuntimeMetrics>`

Milestone 4's measurement layer: job counts/durations (`jobs.avgDurationMs`, `jobs.byStatus`), pairing duration (`pairing.avgPairingDurationMs`), and WebSocket disconnects (`websocket.totalDisconnects` — named honestly: it counts disconnects, not successful reconnections, since there's no reconnect-on-drop logic yet). Requires the admin key — not available to a paired app.

### `portix.on(event, handler): () => void`

Subscribes to real-time events pushed by the runtime — `"status"`, `"job:queued"`, `"job:printing"`, `"job:printed"`, `"job:error"`, `"job:cancelled"` — plus the SDK-local `"paired"` event. Returns an unsubscribe function. Opens a WebSocket to the runtime on first use; needs a browser or Node 22+ (older Node logs a warning and falls back to no live events — poll `getJobs()` there instead).
