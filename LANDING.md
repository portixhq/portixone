# Landing Page Spec — portix.one (Fase 8)

**Objective**: turn visitors into active developers. This is not a marketing page — it's onboarding. Every section exists to move a visitor toward `print()` as fast as possible, in service of the project's Time To First Print (TTFP) KPI. See [ROADMAP.md](ROADMAP.md) for how Fase 8 fits into the overall launch sequence.

---

## Hero

Answers exactly one question: what problem does this solve?

```
Print from any web app.

No browser dialogs.
No native code.
Just one API.
```

Buttons: `Get Started`, `Documentation`.

Right side: an animated terminal —

```
npm install @portixone/sdk

✓ Runtime detected
✓ Printer connected
✓ Printing...
```

## Section 2 — How it works

An animated diagram, understandable in under 10 seconds:

```
Your App
   ↓
Portix SDK
   ↓
Portix Runtime
   ↓
Printer
```

## Section 3 — Installation

```
Download Runtime
   ↓
Install
   ↓
npm install
   ↓
connect()
   ↓
print()
```

Must feel absurdly simple.

## Section 4 — Code

Show only the minimal example. Nothing else on this section.

```js
import { Portix } from "@portixone/sdk"

const portix = new Portix({ appId: "my-app", tenant: "default" })

await portix.connect()
await portix.print(receipt)
```

## Section 5 — Comparison

**Browser Printing**: ❌ Print Dialog · ❌ Mobile Issues · ❌ Drivers · ❌ Browser Differences · ❌ User Interaction

**vs. Portix**: ✅ Silent Printing · ✅ Queue · ✅ Runtime · ✅ WebSocket · ✅ One API

## Section 6 — Features

Cards: Silent Printing, Queue, Auto Reconnect, Printer Discovery, Status Events, Cross Browser, Cross Framework, Local Runtime.

## Section 7 — Compatibility

Windows, ESC/POS, USB, Network, Bluetooth (Coming Soon), Linux (Roadmap), macOS (Roadmap).

## Section 8 — Examples

React, Vue, Angular, Next.js, Node, Electron, Vanilla JS — each linking to its repository example.

## Section 9 — Documentation

Cards: Quick Start, SDK, Runtime, API, Examples, FAQ, Roadmap, Changelog.

## Section 10 — Open Source

GitHub, Discord, Contributors, Releases, Issues, Roadmap. Must read as trustworthy.

## Section 11 — Pricing

See [ROADMAP.md](ROADMAP.md)'s pricing model (Free / Pro / Business) for the current tier definitions — kept in one place to avoid the two documents drifting apart.

---

## Full developer flow

```
Google
  │
  ├── Reddit
  ├── GitHub
  ├── Stack Overflow
  ├── X
  └── LLMs
        │
        ▼
Landing (portix.one)
        │
        ▼
Hero
        │
        ▼
Get Started
        │
        ▼
Quick Start
        │
        ▼
Download Runtime
        │
        ▼
Installer
        │
        ▼
Runtime Running
        │
        ▼
npm install @portixone/sdk
        │
        ▼
connect()
        │
        ▼
Printer Detected
        │
        ▼
print()
        │
        ▼
🎉 First ticket printed
        │
        ▼
Runtime Dashboard
        │
        ▼
Continued use
        │
        ▼
More printers, more teams, more customers
        │
        ▼
Upgrade to Pro
        │
        ▼
Business
```

## Monetization funnel

Monetization must never happen before the user has already gotten value. Ideal flow:

1. The developer finds PortixOne while searching for how to print from a web app.
2. They land on the page and understand the product in under 30 seconds.
3. They download the Runtime and install the SDK.
4. They print their first ticket in under 5 minutes.
5. They integrate PortixOne into a real project.
6. When they need multiple printers, auto-updates, monitoring, or remote administration, the incentive to upgrade to Pro appears.
7. If they manage multiple locations or clients, Business is the natural next step.

The strategy: the SDK stays free and open, while commercial value concentrates in the Runtime and the services and administration capabilities built around it. That removes friction from initial adoption and makes payment happen only once the product is already part of the customer's workflow.
