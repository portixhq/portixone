# portix-cloud — Licensing Implementation Blueprint

> **Build spec, not code.** The `cloud/` folder in this repo is a placeholder that explicitly
> forbids proprietary code; the real implementation lives in the private `portixhq/portix-cloud`
> repo. This document is the implementation-ready contract for the **[cloud]** side of
> [LICENSING_PLAN.md](../../LICENSING_PLAN.md), so whoever builds portix-cloud does not have to
> re-derive it. The **[mono]** side (runtime verifier, heartbeat, installation exchange, SDK
> semantics) is already built and tested in this repo — this spec is what it verifies against.
>
> Everything here is grounded in the ratified decisions (see [README.md](README.md)) and the
> shared contracts the runtime already enforces (`packages/protocol/src/license.types.ts`,
> `docs/licensing/schema.sql`).

---

## 0. What the monorepo already provides (the contract to honor)

The runtime side is done. portix-cloud must produce artifacts these consume verbatim:

| [mono] component (built) | What it expects from [cloud] |
|---|---|
| `runtime/src/license/license.verifier.ts` | Compact **ES256** JWS with a JOSE header `{ alg:"ES256", typ:"JWT", kid }` and the exact `LicenseTokenClaims` payload. Signature is raw R‖S (JOSE), i.e. sign with `dsaEncoding: "ieee-p1363"`. |
| `runtime/src/license/license.keyring.ts` | The **public** half of every signing key, delivered as PEM to be embedded here under its `kid`. Currently only `key_dev_2026_01` (dev). **A production `kid` + public key is an open handoff.** |
| `runtime/src/license/heartbeat.service.ts` | A `POST {licenseHeartbeatUrl}` endpoint that accepts `{ applicationId, installationId? }` and returns `{ token }` (a fresh 48h JWS) or a non-2xx. |
| `runtime/src/license/installation.service.ts` | A `POST {licenseRegistrationUrl}` endpoint that accepts `{ installationToken }` and returns `{ installationId, applicationId, appName?, token? }`. |
| `LicenseTokenClaims` (`@portixone/protocol`) | Field-for-field the JWT payload to sign. Don't add required claims without a `tokenVersion` bump. |

**The invariant portix-cloud must never break:** nothing it does can make local printing stop. A
Cloud outage, an expired token, a failed payment — none reach the print path. Degradation is
always admin/deployment-only, and always after the ratified grace windows.

---

## 1. Signing service (Phase C [cloud]) — the core

The only component that touches a **private** key. Keep it isolated (own service / KMS boundary).

### 1.1 Keyring & rotation
- Generate ES256 (P-256) keypairs. Private half → secret store (KMS/HSM or Supabase Vault); it
  **never** leaves portix-cloud. Public half → PEM, published two ways: stored in `signing_key`
  (see schema.sql) and handed to the monorepo to embed in `license.keyring.ts`.
- `kid` convention: `key_<year>_<seq>` (e.g. `key_2026_01`). Mandatory in every token header.
- **Rotation is additive, never a cutover.** To rotate: create `key_2026_02`, ship a runtime
  release that embeds both keys, wait past the old token TTL + offline grace (~5 days), then set
  `signing_key.retired_at` on `key_2026_01` (stops *signing*; still *verifies* until aged out).
  A runtime older than the newest key gets `unknown_kid` — which the verifier already surfaces
  and the runtime logs as a rotation gap.

### 1.2 Token issuance
- Sign a `LicenseTokenClaims` payload: `iss:"portix.one"`, `sub`/`applicationId` = the App ID,
  `iat=now`, `exp=now+48h`, plus `developerId`, `licenseType`, `applicationStatus`, `licenseId`,
  `activationId`, `allowedOrigins`, `installationId?`, `tokenVersion:1`.
- `applicationStatus` in the token is the **source of the runtime's posture** — set it honestly:
  `production_active`, `launch_trial`, `grace_period` (commercial/payment grace), or
  `license_action_required`. The runtime maps these (see `derivePosture`); don't hand out a
  `production_active` token to an unpaid app.
