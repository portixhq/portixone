# Portix.One — Licensing & Pricing Implementation Plan

> Turns the Free / Creator licensing executive summary into a build plan grounded in the
> **current** codebase. Companion to [ROADMAP.md](ROADMAP.md) (Fase 1–12) and
> [MILESTONE_4.md](MILESTONE_4.md). Scope: the commercial licensing layer that Fase 11
> ("First Paying Customer") builds toward.

---

## 0. Sequencing honesty — read this first

Licensing is **Fase 11** work. It must not jump ahead of still-open gates:

- **Fase 10 blockers** (from `MILESTONE_4.md`): a real physical ticket from the dashboard
  button is *still unproven* on hardware; no external developer has completed TTFP yet.
- The product principle stands: **revenue must never precede value**. Building a signed-token
  license service before a stranger has printed a receipt is premature infrastructure.

**Therefore:** treat everything below as *designed and staged now, shipped after Fase 10 closes.*
The one exception worth doing early is **Phase A (contracts + data model)** — it's cheap, it's
pure design, and it de-risks the SDK/runtime shape so we don't paint ourselves into a corner.

---

## 1. What already exists vs. what's new

| Concern | Today (in this monorepo) | Needed for licensing |
|---|---|---|
| App identity | `appId` + `tenant` on pairing (`sdk-js/src/types.ts`, `pairing.service.ts`) | Promote `appId` to a **cloud-registered Application ID**, public |
| Local trust | Pairing token = random UUID, local only (`pairing.service.ts`) | Keep as-is — orthogonal to licensing |
| Auth | `auth.service.ts` = admin key **or** pairing token | Add a **license check** alongside, not replacing pairing |
| Cloud/portal | `cloud/` is a placeholder; real code is private `portixhq/portix-cloud` | Build Developer Portal + token service **there** |
| Billing | none | Stripe (in `portix-cloud`) |
| Signed authorization | none | **License token = cloud-signed JWT**, verified by runtime |
| Env authority | SDK `mode`/`environment` hint (`types.ts`) | Demote `environment` to a non-authoritative hint |

### The central architectural decision: two orthogonal token layers

```
Pairing token   →  "app X on machine Y is allowed to print here"   (local, unsigned, already built)
License token   →  "app X is commercially authorized for production" (cloud-signed JWT, NEW)
```

They are validated **independently**. A machine can be paired (can print) while the app's
commercial license is in grace or trial. Printing never blocks on the license — see §4.

### Repo split (open vs. closed)

- **Open monorepo (`portixone`)**: runtime license-verification module, SDK changes, public
  key embedding, docs/pricing page. No private keys, no billing logic, ever.
- **Closed repo (`portix-cloud`)**: Developer Portal, Application registry, Stripe, token
  **signing** (private key), grace/state machine, webhooks. `cloud/README.md` already reserves
  this boundary — respect it.

---

## 2. Final pricing structure

### 2.1 Plans

| | **Free — Development** | **Creator — Commercial** | **Founder Creator Pass** |
|---|---|---|---|
| Price | `$0` | `$24 / month` or `$240 / year` (2 mo free) | `$240 one-time`, lifetime |
| Billing unit | — | **per Developer Identity** | per Developer Identity |
| Availability | always | always | limited: **100 seats** (single irrevocable supply), launch only — the **priority** offer |
| Purpose | build, test, validate E2E | launch & distribute commercially | lifetime Creator for early founders |
| Projects / Apps | unlimited (dev) | **unlimited** | unlimited |
| End customers / installs / printers | unlimited (dev) | **unlimited** | unlimited |
| Production authorization | ❌ (trial window only) | ✅ perpetual while active | ✅ lifetime |
| Signed production tokens | trial only | ✅ | ✅ |
| Installation tokens / distributable installers | trial only | ✅ | ✅ |
| Simplified/auto pairing | ❌ | ✅ | ✅ |
| Founder badge / early betas / feedback priority | ❌ | ❌ | ✅ |

**Explicitly NOT metered:** printers, tickets, projects, apps, end customers, machines,
installations. Portix charges for the **right to deploy & redistribute commercially**, not volume.

Founder Pass guarantees **Creator forever** — *not* future Business/Cloud/SLA tiers.

### 2.2 Internal license & subscription states (Stripe → internal)

