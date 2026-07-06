# @portixone/sdk

## 0.3.1

- `print()` in mock mode now returns `preview` on the result — the rendered receipt text, not just a console.log side effect. Lets a developer render the mock preview in their own UI instead of only the terminal.
- Fixed unclear errors when the runtime responds with something other than JSON (an unreachable host hitting a captive portal, a reverse proxy, or an empty body) — `ClientAdapter` now parses defensively and throws a message that says what's actually wrong instead of a raw `JSON.parse` `SyntaxError`.

## 0.3.0

New methods, matching the runtime's Local API and Milestone 3/4 work — this release is what makes `npm install @portixone/sdk` reflect everything built since `0.2.0`:

- `pair()` — requests pairing for a `{ tenant, appId }` app identity and returns a short code; polls the runtime until approved, then swaps in a scoped token and emits a `'paired'` event. Requires `tenant`/`appId` in the `Portix` constructor options.
- `disconnect()` — ends the SDK session: stops any pairing poll, closes the live-events socket, drops the connection.
- `listPrinters()` / `getPrinter(name)` — printer discovery, backed by the new `PrinterInfo` type.
- `getJobs()` / `cancel(jobId)` — job history and cancellation.
- `ping()` — a lightweight liveness check, cheaper than `getStatus()`.
- `on(event, handler)` — subscribes to runtime job events (`job:queued`, `job:printing`, `job:printed`, `job:error`, `job:cancelled`) or the SDK-local `'paired'` event over a WebSocket connection (`RuntimeSocket`, new).
- `getMetrics()` — Milestone 4's measurement layer: job counts/durations, pairing duration, WebSocket disconnect count.

Also: `PortixOptions` gained `appId`/`tenant` fields (required for `pair()`), and `@portixone/protocol`/`@portixone/shared` were bumped to `^0.2.0` to match — see their own changelogs for the underlying `JobStatus` wire change.

## 0.2.0

- `mode: "mock"` — renders a receipt preview instead of printing, zero hardware/runtime requirement.

## 0.1.0

- Initial release: `connect()`, `print()`, `getStatus()`.
