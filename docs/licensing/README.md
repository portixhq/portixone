# Licensing — design artifacts & implementation status

Design deliverables for [LICENSING_PLAN.md](../../LICENSING_PLAN.md). Phase A was pure design;
the **[mono]** side of Phases B–E is now implemented and tested in this repo, and the **[cloud]**
side is specced in [cloud-implementation.md](cloud-implementation.md).

| File | What it freezes |
|---|---|
| [terms.md](terms.md) | Plan definitions, commercial-use & Developer-Identity definitions, redistribution rights, cancellation & grace policy, lifetime-offer limits |
| [schema.sql](schema.sql) | Postgres/Supabase data model for `portix-cloud` (§3 of the plan) |
| [contracts.ts](contracts.ts) | Original Phase A draft of the shared contracts (now promoted into `@portixone/protocol`) |
| [cloud-implementation.md](cloud-implementation.md) | Implementation-ready build spec for the whole **[cloud]** side (signing, Stripe, Portal, trials, installation tokens) |

## Implementation status (2026-07-15)

**[mono] — built & tested in this repo (32 tests green, full typecheck clean):**
- **Shared contracts** promoted from `contracts.ts` into `packages/protocol/src/license.types.ts`
  (token claims, enums, `GRACE`, runtime posture/state).
- **Runtime license module** `runtime/src/license/`: offline **ES256** verifier + embedded keyring
  (`license.verifier.ts` / `license.keyring.ts`, zero-dependency `node:crypto`), cached-token store,
  the grace/posture state machine (`license.service.ts` — `derivePosture` is a pure, fully-tested
  function), the 12h **heartbeat** (`heartbeat.service.ts`), and one-time **installation-token
  exchange** (`installation.service.ts`). Wired into boot/shutdown and exposed read-only at
  `GET /license`. **Printing never blocks on any of it.**
- **Config** gained `applicationId`, `licenseHeartbeatUrl`, `licenseRegistrationUrl`,
  `installationToken` (all optional; documented in `runtime/.env.example`).
- **SDK** (`sdk-js`): `appId` documented as the public Application ID; `mode` documented as a
  non-authoritative hint. No behavior change.
- **Distribution branding** `distributionBranding()` in `@portixone/shared`.
- **ROADMAP** pricing section updated to Free / Creator / Founder (supersedes Free/Pro/Business).

**[cloud] — specced, not built here** (private `portix-cloud`): see
[cloud-implementation.md](cloud-implementation.md). Signing service, Stripe, Portal, trials,
installation-token & heartbeat endpoints, readiness/observability.

### Pre-production hardening pass (2026-07-15, 78 tests green)

Closed the mono-side controls from the design review, in order:

1. **Fail-closed keyring** — separate `license.keyring.prod.ts` / `license.keyring.dev.ts`.
   Production trusts only the production keyring; boot **aborts** if a dev `kid` is present
   (`assertNoDevKeysInProduction`); a test asserts the dev `kid` never appears in the prod source.
   Env resolution defaults to production (`resolveLicenseEnv` — dev requires an explicit opt-in).
2. **Precedence table** (`license.precedence.test.ts`) — the shared source of truth for
   token/commercial/connectivity/revocation → posture. `derivePosture` is the one implementation.
3. **Heartbeat negatives** — immediate revocation only for the recognized `LicenseRevocationNotice`
   over TLS with matching ids; every generic 401/403/500/timeout/unknown-JSON conserves the token.
4. **Strict claims** — verifier checks `iss`, `sub === applicationId`, expected `applicationId`
   binding, timestamp coherence, and a max-lifetime clamp. (`aud`/`nbf`/`tokenVersion` negotiation
   are documented as a reserved contract evolution, deferred to cloud coordination.)
5. **Atomic persistence** — `StorageRepository` writes temp→fsync→rename with orphan sweep and a
   Windows/OneDrive-safe retry; a failed write always leaves the previous file intact.
6. **Clock-rollback diagnostic** — `ClockMonitor` tracks a weak (local) and strong
   (heartbeat-confirmed) watermark and logs a rollback. Purely diagnostic; never gates printing.
7. **Architectural invariant** — `license.architecture.test.ts` asserts the print/queue/printer
   layer never imports `LicenseService`. Printing *cannot* gate on licensing because it never
   depends on it — stronger than checking for the absence of a call.

## Ratified decisions (founder-approved 2026-07-11)

| # | Decision | Final |
|---|---|---|
| 1 | Signature | **ES256**, JWT with `alg` + `token_version: 1` + **mandatory `kid`** (e.g. `key_2026_01`). Runtime holds a **keyring** (multiple valid public keys) so a key can rotate without breaking old runtimes. Future migration path: Ed25519/EdDSA. |
| 2 | TTL / heartbeat / grace | Token **48h**, heartbeat **12h**. **Offline (technical) grace = 72h counted from token expiry** (not from last heartbeat) → ~5 days of Portal-independent operation. **Commercial grace = separate 7-day** window for payment failure. The two are distinct causes and never conflated. |
| 3 | Founder Pass | **100 seats total, $240 one-time, single irrevocable supply, no price change, no second batch.** Internal staged release allowed (25 / 25 / 50) but publicly one capped offer. Grants **lifetime Creator for one Developer Identity** — not Business/SLA/usage-based cloud/white-label/consulting. |
| 4 | Domain verification | **DNS TXT recommended, HTTP challenge alternative, signed app identity for Electron/Tauri.** Verification is **not** required to start a Launch Trial; it **is** required to reach `production_active`. `ApplicationActivation` remains the source of truth for "production". |
| 5 | Readiness | **Derived from observed integration events**, never manual checkboxes for technical signals. In-product/docs name: **"Integration events" / "Application readiness signals"** — never "telemetry". Portix receives no ticket content, products, amounts, or end-customer data. |

## Phase A exit criteria

- [x] Plan definitions + commercial terms drafted ([terms.md](terms.md))
- [x] Data model drafted ([schema.sql](schema.sql))
- [x] Runtime/SDK/cloud shared contracts drafted → promoted into `@portixone/protocol`
- [x] Founder ratified the 5 open decisions (2026-07-11 — baked into the artifacts above)
- [ ] **Terms reviewed for legal soundness** (not legal advice — needs a real review before publish)

## Decisions still owned by the founder / business (deliberately not made in code)

1. **Legal review of [terms.md](terms.md)** before anything is published or referenced in checkout.
2. **Publish public pricing on portix.dev.** The live `PricingCards.astro` carries an honesty guard
   ("don't advertise prices for things not built"). Creator/Founder aren't purchasable until
   portix-cloud billing is live, so the public $24 / $240 page is gated on that — not published yet.
3. **Founder Pass refund policy** (terms §4 — marked TBD/business).
4. **Production signing keypair** generation + the endpoint URLs — a portix-cloud operational task
   (see [cloud-implementation.md](cloud-implementation.md) §9), not a monorepo change.

**Fase 10 status:** physical print verified ✓ (per founder, 2026-07-15). First external-developer
TTFP is no longer treated as a hard gate — the [mono] licensing work above proceeded on that basis.