`ACTIVE · PAST_DUE · GRACE_PERIOD · CANCEL_AT_PERIOD_END · CANCELLED · DISPUTED · LIFETIME`

### 2.3 Product messaging (banned vs. preferred)

- **Ban:** locked, blocked, violation, unauthorized, piracy, paywall, forbidden.
- **Prefer:** Development License · Ready to Launch · Activate Production · Launch Trial ·
  Creator required for commercial deployment · Regularize deployment.
- Tagline: **Free → Build & validate · Creator → Launch & distribute · Founder → forever.**

### 2.4 Supersedes

This replaces `ROADMAP.md` §"Pricing model" (Free/Pro/Business) and the older
Free/Production-$24/Scale-$79 note. Action item: update ROADMAP once this is ratified.

---

## 3. Data model (portix-cloud / Supabase)

```
Developer 1─1 License 1─1 Subscription
Developer 1─* Application 1─* ApplicationDomain
Application 1─* ApplicationActivation
Application 1─* Installation 1─* (Runtime → Printers, metadata only)
Application 1─0..1 Trial
LicenseToken *─1 Application, *─0..1 Installation
BillingEvent, AuditEvent (append-only)
```

Minimum entities and their load-bearing columns:

- **Developer** — `id`, `email`, `name`, `created_at`.
- **License** — `developer_id`, `type` (`free|creator|founder`), `state` (§2.2), `renews_at`,
  `grace_until`.
- **Subscription** — `stripe_customer_id`, `stripe_subscription_id`, `status`.
- **Application** — `id` (`app_<slug>_<rand>`, **public**), `developer_id`, `name`,
  `status` (§6), `created_at`.
- **ApplicationDomain** — `application_id`, `origin`, `kind` (`prod|staging|dev`),
  `verified_at`, `verification_method`.
- **ApplicationActivation** — `application_id`, `kind` (`trial|production`), `activated_at`,
  `expires_at`. **This — not the Origin header — is the source of truth for "production".**
- **Trial** — `application_id`, `started_at`, `expires_at` (14 days).
- **Installation** — `id`, `application_id`, `tenant` (optional), `runtime_fingerprint`,
  `last_seen_at`. *Not* a billing unit.
- **LicenseToken** — `id`, `application_id`, `installation_id?`, `issued_at`, `expires_at`,
  `revoked_at?`, `token_version`.
- **BillingEvent / AuditEvent** — Stripe events and license lifecycle events (§13), append-only.

---

## 4. Runtime integration (maps to `runtime/src/*`)

New module: `runtime/src/license/` — `license.service.ts`, `license.store.ts`,
`license.verifier.ts`, `heartbeat.service.ts`.

1. **Embed a public keyring.** Not one key — a `kid`→public-key map (ES256), so a signing key
   can rotate without breaking runtimes that cached tokens from an older key. The verifier picks
   the key named by the token header's `kid`. Private keys never leave portix-cloud (§22).
2. **Boot flow** (`lifecycle/bootstrap.service.ts`): load cached license token → verify
   signature + expiry offline → set in-memory `LicenseState`. **No network call on the hot path.**
3. **Heartbeat** (`heartbeat.service.ts`): every ~12h, background, non-blocking. Portal
   re-issues a fresh 24–48h token; runtime swaps it. Failure ≠ print failure.
4. **Auth surface** (`auth/auth.service.ts` / `auth.middleware.ts`): licensing is a *separate*
   check. A print still succeeds if paired; license state only gates **admin/deployment**
   actions and drives Portal/dashboard/log messaging — never the ticket.
5. **Config** (`config/config.types.ts`): add optional `applicationId`, `licenseTokenPath`.
6. **Grace period** (see matrix): keep printing on the last valid token; log + surface, never
   watermark, never block existing installs.

**Grace matrix** (from summary §12):

| Cause | Behavior |
|---|---|
| Portal unreachable (technical) | keep printing **72h after token expiry** on last valid token (~5 days total with a 48h token), no developer penalty |
| Payment failed | **7-day** regularization window |
| Cancelled intentionally | until end of paid period |
| Fraud / chargeback | fast suspension (policy-specific) |
| Launch Trial expired | printing continues; **block new** activations/tokens/domains/installers |

**Invariant to test (summary §14):** a Portix Cloud outage must **not** stop local printing.

---

## 5. SDK changes (maps to `sdk-js/src/*`)

