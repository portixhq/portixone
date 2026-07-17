# printer-setup — a `setup()` reference

A "Configure printer" screen driven entirely by `portix.createSetup()`.

The application renders `setup.getState()` and calls its actions — `assignPrinter`, `printTest`,
`confirm`, `refresh`. It writes **no** connection, pairing, printer-selection, or test-print logic of
its own. That is what `setup()` is for: the SDK owns the sequence, your product owns the pixels.

Contrast [`../kubia-demo`](../kubia-demo), which wires the same register → pair → choose → test flow
by hand.

## The flow

`createSetup({ target })` returns a headless state machine. Each `getState().step` maps to one
screen:

| step | what the app shows |
|---|---|
| `runtime_unreachable` | "Install the Runtime" + a download link (`state.downloadUrl`) |
| `runtime_incompatible` | "Update the Runtime" |
| `pairing_required` / `pairing_pending` / `pairing_denied` | approve this app in the tray |
| `selecting_printer` | a dropdown of `state.printers`, then `assignPrinter(name)` |
| `testing` | "Did it print?" → `confirm(true)` / `confirm(false)` / `printTest()` |
| `ready` | done — printing works |

It is **resumable**: the mapping lives on the Runtime, so re-running `setup.start()` after a reload
lands on the right step — `ready` if already configured, `selecting_printer` if a printer was
uninstalled, and so on. There is no local progress to persist and go stale.

## Run it

The Runtime must be running (`npm run dev` in `runtime/`), and the SDK must be built
(`npm run build` at the repo root) — this example imports the local build so it runs against your
working tree before publish. A real integrator writes `import { Portix } from '@portixone/sdk'`.

Serve the folder over http (an ES-module page won't load from `file://`):

```bash
npx --yes http-server examples/printer-setup -p 4173 -c-1
# then open http://127.0.0.1:4173
```

On `localhost` the pairing auto-approves, so you go straight to choosing a printer. Pick one, print
the test, confirm it — and you're `ready`.