- Record metadata (not the JWT) in `license_token`: `issued_at`, `expires_at`, `signing_kid`,
  `token_version`, `application_id`, `installation_id`.

### 1.3 Renewal (heartbeat endpoint)
- `POST /v1/license/heartbeat` ← `{ applicationId, installationId? }`, authenticated by the
  caller's current (even recently-expired) token or installation identity.
- Look up the live license/subscription/activation state, then **re-issue** a fresh 48h token
  reflecting *current* `applicationStatus`. Return `{ token }`. This is how commercial state
  reaches the runtime: a `past_due` subscription starts returning `grace_period`-status tokens;
  a resolved payment returns `production_active` again.
- If the app is revoked/suspended: return a non-2xx (or a `license_action_required` token). The
  runtime rides offline grace, then degrades admin-only — it keeps printing regardless.

### 1.4 Revocation
- Set `license_token.revoked_at`. Two delivery paths, in order of strength:
  1. **Preferred — signed:** the heartbeat re-issues a token with `applicationStatus:
     'license_action_required'`. The runtime verifies it normally and degrades the admin plane —
     no new trust assumption, it's just another signed token.
  2. **Fallback — recognized contract:** when the app is so revoked it gets no token, the heartbeat
     returns the `LicenseRevocationNotice` shape `{ code:'license_revoked', applicationId,
     installationId?, effectiveAt }`. The runtime honors it **only over TLS** and **only** when the
     ids match its own (`heartbeat.service.ts`). A bare 401/403/500/timeout/unknown JSON is **never**
     treated as revocation — it conserves the cached token (best-effort).
- Enforcement is at renewal time (decline to re-issue / send a notice), **not** a runtime-side
  revocation list on the hot path (threat model §14 accepts this; the 48h TTL bounds exposure).

### 1.5 Token claim contract & its planned evolution
- Sign exactly `LicenseTokenClaims` (`@portixone/protocol`). The runtime already validates strictly:
  `iss === 'portix.one'`, `sub === applicationId`, the runtime's expected `applicationId`, timestamp
  coherence (`iat ≤ exp`), and a `MAX_TOKEN_LIFETIME` sanity clamp. Emit accordingly.
- **Reserved evolution (design toward it, don't emit yet):** `aud` (audience — tighten replay to a
  specific installation), `nbf` (not-before), and a formal `tokenVersion` negotiation where the
  runtime advertises accepted versions. These require a coordinated `tokenVersion` bump on both
  sides; they are deferred deliberately, but the token service should be architected so adding them
  is additive, not a redesign. See `LicenseTokenContractEvolution` in `license.types.ts`.

---

## 2. Identity & Application registry (Phase B [cloud])

### 2.1 Developer auth
- Signup / login / email-verify / password reset. One `developer` row per identity (schema.sql).
- On first login, create a `license` row defaulting to `type='free', state='active'`.

### 2.2 Application registry
- Create Application → generate public **`app_<slug>_<rand>`** ID (the same value the SDK passes
  as `appId` and the token carries as `sub`). Never reuse; never guessable-sequential.
- Manage `application_domain` rows: add origin, choose `kind` (prod/staging/dev), verify.
- **Domain verification** (ratified Decision 4): DNS TXT (recommended) or HTTP challenge; packaged
  apps (Electron/Tauri) use a signed application identity instead. Verification is **not** required
  to start a Launch Trial; it **is** required to reach `production_active`. Set
  `application_domain.verified_at` on success and emit `domain.verification_completed`.

### 2.3 Application lifecycle state machine (plan §6)
Drive `application.status` transitions from readiness signals + activations + Stripe webhooks:
```
draft → development → validated → ready_to_launch → launch_trial (14d) → production_active
production_active → grace_period → license_action_required
* → suspended  (fraud/manual only — never an automatic lapse)
```

---

