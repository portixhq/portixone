# Portix.One — Entitlements Matrix

> **The single source of truth for what each plan grants.** The token service (portix-cloud) issues
> tokens against this matrix, and the Developer Portal displays it. Neither should re-derive
> entitlements independently — that is how the three surfaces (terms, Portal, token service) drift
> apart. Companion to [terms.md](terms.md) (legal prose) and [LICENSING_PLAN.md](../../LICENSING_PLAN.md).
>
> Cells marked **⚠️ OPEN** need a founder decision before launch.

---

## 1. Capability glossary

| Capability | Meaning |
|---|---|
| **Development use** | Build/test/validate on localhost, LAN, staging. Real printing included. |
| **Register Application** | Create an App in the Portal, get a public `app_<slug>_<rand>` ID. |
| **Launch Trial** | A one-time 14-day window where an App can reach `production_active` for free. |
| **Production authorization** | The App can stay in `production_active` indefinitely. |
| **Signed production tokens** | Cloud issues the 48h ES256 tokens that put the App in production. |
| **Installation tokens** | Single-use tokens that onboard end-customer machines without manual pairing. |
| **Per-App installers / links** | Branded, auto-pairing distributables for redistribution. |
| **Simplified / auto pairing** | Loopback / token-driven pairing without a human clicking Allow per install. |
| **Unlimited scale** | Unlimited Applications, end customers, installations, printers under one identity. |
| **Founder badge / early betas / feedback priority** | Founder-only perks. |

**Never metered, on every plan:** printers, tickets, projects, apps, end customers, machines,
installations. Portix charges for the *right to deploy & redistribute commercially*, not volume.

---

## 2. Entitlement matrix

| Capability | Free (dev) | Free — during a Launch Trial | Creator | Founder |
|---|---|---|---|---|
| Development use (real printing) | ✅ | ✅ | ✅ | ✅ |
| Register Application | ✅ | ✅ | ✅ | ✅ |
| Launch Trial (14d, once per App) | ✅ | — (active) | ✅ | ✅ |
| Production authorization | ❌ | ✅ (14d only) | ✅ perpetual while active | ✅ lifetime |
| Signed production tokens | ❌ | ✅ (trial window) | ✅ | ✅ |
| Installation tokens | ❌ | ✅ (trial window) | ✅ | ✅ |
| Per-App installers / links | ❌ | ✅ (trial window) | ✅ | ✅ |
| Simplified / auto pairing | ❌ | ✅ (trial window) | ✅ | ✅ |
| Unlimited scale (apps/customers/installs) | ✅ (dev only) | ✅ | ✅ | ✅ |
| Founder badge / early betas / priority | ❌ | ❌ | ❌ | ✅ |

**Billing unit:** per **Developer Identity** (one human or one company as licensee) — never per App,
per customer, or per machine. Creator = one identity; Founder = one identity, lifetime.

---

## 3. State-transition effects (what changes, and what NEVER does)

Degradation always targets the **admin/deployment plane only**. Across every row below:
**printing, the job queue, printer discovery, and post-restart recovery stay available.**

| Event | Runtime posture | Entitlements affected | Printing |
|---|---|---|---|
| Trial expires (Free, no Creator) | `action_required` (via cloud not issuing) | ❌ new activations/tokens/installers/domains for that App | ✅ existing installs keep printing |
| Payment failed (Creator) | `grace_payment` for **7 days** (commercial grace) | none yet — full grant during the window | ✅ |
| Grace exhausted / unpaid | `action_required` | ❌ new activations/tokens/installers/domains | ✅ existing installs keep printing |
| Voluntary cancellation | full grant until period end → then `action_required` | ❌ new commercial actions after period end | ✅ existing installs keep printing |
| Portal unreachable (technical) | `grace_portal_unreachable` for **72h from token expiry** (~5 days total) | none — full grant on last valid token | ✅ |
| Authenticated revocation | `action_required` immediately | ❌ all new commercial actions | ✅ existing installs keep printing |
| Fraud / chargeback → suspension | `action_required` (manual) | ❌ everything commercial | ✅ (per policy; not an automatic lapse) |

**Founder never lapses** on payment (it's `lifetime`, no renewal). It can only enter
`action_required` via explicit revocation for abuse.

---

## 4. Authoritative-source rules (for portix-cloud)

- The **token service** decides `applicationStatus` (and therefore the runtime posture) by reading
  `license.state` + `application` lifecycle **against this matrix** — not from a hand-rolled `if`.
- The **Portal** renders entitlements from this matrix, so what a developer sees matches what the
  token service enforces.
- Readiness signals (integration events) gate *reaching* production, but are **not** entitlements —
  they don't change what a plan grants, only when an App is *ready* to use its grant.

---

## 5. Open cells — founder decisions before launch

- **⚠️ Trial anti-abuse.** One Launch Trial *per Application*, but Applications are unlimited — so a
  developer can spin up new Apps for serial free trials. Intended, or do we cap trials per Developer
  Identity (e.g. N concurrent trials, or a cooldown)? Affects the `trial` table + token service.
- **⚠️ Team/seat semantics under one identity.** "One company acting as the licensee" = one identity.
  Do we allow multiple human logins under one company identity now, or is that a later Business-tier
  capability? Affects auth + Portal, not the runtime.
- **⚠️ Refund → entitlement reversal.** When a refund is issued (Creator or Founder), what happens to
  a live `production_active` App? Immediate `action_required`, or a grace window? Ties directly into
  the refund policy being drafted.
- **⚠️ Founder identity transfer.** Is a Founder Pass bound forever to its original identity, or
  transferable once (e.g. company sale)? Terms currently imply bound; confirm.
