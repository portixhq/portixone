# @portixone/sdk

## 0.3.4

- Mock-mode preview box now aligns: the content rows were one column short of the frame, so the right edge never lined up with the top/bottom corners. Purely cosmetic — `print()`'s returned `preview` string and every other behavior is unchanged.

## 0.3.3

- A missing/unreachable Runtime now throws a clear `RuntimeUnreachableError` ("Could not reach the Portix Runtime at ... — it's probably not installed or not running. Download it from https://portix.one/download and try again.") instead of a raw `TypeError: fetch failed`. In a browser, `connect()` also best-effort opens the download page itself via `window.open()` — silently a no-op where popup blockers require a user gesture, which is why the message always states the URL too. `RuntimeUnreachableError` is exported for apps that want to handle it with their own UI instead.

## 0.3.2

- `connect()` now pairs automatically when it isn't authorized yet, using `appId`/`tenant` from the constructor — no separate `.pair()` call needed for the common case. Instant from `localhost`/your own LAN (the runtime's existing auto-trust); otherwise blocks until a human approves it from the PortixOne tray's "Pairing Requests" menu, throwing a clear error if the pairing code expires first. Skipped entirely if you pass an explicit `apiKey`. Found by actually tracing the documented Quickstart against a fresh install: it silently failed with `INVALID_API_KEY` on `print()` because pairing was never mentioned in it at all.
- A successful pairing is now persisted (browser `localStorage` only) so it's asked for once per `appId`/`tenant`, not on every `connect()`/page load. `pair()`'s existing background-poll path persists it too, for the same reason.
- `pair()` is unchanged (still returns the code immediately for showing it in your own UI) — it's now the "I want to control the approval UX myself" alternative to `connect()`'s default auto-pairing, not the only way to pair.

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
