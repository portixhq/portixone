# Portix.One — Commercial License Terms (draft)

> **Draft for product/business ratification — not legal advice.** A real legal review is
> required before these terms are published or referenced in checkout. `TBD-<n>` markers
> point to the open decisions in [README.md](README.md).

---

## 1. Definitions

**Developer Identity** — a single Portix.One developer account (one human or one company acting
as the licensee). The license attaches to this identity, **not** to any application, end
customer, business, machine, or printer. It is the unit of billing for Creator.

**Application** — a software product the developer builds and distributes, registered in the
Portal and assigned a public **Application ID** (`app_<slug>_<rand>`). One Application may be
distributed to unlimited end customers.

**End customer** — the business (restaurant, store, warehouse, clinic, …) that runs a developer's
Application. The end customer never buys Portix, never holds a Portix account, never manages the
subscription, and never sees Portix billing UI.

**Installation** — one deployment of the Runtime on one machine, under an Application (and
optionally a tenant). Installations are unlimited and are **not** a billing unit.

**Commercial use** — operating an Application in production for the benefit of end customers:
i.e. distributing, selling, or deploying it beyond the developer's own build/test/validation.
Determined by an **ApplicationActivation** (production or trial), not by a self-declared flag or
by the `Origin` header alone (see plan §7).

**Development use** — building, testing, prototyping, demos, and end-to-end validation by the
developer, including on localhost, staging, and private/LAN environments.

---

## 2. Plans

### Free — Development License ($0)
Grants the full SDK and Runtime for **development use**: mock + runtime modes, real printing,
printer detection, E2E validation, unlimited local/dev projects, complete docs, local dashboard.
Free **may** register an Application, complete the readiness checklist, and activate **one
Launch Trial** per Application. Free **may not** keep an Application in `PRODUCTION_ACTIVE`
indefinitely, obtain perpetual production tokens, or generate commercial deployment tokens after
the trial window closes.

### Creator — Commercial License ($24/month or $240/year, per Developer Identity)
Grants **commercial use and redistribution** of the Runtime within the developer's Applications:
unlimited Applications, end customers, installations, and printers under one identity; production
Application IDs; signed production tokens; per-Application installers/links; simplified/automatic
pairing; updates and future capabilities that remain within the Creator tier.

Billed monthly at **$24/month** or annually at **$240/year** (two months free). The annual and
monthly plans grant identical capabilities; only the billing cadence differs.

### Founder Creator Pass ($240 one-time — launch only, 100 seats)
**The priority launch offer.** A one-time purchase granting **Creator for life** to one Developer
Identity, plus a Founder badge, early beta access, and feedback priority. Deliberately the same
$240 as one year of Creator, but paid once, forever — the lifetime-vs-annual contrast (capped at
100 seats) is the launch's primary conversion anchor. Once the 100 seats are gone the anchor is
gone, and Creator monthly/annual is the standard.

**Supply is a single, irrevocable total of 100 seats** at **$240 each**, sold only during the
launch window. The price does not change between seats, and **no second batch is ever opened** —
"Founder" means exactly 100, or the word is worthless. Portix may stage the *operational* release
internally (e.g. 25 / 25 / 50) to pace onboarding and support, but the public offer is one capped
limit of 100.

Ratified guarantee wording:

> Founder Creator Pass grants lifetime access to the Portix.One Creator tier for one individual
> Developer Identity. It includes all current and future capabilities designated as part of
> Creator. Separate products, enterprise services, usage-based cloud infrastructure and
> Business-tier capabilities are not included unless expressly stated.

---

## 3. Redistribution rights

Creator (and Founder) authorize the developer to **redistribute the Runtime** as part of their
Applications to unlimited end customers, under minimal Portix branding
("Printing Runtime for `<App>` — Powered by Portix.One"). Free does **not** grant sustained
commercial redistribution — only the Launch Trial window. Redistribution does not transfer any
ownership of Portix.One software, keys, or brand; the developer may not sublicense Portix.One
itself as a standalone product, remove signature verification for the purpose of evading
licensing, or represent Portix.One as their own infrastructure product.

---

## 4. Cancellation policy

- **Voluntary cancellation:** Creator remains active until the end of the paid period
  (`CANCEL_AT_PERIOD_END`), then moves to `CANCELLED`. Existing installations keep printing;
  new commercial activations/tokens/domains/installers are blocked going forward (plan §4, §13).
- **Founder Pass:** `LIFETIME`, no renewal, non-cancellable by lapse; bound to its Developer
  Identity. Refunds, if any, follow the standard launch-window refund policy (TBD — business).

---

## 5. Grace policy (never breaks the end customer)

Printing must never stop abruptly on the exact moment a license lapses. Grace is applied by cause
(plan §4), and the two kinds of grace are **never conflated**. The end customer is never shown
billing state; tickets are never watermarked.

**Technical grace** — an *infrastructure* failure, not an invalid license: Portix is down, no
internet, DNS failure, or the runtime simply can't reach the Portal. The last valid token keeps
working for **72 hours counted from the token's expiry** (not from the last successful heartbeat).
With a 48h token, an installation therefore operates ~5 days with no Portal contact. No developer
penalty.

**Commercial grace** — the Portal *is* reachable and knows the commercial state, but grants time
to regularize: Stripe couldn't charge, the card expired, the subscription is `past_due`. This is a
**separate 7-day** window before commercial degradation.

| Cause | Grace behavior |
|---|---|
| Portal unreachable / offline (technical) | Keep printing on last valid token for **72h after token expiry** (~5 days total); no developer penalty |
| Payment failed (commercial) | **7-day** regularization window before commercial degradation |
| Cancelled intentionally | Until end of paid period |
| Fraud / chargeback | Faster suspension per a specific policy |
| Launch Trial expired | Printing continues; **block new** activations/tokens/domains/installers |

After grace, degradation targets the **admin/deployment** layer only:
`LICENSE_ACTION_REQUIRED` — no new install tokens, no new activations, no new domains, no new
installers, no new machines — while existing installations keep operating temporarily.

`SUSPENDED` is reserved for abuse/fraud/manual revocation and is **never** the automatic result
of a lapsed card alone.

---

## 6. Production authorization & readiness signals

Moving an Application to `production_active` requires a **verified production domain** (DNS TXT
recommended, HTTP challenge as a faster alternative; packaged apps such as Electron/Tauri use a
signed application identity instead of a domain). Domain verification is **not** required to start
a Launch Trial — only to reach production. The authoritative record of "in production" is the
Application's **activation**, never a self-declared flag or the `Origin` header alone.

Application readiness is derived from **observed integration events** (Runtime Connected, Printer
Detected, SDK Connected, Test Print Successful, Production Domain Added/Verified), never from
manual checkboxes. These are described in-product as **"integration events" / "application
readiness signals"**, not "telemetry": they carry no ticket content, sold products, amounts, or
end-customer personal data.

## 7. What Portix.One does not do

- Does not meter or charge for printers, tickets, projects, applications, end customers,
  machines, or installations.
- Does not watermark end-customer tickets.
- Does not make the end customer responsible for the developer's license.
- Does not require internet for each print.
- Does not use invasive fingerprinting, hardware locks, or rigid per-machine activation.
- Does not capture ticket content or sensitive end-customer data in telemetry (plan §13).
