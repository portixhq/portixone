# kubia-demo

"Kubia" is a stand-in name for any SaaS integrating PortixOne — this walks through Milestone 3's actual target flow, not a simplified version of it:

Register business → connect a printer (pair) → choose which one → save → make a sale → print.

## Run it

1. Start the PortixOne Runtime (`npm run dev` in `runtime/`) and the Tray (`npm run dev` in `tray/`) — the Tray's **Pairing Requests** menu is how you approve the pairing request in step 2.
2. Build the SDK and its dependencies once from the repo root: `npm run build`.
3. Open `index.html` directly in a browser — no dev server or bundler needed.

Uses the monorepo's local `sdk-js` build via relative imports (not the published `@portixone/sdk` npm package, like `examples/basic-print/` does) — `pair()`, `listPrinters()`, and `on()` are newer than the last publish.

## What it exercises

- `new Portix({ appId, tenant })` + `connect()` — steps 1
- `pair()` — shows the real pairing code and waits for the `'paired'` event; steps 2
- Approving from the Tray's Pairing Requests menu (or, without the Tray, `POST /pairing/approve` with the runtime's admin key — the same call the Tray itself makes)
- `listPrinters()` — a real dropdown populated from whatever the runtime actually detects, not a hardcoded list; step 3
- `print()` — sends an actual receipt for the "sale", using the token this demo's own tenant/app got from pairing, scoped exactly like any other paired integration; step 4

Each step only unlocks after the previous one actually succeeds, same as a first-time integrator would experience — not a shortcut through the flow.

## Verified

Run end to end in a real browser against a live runtime: registered, paired (a real code generated and approved), the printer dropdown populated with this machine's actual installed printers, a printer selected and saved, and a sale printed successfully (`status: "completed"`, correctly attributed to `{ tenant: "acme-cafe", appId: "kubia" }` in `GET /jobs`).