## 3. Billing (Phase B [cloud], Stripe)

- **Stripe Checkout + Billing.** Backend is the source of truth; never trust the client.
- **The paywall is NOT Stripe.** Stripe is only the money-in event. Entitlement lives in
  `license.state`; the **token service** is the enforcement point (it decides whether to issue a
  `production_active` / `launch_trial` token or decline). The runtime never talks to Stripe. Free
  and the 14-day Launch Trial work with **zero Stripe** — the "gate" there is simply the token
  service ceasing to issue production/installation tokens after the trial. Build order:
  identity → entitlement/state machine → token service → **then** Stripe.
- **Products & prices:**
  - Creator = one Product with **two recurring Prices**: `$24/month` and `$240/year` (two months
    free; identical capabilities, cadence only). → `license.type='creator'`.
  - Founder Pass = a **one-time** `$240` Price (Checkout `mode: 'payment'`, not a subscription) →
    `license.type='founder'`, `state='lifetime'`, no `stripe_subscription_id`. **The priority launch
    offer** — same $240 as a year of Creator, paid once, forever; the lifetime-vs-annual contrast
    (capped at 100 seats) is the conversion anchor.
- **Founder 100-seat cap is enforced by YOU, not Stripe** — Stripe has no native inventory limit.
  Reserve a seat in a transaction before creating the Checkout Session and release it on
  abandonment/expiry, so concurrent buyers can never oversell past 100.
- **Launch shortcut (first ~25 Founders):** ship with Stripe **Payment Links + manual entitlement
  grants** before building full webhook automation. Validates demand and exercises the entire
  licensing-enforcement path (token issuance, grace, revocation) with no billing plumbing yet. Full
  webhooks below are the follow-up, not a launch blocker.
- **Founder Pass supply cap is enforced server-side**: a single irrevocable total of **100** seats,
  no second batch, no price change (ratified Decision 3). Internal staged release (25/25/50) is an
  operational detail, one public cap of 100. Enforce with a transactional counter — never oversell.
- Webhooks → internal `license.state` (append raw event to `billing_event`):
  | Stripe event | Effect |
  |---|---|
  | `checkout.session.completed` | activate Creator / grant Founder lifetime |
  | `customer.subscription.updated` | sync state |
  | `invoice.payment_failed` | `state='past_due'`, start the **7-day commercial grace** (`license.grace_until`) |
  | `invoice.paid` | clear grace → `active` |
  | `customer.subscription.deleted` | `cancel_at_period_end` → `cancelled` at period end |
  | `charge.dispute.created` | `disputed` → faster suspension path |
- **Commercial grace (7 days) is a cloud-side timer only** — it manifests to the runtime purely as
  the heartbeat continuing to issue `grace_period`-status tokens. Never conflate it with the
  runtime's 72h offline/technical grace (which the runtime owns and the cloud never sees).

---

## 4. Trials, installation tokens, distribution (Phase D [cloud])

### 4.1 Launch Trial
- One `trial` per Application, `expires_at = started_at + 14 days`. During the trial the heartbeat
  issues `launch_trial`-status tokens. On expiry: stop issuing new activation/installer tokens;
  **existing installations keep printing** (they ride their tokens, then offline grace, then
  admin-only degradation). Emit `trial.started` / `trial.expired`.

### 4.2 Installation token API (plan §9)
- `POST /v1/installations/tokens` (developer- or tenant-backend-authenticated) → mint a
  **single-use, minutes-TTL** `installation_token` bound to an Application (+ optional tenant).
- `POST /v1/installations/register` ← `{ installationToken }` (this is `licenseRegistrationUrl`,
  the endpoint `installation.service.ts` already calls). Validate + mark `consumed_at`, create an
  `installation` row, and return `{ installationId, applicationId, appName?, token? }` (include a
  first 48h license token so the runtime is production-ready on first boot). Emit
  `installation.registered`.
