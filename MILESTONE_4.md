# Milestone 4 — Productization

> **Mapping note (2026-07-05)**: [ROADMAP.md](ROADMAP.md) now organizes the project as Fase 1–12. This document's five epics map onto that numbering as: Distribution → Fase 4 (Runtime Installer), Publishing → ongoing under Fase 2 (Public SDK), Developer Portal → Fase 9 (Documentation), Validation & Kubia → Fase 10 (First External Developer). Kept as-is here since the factual detail is still accurate — treat `ROADMAP.md` as the entry point and this file as the supporting depth.

**Objective**: this is no longer engineering work. PortixOne already works — Milestones 1–3 proved that. The job now is turning "works" into "shippable, installable, documented, and used in production" by someone who isn't the founder. Five epics, not a feature list.

**Philosophy shift, in the user's own words (2026-07-05)**: *"Ya no pensaría en desarrollar. Pensaría en validar."* — and on strategy: freeze the Core for a few weeks and spend that time on distribution, publishing, and real integration instead of new Runtime/Queue/Pairing/SDK code.

Status legend: ✅ done & verified · ⚠️ built but not fully verifiable yet · ❌ not started / needs a human or hardware this session doesn't have

---

## Epic 1 — Distribution

Getting PortixOne onto a machine that has never seen a dev environment.

- ✅ **Embedded Node** (2026-07-05): `installer/build-staging.js` downloads a pinned, checksum-verified Node.js binary from `nodejs.org` and stages it at `staging/node/node.exe`; `portixone.iss` ships it under `{app}\node` and runs every Node-based step (`service.install.js`, `service.uninstall.js`, the tray app) through that path instead of `where node`. `node-windows` defaults its service `execPath` to `process.execPath`, so the registered Windows Service inherits the bundled binary automatically — verified this resolves correctly and that `node-windows` loads from the staged `node_modules` using only the bundled `node.exe`, no system Node involved. `installer/dist/PortixOneRuntimeSetup.exe` compiled successfully with Inno Setup 6 against the new `.iss`.
  - ⚠️ **Known tech debt — not yet verified on a genuinely clean machine.** Attempted to set this up via Windows Sandbox (`Containers-DisposableClientVM` optional feature) on the dev machine; the feature didn't come up after two `Enable-WindowsOptionalFeature` + reboot cycles (`WindowsSandbox.exe` still absent from `System32` afterward — cause not diagnosed further, deprioritized rather than debugged). No second physical machine was available either. **What's still unproven**: an install on a machine with zero Node.js/dev tools present. Everything short of that — the binary resolving correctly, `node-windows` loading from bundled `node_modules`, a clean compile — is verified. Picking this back up needs either a working Windows Sandbox/VM or a spare physical Windows machine.