- `appId` becomes the **public Application ID** (already a first-class option in `types.ts`).
- Demote `environment`/`mode` to a **non-authoritative hint** — the runtime + signed token
  decide production, never the browser (summary §8, §13).
- Never ship a permanent secret in the browser bundle. Public `appId` + public integration
  key only; secrets stay server-side (summary §22).
- No behavioral change to `pair()`/`print()` — licensing is transparent to the print call.

---

## 6. Application lifecycle state machine

```
DRAFT ─(SDK integrated)→ DEVELOPMENT ─(E2E print)→ VALIDATED
  ─(readiness checklist)→ READY_TO_LAUNCH ─(explicit activation)→ LAUNCH_TRIAL (14d)
  ─(Creator active)→ PRODUCTION_ACTIVE
PRODUCTION_ACTIVE ─(token unrenewable / payment issue)→ GRACE_PERIOD
GRACE_PERIOD ─(unresolved)→ LICENSE_ACTION_REQUIRED
* ─(fraud / manual)→ SUSPENDED   (never the automatic result of a lapsed card alone)
```

Transitions are driven by: readiness checklist completion, explicit trial activation, Stripe
webhooks, and heartbeat/grace timers. Downgrades hit the **admin/deployment** layer, not tickets.

---

## 7. Context detection (production vs. development)

Never derive production from `environment: "production"` or from `Origin` alone. Combine:
Application ID + real origin + **registered & verified domain** + activation token +
Application status + signed authorization + issued/expiry. Production is derived primarily from
an **ApplicationActivation**, not a header — so it survives localhost, LAN IPs, Electron/Tauri,
PWAs, reverse proxies, tunnels, on-prem, and per-customer custom domains.

Domain verification methods: DNS TXT, verification file, temporary meta tag, HTTP challenge,
manual for edge cases. Not every product needs a public domain — packaged apps use a signed
application identity / installation activation instead.

---

## 8. Stripe & billing (portix-cloud)