- **The installer's role** ([mono], small handoff): the per-App download link carries the
  installation token; the installer writes it into runtime config as `PORTIX_INSTALLATION_TOKEN`
  (+ `PORTIX_LICENSE_REGISTRATION_URL`, `PORTIX_APPLICATION_ID`) so first boot consumes it. Inno
  Setup can accept these via `/D` defines → written to the runtime's `.env`/config. Not yet wired
  in `installer/portixone.iss` — see open items.

### 4.3 SaaS-driven install flow (the scale path)
`SaaS frontend → its backend (authenticates tenant) → POST /installations/tokens → user downloads
the per-App runtime → installer writes token → runtime POST /installations/register → token
consumed`. No developer touch per install; scales to thousands.

### 4.4 Distribution MVP branding
Generic runtime + per-Application link + minimal branding **"Printing Runtime for `<App>` —
Powered by Portix.One"** (already implemented as `distributionBranding()` in `@portixone/shared`,
surfaced by `installation.service.ts`). Full white-label is a later Business-tier capability.

---

## 5. Developer Portal MVP (Phase B–D [cloud])

Sections only (plan §10): **Account** · **Applications** (create, App ID, status, domains, launch
trial, readiness) · **License** (plan, payment, expiry, grace, history) · **Activations** (issued
tokens, installations, last comms) · **Downloads** (generic runtime, per-App link) · **Events**
(audit feed). Analytics **motivate** ("Ready to Launch", "6 days in production"), never threaten.
Out of scope now: advanced analytics, SSO, teams, fleet dashboards, remote control.

---

## 6. Readiness signals & observability (Phase D–E [cloud])

- **Readiness is DERIVED from observed integration events** (ratified Decision 5), never manual
  checkboxes. Event → signal mapping (from schema.sql notes):
  `runtime.connected → Runtime Connected` · `printer.detected → Printer Detected` ·
  `sdk.session_established → SDK Connected` · `print_job.completed → Test Print Successful` ·
  `application_domain row → Production Domain Added` · `domain.verification_completed → Verified`.
- In product & docs call these **"integration events" / "application readiness signals"** — **never
  "telemetry."** Portix receives **no** ticket content, sold products, amounts, or end-customer PII.
- Observability event catalog (plan §13, append-only to `audit_event`): `token.issued`,
  `token.verify_failed`, `trial.started`, `trial.expired`, `payment.failed`, `grace.entered`,
  `grace.exited`, `application.activated`, `installation.registered`, `domain.verified`.

---

## 7. RLS & data model

Port [schema.sql](schema.sql) to a real migration. Every table is scoped to its `developer_id` via
RLS; only the signing/token-service role bypasses RLS for issuance. `signing_key` holds public keys
only (the private half is in the secret store, never a table).

---

## 8. Test matrix portix-cloud must satisfy (plan §12)

Free-on-localhost · Free-on-staging · app registered without Creator · Launch Trial active · trial
expired · Creator active · Creator with many apps · payment failed → commercial grace · Portal
offline · internet offline · token expired · invalid signature · reinstallation · different domain ·
Electron/Tauri · domain change · cancellation · Founder Pass supply cap (no oversell). **The
fundamental one:** a Portix Cloud outage must not immediately stop local printing — already covered
on the runtime side by the license/heartbeat tests in `runtime/src/license/*.test.ts`.

---

## 9. Open handoffs (portix-cloud must resolve before Creator goes live)

- **Production signing key**: generate the ES256 production keypair, guard the private half, hand
  the public half + `kid` to the monorepo to embed. `key_dev_2026_01` must never sign production.
- **Endpoint URLs**: publish `licenseHeartbeatUrl` and `licenseRegistrationUrl`; ship them to
  installations via config.
- **Installer plumbing** ([mono], small): wire `installer/portixone.iss` to accept and persist the
  installation token / registration URL / App ID.
- **Stripe products/prices**: create the Creator ($24/mo) and Founder ($240 one-time) products;
  wire the webhook secret.