- ❌ **Code Signing**: no certificate exists yet. The installer is unsigned and triggers SmartScreen. Tracked as deliberate tech debt since Milestone 2.2, still open.
- ⚠️ **Single Installer**: `installer/portixone.iss` (Inno Setup) exists, compiled, and verified end-to-end on the dev machine — install, reinstall-while-running, uninstall all fixed and re-verified (see `installer/README.md`). Not yet verified on a machine that never had PortixOne or Node on it.
- ✅ **Portable Installer** (2026-07-05): `installer/build-portable.js` packages the same staged `node`/`runtime`/`tray` into `installer/dist/PortixOneRuntimePortable.zip` — no installer UI, no admin rights, no Windows Service/registry changes, just unzip and run `Start PortixOne.bat`. Verified: the bundled `node.exe` starts the runtime standalone from that folder and `GET /health` responds correctly. Deliberate limitation (documented in the package's own `README.txt`): doesn't survive a reboot or run without a logged-in user — that trade-off is what makes it admin-free, and the full Setup.exe installer is still the answer when auto-start-on-boot matters.
- ❌ **MSI**: current installer is Inno Setup (`.exe`), not MSI. No MSI packaging started — relevant if enterprise/Group Policy deployment ever becomes a requirement.

## Epic 2 — Publishing

Getting the SDK and Runtime into other developers' hands through normal channels.

- ✅ **npm** (2026-07-05): `@portixone/shared@0.2.0`, `@portixone/protocol@0.2.0`, and `@portixone/sdk@0.3.0` are all live on the public registry — `pair`, `disconnect`, `listPrinters`, `getPrinter`, `cancel`, `getJobs`, `ping`, `on`, and `getMetrics` are all published now. Verified with a real `npm install @portixone/sdk@0.3.0` from outside the monorepo: the class loads and every new method is present on the prototype.
- ✅ **GitHub Releases** (2026-07-05): tagged and released `shared-v0.2.0`, `protocol-v0.2.0`, `sdk-v0.3.0` on GitHub, notes drawn from each package's changelog.
- ⚠️ **Versioning**: semver bumps are now judged deliberately per-release (checked the actual diff to classify breaking vs. additive — e.g. `protocol`'s `JobStatus` shape change was breaking, `shared`'s new error classes were additive) rather than guessed, but there's still no written policy doc codifying this for next time.
- ✅ **Changelog** (2026-07-05): `CHANGELOG.md` added to `packages/shared`, `packages/protocol`, and `sdk-js`. Found via `npm pack --dry-run` that npm's always-included-files list is only `package.json`/`README`/`LICENSE` — `CHANGELOG.md` needed adding to each package's `files` array to actually publish, which was missed on the first pass and caught before publishing.
- ✅ **Release Notes** (2026-07-05): written as part of the three GitHub Releases above.

## Epic 3 — Developer Portal

The surface an external developer meets before ever touching code.

- ⚠️ **Docs**: currently spread across `README.md` files (`sdk-js/README.md`, `examples/README.md`, `installer/README.md`) — no unified docs site.
- ❌ **API reference**: `packages/protocol` defines the real contract, but there's no generated or hand-written API reference for it.
- ❌ **Playground**: no in-browser/interactive playground exists.
- ⚠️ **Examples**: `examples/basic-print`, `examples/kubia-demo`, `examples/stress-test` all exist and have been run for real this session/prior sessions — this is the strongest part of Epic 3 today.
- ❌ **FAQ**: doesn't exist yet.

## Epic 4 — Validation

The 7-item real-world checklist (renumbered from the original session; item 1 — clean install — now lives under Epic 1 since it's a distribution blocker, not a validation task).

### Confirmed physical output from the dashboard "Print test ticket" button

❌ **TECH DEBT — open, hardware-gated (2026-07-10).** The dashboard flow is code-complete and its UI states are verified (the button polls `/jobs` for the real outcome and reports "Submitted to printer — accepted by Windows", deliberately NOT "Printed", because a spooler-accepted job is not proof of paper — confirmed via the Windows print event log that a job can report `completed` while the spooler silently stalls and nothing comes out). The runtime-side pre-flight was also relaxed so a transient `PrinterStatus: Error`/`Unknown` from generic/USB drivers warns instead of hard-blocking. **What's still unproven and must be closed when the physical printer is on hand**: (1) that clicking "Print test ticket" reliably produces a real physical ticket on the SICAR WL88S across several consecutive presses (one earlier attempt failed transiently, the flakiness is uncharacterized), and (2) that "Submitted to printer" can be upgraded to genuine confirmed-printed only once there's a trustworthy signal that paper actually came out. Both need the thermal printer connected — not available in the session that shipped these fixes.

### Different printer brands (Epson, Xprinter, Bematech, Star, Sicar, Generic/Text Only)

❌ **Needs physical hardware this session doesn't have.** Only `Sicar` (`SICAR WL88S`, driver "Generic / Text Only") has ever been print-tested for real (see [[portixone_printer_drivers]]). Epson/Xprinter/Star are standard ESC/POS over TCP:9100 in principle (`network.driver.ts` targets exactly that), so most likely to already work — but unverified. Bematech has known real-world ESC/POS quirks (a de facto Brazilian standard with its own escape sequences) — highest-risk brand on this list.

### Windows 10 / 11, Home / Pro

❌ **Needs multiple real machines or VMs.** Everything so far has run on one dev machine. No code-level reason to expect Home vs Pro to differ (no Group Policy / domain-only features used) — an assumption, not a finding.

### Permissions — admin vs standard user, antivirus, Windows Defender, Firewall

❌ **Needs a human testing real security software.** `PrivilegesRequired=admin` is expected/by-design. No explicit Windows Firewall rule exists (everything is `127.0.0.1`-only, loopback typically needs none — unconfirmed on aggressive third-party firewalls). Antivirus/Defender flagging the unsigned installer or `send-raw-print.ps1` is a real, unverified risk tied directly to Epic 1's missing code-signing certificate.

### Latency — time from `print()` to paper

✅ **Measured, not guessed.** `GET /metrics` reports `jobs.avgDurationMs` / `jobs.lastDurationMs`. Verified live under a 1000-job burst against the mock driver: `avgDurationMs: 5`, `lastDurationMs: 6`. The instrumentation is real; the interesting number still needs a real printer (mechanical feed/cut time, USB/spooler overhead aren't in the mock).

### Logs — what happens when it fails

✅ **Already solid, extended further.** Hardware failures produce specific, human-readable errors. `runtime/.data/runtime.log` persists everything. `GET /metrics`'s `jobs.byStatus.failed` gives an at-a-glance failure count. Still open: no debug-mode toggle for verbose logging on demand.

### Stress test — 100 / 500 / 1000 prints

✅ **Run for real, not just built.** `examples/stress-test/` fired 1000 `print()` calls at concurrency 20 against a live runtime: 1000/1000 accepted, 0 failures, 6.75s wall time (148 jobs/sec), `queue.json` confirmed holding exactly 1000 entries afterward (retention cap holding exactly at its limit). Deliberately not run against real hardware (paper cost) — `examples/stress-test/README.md` has the command for when real-hardware numbers are wanted.

## Epic 5 — Kubia

No demo. Production.

The distinction: not *Kubia Demo*, but *Kubia usa PortixOne* — a real `npm install @portixone/sdk` consumer with zero lines of code touching USB, ESC/POS, drivers, Windows, the queue, recovery, pairing internals, or hardware errors.

⚠️ **`examples/kubia-demo/index.html` audited against exactly that bar** (grepped for `ESC`, `USB`, `driver`, `winspool`, `escpos`, `queue`, `pairing.`, `Windows`, COM ports, port `9100`) — zero matches. The demo only calls `new Portix()`, `connect()`, `pair()`, `on()`, `listPrinters()`, `print()`. The boundary holds for this one example.

✅ **Now real** (2026-07-07): `kubia-demo/index.html` imports the real published `@portixone/sdk@0.3.1` from `esm.sh` — no monorepo build step, no relative import. Ran the exact flow end to end using the real npm package: `pair()` → a native Windows toast fired → approved from the tray → `listPrinters()` returned this machine's actual Windows-registered printers (including the real physical SICAR WL88S) → `print()` queued successfully. This is the closest simulation of a real Kubia integration this project can run without an actual outside stranger — what's left for that is Fase 10 itself, not more plumbing.

---

## The metrics (built and verified this session)

Four numbers, all from `GET /metrics` (`packages/protocol/src/metrics.types.ts`, `runtime/src/metrics/metrics.service.ts`) — aggregated from data already being persisted elsewhere:

- **Tiempo de pairing** — `pairing.avgPairingDurationMs`, from a new `pairingDurationMs` field on `PairingRecord`, computed once at `approve()` and persisted permanently.
- **Tiempo promedio por print** — `jobs.avgDurationMs` / `jobs.lastDurationMs`, from the already-persisted `createdAt`/`updatedAt` on every job.
- **Fallos** — `jobs.byStatus.failed` (plus the full breakdown by status).
- **Reconexiones** — `websocket.totalDisconnects`, in `websocket.manager.ts`. **Named honestly, on purpose**: it counts *disconnects*, not *successful reconnections*, because the SDK's WebSocket client doesn't implement reconnect-on-drop yet. Calling it `Reconnect Count` would have been the natural name and would have been a lie — every value in this counter today is a disconnect nothing ever recovered from. A metrics panel is only trustworthy if its names measure what the system actually does, not what it's supposed to do eventually. Worth protecting as a standard for every metric added from here on.

`portix.getMetrics()` added to the SDK for consistency with `getStatus()`/`ping()`.

**TTFP (Time To First Print)** — not a single number, because it spans a human clicking through an installer. What's measurable are its components: pairing duration (above) and first-print latency. The installation-time component still needs a human with a stopwatch.

---

## Recommended strategy: freeze the Core

The user's call, and the right one: freeze `Runtime`, `Queue`, `Pairing`, and the `SDK` for a few weeks. Every new line in those four areas is a chance to break something that already works, for a milestone that isn't about writing more of them.

Instead, spend that time on:

1. Publish the new SDK version to npm (Epic 2).
2. ~~Package the Runtime with embedded Node to remove that dependency (Epic 1).~~ Done 2026-07-05.
3. Prepare signed installers for when a certificate exists (Epic 1).
4. Test the full flow on machines that have never had PortixOne installed (Epic 4).
5. Integrate PortixOne into Kubia as a normal dependency and use it every day (Epic 5).

If Core changes turn out to be necessary during that integration, make them as point fixes backed by a real use case surfaced by daily use — not speculative hardening.

## What this session did NOT do, on purpose

Every checklist item that needs a human, real hardware, multiple machines, or real security software was left honestly unverified rather than assumed or faked. The measurement layer (metrics + stress test) was built and *actually run*, because that part doesn't need anything this session doesn't have.
