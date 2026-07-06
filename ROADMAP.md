# PortixOne Roadmap

**Goal**: when a developer lands on portix.one, the point isn't explaining what PortixOne does — it's getting them printing from their own application in under 5 minutes. Time To First Print (TTFP) is the project's primary KPI, and every phase below is sequenced to protect it.

**Three stages** (2026-07-05):

```
Fase 1–6   → Build the product
Fase 7–9   → Build the developer experience
Fase 10–12 → Build the business
```

Up through Fase 6 this is engineering. From Fase 7 on, the work shifts to how the product is perceived and adopted — branding, the landing, and documentation stop being "marketing" and become part of the product itself, because a technically solid runtime that nobody can discover or trust is indistinguishable from one that doesn't work.

---

## FASE 1 — Core Architecture ✅

SDK, Protocol, Shared, Runtime, HAL, communication layer, API design — the architecture meant to hold for years. Completed.

## FASE 2 — Public SDK ✅

`npm install @portixone/sdk` works today: published on the public registry, versioned, clean imports, basic docs. **2026-07-05**: republished as `@portixone/sdk@0.3.0` (with `@portixone/protocol@0.2.0` and `@portixone/shared@0.2.0`) — every pairing/metrics/queue method built since `0.2.0` is now live, verified with a real `npm install` outside the monorepo. Tagged and released on GitHub (`sdk-v0.3.0`, `protocol-v0.2.0`, `shared-v0.2.0`) with changelogs.

## FASE 3 — Runtime 🟡

The bridge between the browser and the OS: Windows service, local WebSocket, persistent queue, reconnection, printer discovery, persistence, auto-updates. Detailed build history: [MILESTONE_3.md](MILESTONE_3.md). Mostly built and verified against a live runtime. Two open items: real reconnect-on-drop logic in the SDK's WebSocket client (today `websocket.totalDisconnects` honestly counts disconnects the SDK never recovers from automatically — see project memory on metric naming), and a local dashboard (`localhost` page for status/printers/queue/logs) that's been scoped but not built.

## FASE 4 — Runtime Installer 🟡

Eliminate manual installation entirely — double-click, and "Runtime Running" appears with zero configuration. Must install the service, runtime, tray app, auto-updates, and drivers where applicable. **2026-07-05**: the hard blocker is resolved — `installer/build-staging.js` now downloads a pinned, checksum-verified Node.js binary and ships it under `{app}\node\node.exe`; `portixone.iss` runs the service installer, service uninstaller, and tray app through that bundled binary instead of searching the system `PATH`, and (verified) `node-windows` picks up `process.execPath` automatically, so the registered Windows Service itself runs on the bundled Node with no changes to `runtime/scripts/service.install.js`. Verified: staged runtime/tray resolve their own `node_modules` and boot correctly against the bundled `node.exe` alone. `installer\dist\PortixOneRuntimeSetup.exe` compiles cleanly against the new `.iss`, and a second, admin-free **Portable build** (`installer/build-portable.js` → `PortixOneRuntimePortable.zip`, no Windows Service/registry) was added and verified — the bundled `node.exe` runs the staged runtime standalone and answers `GET /health`. **Known tech debt**: a real end-to-end install on a machine with zero Node.js/dev tools is still unverified — Windows Sandbox didn't come up on the dev machine after two enable+reboot attempts, and no spare physical machine was available; picking this back up just needs a working Sandbox/VM or a second machine, not more code. See [MILESTONE_4.md](MILESTONE_4.md)'s Distribution epic for the full note. Remaining gaps: no code-signing certificate, no MSI build alongside the two formats above.

## FASE 5 — Pairing & Onboarding 🔜

`Download Runtime → Open → Connect → Pair → Done`, with no file editing, no token copying, no port configuration. The pairing mechanism itself exists (Milestone 3); what's left is making the full path feel automatic end-to-end, including a guided first print.

## FASE 6 — Error System 🔜

Errors a human can act on instead of raw exceptions — `ECONNRESET` becomes `Printer Offline`, `Out of Paper`, `Runtime not installed`, `Permission denied`, `Printer busy`, each naming its own fix. Base error handling exists from Milestone 3's hardware-failure work; still open: a debug-mode toggle for verbose logging, and a systematic pass over every error path to confirm it meets this bar.

## FASE 7 — Branding & Design System 🔜

