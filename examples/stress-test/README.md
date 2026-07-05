# stress-test

Milestone 4's stress-test item: fire 100/500/1000 print jobs at a real runtime and see what happens, instead of assuming it holds up.

## Run it

```bash
node index.mjs [count]
# or
STRESS_COUNT=1000 STRESS_CONCURRENCY=20 node index.mjs
```

Requires the runtime running and `sdk-js` built (`npm run build` from the repo root). Defaults to `127.0.0.1:17321` with the `dev-local-key` admin key — override with `PORTIX_HOST` / `PORTIX_PORT` / `PORTIX_API_KEY`.

**Point this at a `mock`-driver runtime unless you actually want that many sheets of paper** — it prints for real against whatever driver the runtime is configured with. `PORTIX_PRINTER_DRIVER=mock npm run dev` (in `runtime/`) before running this against real hardware.

## What it measures

- **Enqueue throughput** (client side) — jobs/sec the HTTP API can accept, and how long each `print()` call takes to return `202 Accepted`. This is *not* the same as print latency — `print()` returns as soon as a job is queued, not once it's actually printed.
- **Real print latency** (`GET /metrics`, runtime side) — `jobs.avgDurationMs` / `jobs.lastDurationMs` are the actual time from a job being queued to reaching `completed`, which is what "time from print() to paper" (Milestone 4's latency item) actually means. `jobs.byStatus` shows failures. `pairing.avgPairingDurationMs` and `websocket.totalDisconnects` are the other two metrics Milestone 4 asked for.

## Verified

Run live against this machine's own runtime (mock driver): 1000 jobs at concurrency 20 completed with 0 failures, confirming the persisted queue (`queue.json`, written synchronously on every transition) and its 1000-job retention cap both hold up under a burst that exactly fills that cap — see `MILESTONE_4.md` for the actual numbers.
