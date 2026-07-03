# PortixOne Roadmap

## Runtime

- [x] Runtime boots
- [x] HTTP API
- [x] Windows Spooler Driver
- [x] First Physical Print

## Phase 2 — Developer Zero

**Objective**: validate that a developer who has never seen PortixOne can install it, connect to the runtime, and print a receipt without any assistance.

Guiding question: *"Can a complete stranger successfully use PortixOne without asking the founder for help?"* If yes, onboarding is complete.

**Guiding principle**: do not add new features until an external developer has successfully used the previous one. The current risk is no longer technical — it's adoption.

- [ ] **2.1 — Publish the SDK** (highest priority): `@portix/sdk` on npm, SemVer, changelog, production-ready README, TS typings, `npm install @portix/sdk` works with no manual steps and no cloning
- [ ] **2.2 — Official Runtime Installer**: download → install → start runtime → `npm install @portix/sdk` → `new Portix()` → `connect()` → `print()`, no manual configuration
- [ ] **2.3 — Mock mode**: `new Portix({ mode: "mock" })` renders a receipt preview instead of printing — zero hardware requirement, better tutorials/CI/first experience. Switching to production is only `mode: "runtime"`
- [ ] **2.4 — Measure TTFP** (Time To First Print: from opening the docs to the first successful print). Good: < 5 min. Excellent: < 2 min. Measure continuously
- [ ] **2.5 — External developer validation**: 5 external developers (React, Next.js, Vue, Electron, Node.js), documenting install problems, doc gaps, confusing APIs, runtime issues, error messages, missing examples. Fix every issue before adding major new features

### Not yet (delayed until Developer Zero is validated)

Linux Runtime · macOS Runtime · Bluetooth · Serial · USB Discovery · Multi-printer · Cloud · Marketplace · Analytics · Billing — implement only if one of them directly blocks onboarding.

## Phase 3 — Ecosystem

After onboarding validation: Device Discovery · Printer Status API · Multi-printer Support · Linux Runtime · macOS Runtime · USB/HID/Bluetooth · Scales · Cash Drawers · SDK for Go · SDK for Python · SDK for .NET.

## Cloud Platform (closed, separate repo)

Auth, projects, API keys, dashboard, device fleet management, licensing, telemetry, team organizations, managed updates, billing, enterprise sync. Not tracked in this roadmap — see [Open source vs. closed](README.md#open-source-vs-closed) in the README.

---

**Product philosophy**: the objective is no longer proving that PortixOne works — it already does. The objective now is proving that anyone can make it work. When an external developer can install PortixOne, connect to a runtime, and print a receipt in under two minutes using only the official documentation, the onboarding phase is complete. Only then should the platform aggressively expand its capabilities. Developer Zero comes before Feature One.
