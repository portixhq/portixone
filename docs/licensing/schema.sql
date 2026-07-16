-- Portix.One licensing data model — Phase A design draft.
--
-- Target: the private `portix-cloud` repo (Supabase/Postgres), NOT this monorepo's runtime.
-- Staged here as a reviewable contract only; port to a real migration when Phase B starts.
-- Style follows portix.dev/supabase/migrations (lowercase snake_case, `if not exists`).
-- `TBD-<n>` comments point to the open decisions in README.md.

-- ============================================================================
-- Enums
-- ============================================================================

create type license_type   as enum ('free', 'creator', 'founder');

-- Internal license/subscription state, mapped from Stripe events (plan §2.2 / §8).
create type license_state  as enum (
  'active', 'past_due', 'grace_period', 'cancel_at_period_end',
  'cancelled', 'disputed', 'lifetime'
);

-- Application lifecycle (plan §6).
create type application_status as enum (
  'draft', 'development', 'validated', 'ready_to_launch',
  'launch_trial', 'production_active', 'grace_period',
  'license_action_required', 'suspended'
);

create type activation_kind   as enum ('trial', 'production');
create type domain_kind       as enum ('prod', 'staging', 'dev');
create type domain_verify_method as enum ('dns_txt', 'http_challenge', 'meta_tag', 'manual');
create type billing_event_source as enum ('stripe', 'system');

-- ============================================================================
-- Developer Identity (the unit of licensing)
-- ============================================================================

create table if not exists developer (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text,
  created_at  timestamptz not null default now()
);

-- One license per developer.
create table if not exists license (
  developer_id  uuid primary key references developer(id) on delete cascade,
  type          license_type  not null default 'free',
  state         license_state not null default 'active',
  renews_at     timestamptz,           -- null for free / lifetime
  grace_until   timestamptz,           -- commercial grace: 7 days on payment failure (ratified)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Stripe linkage. Founder Pass = one-time payment → license.state = 'lifetime'.
create table if not exists subscription (
  id                     uuid primary key default gen_random_uuid(),
  developer_id           uuid not null references developer(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,          -- null for the one-time Founder Pass
  status                 text,          -- raw Stripe status, for audit
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  unique (developer_id)
);

-- ============================================================================
-- Applications
-- ============================================================================

create table if not exists application (
  id            text primary key,       -- public: app_<slug>_<rand>
  developer_id  uuid not null references developer(id) on delete cascade,
  name          text not null,
  status        application_status not null default 'draft',
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create index if not exists application_developer_idx on application(developer_id);

create table if not exists application_domain (
  id             uuid primary key default gen_random_uuid(),
  application_id text not null references application(id) on delete cascade,
  origin         text not null,         -- e.g. https://app.nerion.com.mx
  kind           domain_kind not null,
  verify_method  domain_verify_method,  -- recommended dns_txt, http_challenge alt (ratified)
  verified_at    timestamptz,           -- null until verified; NOT required to start a trial,
                                         -- REQUIRED to reach production_active (ratified)
  created_at     timestamptz not null default now(),
  unique (application_id, origin)
);

-- Source of truth for "is this app in production" (plan §7) — NOT the Origin header.
create table if not exists application_activation (
  id             uuid primary key default gen_random_uuid(),
  application_id text not null references application(id) on delete cascade,
  kind           activation_kind not null,
  activated_at   timestamptz not null default now(),
  expires_at     timestamptz,           -- trial: activated_at + 14d; production: null while licensed
  revoked_at     timestamptz
);
create index if not exists activation_app_idx on application_activation(application_id);

-- Exactly one Launch Trial per application (plan §6, terms §2).
create table if not exists trial (
  application_id text primary key references application(id) on delete cascade,
  started_at     timestamptz not null default now(),
  expires_at     timestamptz not null   -- started_at + interval '14 days'
);

-- ============================================================================
-- Installations & tokens
-- ============================================================================

-- One Runtime deployment. NOT a billing unit. Printers are metadata only (no ticket content).
create table if not exists installation (
  id                  uuid primary key default gen_random_uuid(),
  application_id      text not null references application(id) on delete cascade,
  tenant              text,             -- optional: the SaaS's end-customer id
  runtime_fingerprint text,
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists installation_app_idx on installation(application_id);

-- Cloud-signed license JWTs issued to installations (plan §10 / §11 Phase C).
-- Ratified: ES256, 48h TTL, rotated via 12h heartbeat. The JWT itself is not stored, only metadata.
create table if not exists license_token (
  id              uuid primary key default gen_random_uuid(),
  application_id  text not null references application(id) on delete cascade,
  installation_id uuid references installation(id) on delete cascade,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,    -- issued_at + interval '48 hours'
  revoked_at      timestamptz,
  signing_kid     text not null,           -- which signing key produced this token (JOSE `kid`)
  token_version   int not null default 1   -- coarse rotation marker; `kid` is the precise selector
);
create index if not exists license_token_app_idx on license_token(application_id);

-- Signing keyring (Decision 1, ratified). The private half lives ONLY in portix-cloud's
-- secret store, never here and never in any client. Each `kid` maps to a public key that
-- ships embedded in the runtime; several rows are `active` at once during a rotation overlap.
create table if not exists signing_key (
  kid          text primary key,        -- e.g. key_2026_01
  algorithm    text not null default 'ES256',
  public_key   text not null,           -- PEM/JWK; embedded in runtimes for offline verify
  activated_at timestamptz not null default now(),
  retired_at   timestamptz,             -- stops signing new tokens; still verifies until fully aged out
  created_at   timestamptz not null default now()
);

-- Single-use, minutes-long installer bootstrap tokens (plan §9 / §16).
create table if not exists installation_token (
  id             uuid primary key default gen_random_uuid(),
  application_id text not null references application(id) on delete cascade,
  tenant         text,
  expires_at     timestamptz not null,    -- minutes, not hours
  consumed_at    timestamptz,             -- one-time: set on first use
  created_at     timestamptz not null default now()
);

-- ============================================================================
-- Append-only event logs (plan §13) — no ticket content, no sensitive customer data
-- ============================================================================

create table if not exists billing_event (
  id            uuid primary key default gen_random_uuid(),
  developer_id  uuid references developer(id) on delete set null,
  source        billing_event_source not null default 'stripe',
  type          text not null,           -- e.g. invoice.payment_failed
  payload       jsonb,                   -- raw event for audit
  created_at    timestamptz not null default now()
);

create table if not exists audit_event (
  id            uuid primary key default gen_random_uuid(),
  developer_id  uuid references developer(id) on delete set null,
  application_id text references application(id) on delete set null,
  type          text not null,           -- token.issued, trial.started, grace.entered, ...
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- Notes for Phase B
-- ============================================================================
-- * RLS: every table scoped to its developer_id; the token-service role bypasses RLS for issuance.
-- * Readiness (Decision 5, ratified) is DERIVED from observed integration events, never from
--   self-reported booleans. Event → source mapping:
--       Runtime Connected          ← audit_event 'runtime.connected'
--       Printer Detected           ← audit_event 'printer.detected'
--       SDK Connected              ← audit_event 'sdk.session_established'
--       Test Print Successful      ← audit_event 'print_job.completed'
--       Production Domain Added     ← application_domain row exists
--       Production Domain Verified  ← audit_event 'domain.verification_completed' / verified_at
--   Call these "integration events" / "application readiness signals" in product & docs, NOT
--   "telemetry". Portix never receives ticket content, sold products, amounts, or end-customer PII.
