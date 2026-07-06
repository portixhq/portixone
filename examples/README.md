# Examples

- [`basic-print/`](basic-print) — the smallest standalone Node.js project using the public [`@portixone/sdk`](https://www.npmjs.com/package/@portixone/sdk) npm package (not a monorepo reference). Runs in mock mode out of the box — `npm install && npm start`, no runtime, no printer.
- [`print-ticket/`](print-ticket) — a real, properly formatted restaurant receipt (items, quantities, tax, total) instead of a "Hello World" string — the one to copy-paste as a starting point for an actual POS integration.
- [`quickstart-html/`](quickstart-html) — minimal HTML page that uses `@portixone/sdk` to print a test ticket against the local runtime. Serves the "Time to First Print" goal directly.
- [`kubia-demo/`](kubia-demo) — Milestone 3's full target flow end to end: register a business → pair → choose a printer → make a sale → print. The one to point at if someone asks "what does actually integrating this look like end to end".
- [`stress-test/`](stress-test) — Milestone 4's load-testing tool: fires 100/500/1000 `print()` calls at a real runtime and reports enqueue throughput plus the runtime's own `GET /metrics` (real print latency, failures, pairing time).

`quickstart-html`, `kubia-demo`, and `stress-test` require `npm run build` (in the `sdk-js` workspace, or the whole repo) before running, and the runtime running (`npm run dev`). `basic-print` needs neither — it installs the real published package.