Where Portix.one starts existing as a brand, not just a repo: wordmark, isotype, responsive logo, color palette, typography, iconography, spacing system, UI components, illustrations, motion guidelines, design tokens, brand voice, and the documentation to keep it all consistent across Landing, Docs, Runtime, Dashboard, SDK, GitHub, and social. Deliberately not started before now — branding before the underlying functionality was physically verified would have been solving the wrong problem first.

## FASE 8 — Landing Experience 🟡

A landing built to be *used* within minutes, not one built to sell. Full section-by-section spec: [LANDING.md](LANDING.md). Its only objective is minimizing Time To First Print. **2026-07-05**: `portix.dev` rebuilt live on `portix.one` — printing-first hero, comparison table, compatibility grid, open source links, docs cards, a public Pricing section, and a qualifying "Join Developer Preview" form (all non-Business CTAs route there instead of open self-serve signup, since Fase 10/11 haven't validated the product with a stranger yet). Honest "Developer Preview" badge instead of overclaiming readiness. What's left: real visual identity once Fase 7 exists — today's version uses the pre-existing placeholder design system, not a finished brand.

## FASE 9 — Documentation 🔜

Quick Start, SDK reference, Runtime reference, API reference, Examples, FAQ, Troubleshooting, Roadmap, Changelog. Current state and gaps, detailed in [MILESTONE_4.md](MILESTONE_4.md)'s Developer Portal epic: docs today are scattered across per-package READMEs; examples exist and actually run (`basic-print`, `kubia-demo`, `stress-test`); no unified docs site, API reference, FAQ, or changelog yet.

## FASE 10 — First External Developer 🔜

Someone with zero contact with the founder gets a real print working using only the documentation — they don't message, they don't ask. Metric: **TTFP < 5 minutes**, ideal **< 2 minutes**. The `kubia-demo` audit ([MILESTONE_4.md](MILESTONE_4.md)'s Kubia epic — confirmed zero PortixOne-internal code leaking into a consumer) is the last internal check before a true outside stranger attempts this for real.

## FASE 11 — First Paying Customer 🔜

One real business paying for PortixOne because it solves a real problem for them. The amount doesn't matter — what's being validated is that the pain is real enough for someone to pay for the fix.

## FASE 12 — Scaling 🔜

After Fase 11 validates the business: Linux, macOS, Cloud Dashboard, Fleet Management, Multi-Tenant, Analytics, Teams, SSO, additional SDKs (Go, Python, .NET) — the full ecosystem, built only once there's a paying reason to.

---

## Detailed breakdowns

- [MILESTONE_3.md](MILESTONE_3.md) — Runtime build-out: the groundwork behind Fases 3–6.
- [MILESTONE_4.md](MILESTONE_4.md) — Distribution, Publishing, Developer Portal, Validation, and Kubia epics: the detail behind Fases 4, 9, and 10.
- [LANDING.md](LANDING.md) — full landing page spec: the detail behind Fase 8.

## Cloud Platform (closed, separate repo)

Auth, projects, API keys, dashboard, device fleet management, licensing, telemetry, team organizations, managed updates, billing, enterprise sync. Not tracked in this roadmap — see [Open source vs. closed](README.md#open-source-vs-closed) in the README. This is the commercial surface Fase 11–12 eventually build toward.

## Pricing model (for Fase 11)

The monetization principle: revenue must never precede value. The SDK stays free and open; commercial value concentrates in the Runtime and the capabilities around administering it, so payment only becomes relevant once PortixOne is already part of a customer's workflow.

- **Free** — SDK, 1 Runtime, 1 Printer, unlimited development use, community support, basic updates. `$0`.
- **Pro** — unlimited printers, auto-updates, logs, monitoring, remote pairing, priority support, commercial use. Suggested `$19–29/month`.
- **Business** — multi-tenant, fleet management, cloud dashboard, teams, analytics, SSO, SLA. `Contact Sales`.

---

**Product philosophy**: the objective is no longer proving that PortixOne works — it already does. The objective now is proving that anyone can make it work, and that they'll pay for it once it's part of their workflow. When an external developer can install PortixOne, connect to a runtime, and print a receipt in under two minutes using only the official documentation, Fase 10 is complete. Only then should the platform aggressively expand its capabilities. Developer Zero comes before Feature One — TTFP before anything else.