- **Stripe Checkout + Billing.** Backend is the source of truth; never trust the frontend.
- Handle: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`,
  `invoice.paid`, `invoice.payment_failed`, `charge.dispute.created`.
- Map events → internal license states (§2.2). Founder Pass = one-time payment → `LIFETIME`,
  bound to a Developer Identity, no renewal.

---

## 9. Installation tokens & distribution

- **Installation Token**: single-use, minutes-long TTL, tied to an Application (and tenant when
  a SaaS drives it), carries no permanent secret, exchanged for an Installation Identity.
- SaaS-driven install flow: frontend → its own backend (authenticates the tenant) → requests an
  Installation Token from Portix → user downloads the runtime → installer consumes the token →
  runtime registers → token invalidated. Scales to thousands of installs with no developer touch.
- **Distribution MVP:** generic runtime + per-Application link + temporary token + auto-pairing +
  minimal branding "Printing Runtime for <App> — Powered by Portix.One". No full white-label yet.

---

## 10. Developer Portal MVP (portix-cloud)

Sections only: **Account** (profile, plan, renewal, Founder if applicable) · **Applications**
(create, App ID, status, domains, launch trial, production status, readiness checklist) ·
**License** (dev/creator, payment, expiry, grace, history) · **Activations** (issued tokens,
installations, last comms) · **Downloads** (generic runtime, per-App installer/link) ·
**Events** (audit feed). Analytics should motivate ("Ready to Launch", "6 days in production"),
never threaten. Out of scope now: advanced analytics, SSO, teams, fleet dashboards, remote control.

---

## 11. Build sequence

Ordered to ship the **MVP** (summary §26) first. Repo tag: **[cloud]** = portix-cloud (private),
**[mono]** = this repo.

> **Status (2026-07-15):** every **[mono]** item below is IMPLEMENTED and tested in this repo
> (32 tests green, full typecheck clean). Every **[cloud]** item is specced in
> [docs/licensing/cloud-implementation.md](docs/licensing/cloud-implementation.md), to be built in
> the private `portix-cloud` repo. Physical print is verified; external-developer TTFP is no longer
> a hard gate (founder call, 2026-07-15).

### Phase A — Contracts & data model  ✅ done
- Plan definitions, terms, redistribution, cancellation/grace, definitions, lifetime limits frozen.
- **[cloud]** Data model (§3, `docs/licensing/schema.sql`). **[mono]** shared contracts promoted
  into `@portixone/protocol`; SDK `appId`/`mode` semantics documented. *(Open: legal review of terms.)*

### Phase B — Identity, registry, Stripe
- **[cloud]** Auth, Developer profile, Application registry, domain verification, Stripe (Creator
  checkout, webhooks → state, payment-failure grace, capped Founder one-time). → **specced**, §2–3
  of cloud-implementation.md.
- **[mono]** ✅ SDK contract change (`appId` = public Application ID, `mode` = non-authoritative hint).

### Phase C — Token service & runtime verification  *(the core)*
- **[cloud]** Signing keypair, issuance, rotation, revocation, public-key distribution. → **specced**, §1.
- **[mono]** ✅ `runtime/src/license/` — embedded ES256 keyring, offline verify, token store,
  heartbeat, offline grace, structured logs. Hot path stays cloud-independent. `GET /license`
  exposes posture. **Built + tested.**

### Phase D — Launch Trial, installation tokens, distribution
- **[cloud]** Readiness validation, 14-day trial, installation-token API. → **specced**, §4.
- **[mono]** ✅ Installation-token exchange (`installation.service.ts`) + `distributionBranding()`.
  *(Open handoff: wire `installer/portixone.iss` to persist the token — cloud-impl §4.2/§9.)*

### Phase E — Messaging, observability, tests
- **[mono]** ✅ ROADMAP pricing updated to Free/Creator/Founder. *(Public portix.dev pricing page
  gated on live billing — founder decision, see docs/licensing/README.md.)*
- **[cloud]** Observability events (§13). → **specced**, §6.
- ✅ Runtime-side test matrix (verifier, grace, heartbeat, installation) — 32 tests. Cloud-side
  matrix listed in cloud-implementation.md §8.

---

## 12. Test matrix (summary §14)

Free-on-localhost · Free-on-staging · app registered without Creator · Launch Trial active ·
trial expired · Creator active · Creator with many apps · payment failed · Portal offline ·
internet offline · token expired · invalid signature · reinstallation · different domain ·
Electron/Tauri · domain change · cancellation · Founder Pass.

**Fundamental test:** a Portix Cloud outage must not immediately stop local printing.

---

## 13. Observability events (no PII, no ticket content)

`token.issued · token.verify_failed · trial.started · trial.expired · payment.failed ·
grace.entered · grace.exited · application.activated · installation.registered · domain.verified`.

---

## 14. Threat model (accepted)

Not aiming for invulnerability. Accepted: someone can modify the SDK, run an old runtime, block
Portal calls, or fork. Strategy is to make paying $24 more convenient than maintaining a parallel
solution. Reasonable measures only: signed tokens, versioning, updates, signature validation, key
rotation, grace, revocation, superior Creator distribution UX. **Avoid:** heavy obfuscation,
invasive fingerprinting, hardware locks, rigid per-machine activation, per-print internet
requirement, invasive telemetry.

---

## 15. Ratified decisions (founder-approved 2026-07-11)

Baked into `docs/licensing/` — see [docs/licensing/README.md](docs/licensing/README.md) for the
full record. Summary:

1. **Signature** — **ES256**, JWT with `alg` + `token_version: 1` + **mandatory `kid`**. Runtime
   holds a **keyring** of public keys for zero-downtime rotation. Future path: Ed25519/EdDSA.
2. **Resilience** — token **48h**, heartbeat **12h**. Technical (offline) grace **72h counted
   from token expiry** (~5 days offline). Commercial grace **7 days** for payment failure — a
   separate cloud-side timer, never conflated with the offline grace.
3. **Founder Pass** — **100 seats, $240 one-time, single irrevocable supply, no second batch, no
   price change.** Internal staged release (25/25/50) allowed; publicly one capped offer. Lifetime
   Creator for one Developer Identity; excludes Business/SLA/usage-based cloud/white-label.
4. **Domain** — DNS TXT recommended, HTTP challenge alternative, signed app identity for
   Electron/Tauri. Verification not required to start a trial; required for `production_active`.
   `ApplicationActivation` is the source of truth.
5. **Readiness** — derived from observed integration events, never manual checkboxes. Named
   "integration events" / "application readiness signals" in product — never "telemetry"; no
   ticket content or end-customer data.

Remaining before Phase A fully closes: a real **legal review** of [terms.md](docs/licensing/terms.md).
```
