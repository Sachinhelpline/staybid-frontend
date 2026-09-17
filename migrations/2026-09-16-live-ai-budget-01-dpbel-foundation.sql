-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-BUDGET-01 — DPBEL durable data model (UNAPPLIED review/integration artifact)
--
-- ⚠ THIS MIGRATION IS UNAPPLIED. It is NOT run against any Supabase / Railway /
--   production database by this implementation packet. It is applied ONLY against a
--   throwaway, socket-only PostgreSQL cluster by the isolated integration test
--   (tests/budget/live-ai-budget-01.pg.test.js) and is provided here as the durable
--   schema of record for independent review + a future owner-controlled apply.
--
-- Durable Pre-reserved Budget Envelope with a bounded Local synchronous lease Ledger.
-- Money + counters are BIGINT (signed-64-bit, USD micro-units; 1 USD = 1,000,000).
-- Stable scope-period counters are keyed WITHOUT policy/catalog version, so a policy or
-- price-catalog rollover NEVER resets accounting. Closed state CHECK constraints,
-- non-negative checks, foreign keys, idempotency uniqueness, and period/envelope/
-- reconciliation indexes throughout. NO seeded policy, NO seeded price catalog, NO
-- credential, NO provider-activation row is created here.
--
-- Idempotent: every object uses IF NOT EXISTS so the artifact can be re-applied to a
-- throwaway cluster without error.
--
-- REMEDIATION-01 delta (BUDGET-IMP-P0-01/P0-02/P1-01/P1-03/P1-04/P1-05):
--   • envelopes persist EVERY immutable issuance pin (issued/expires ms, lease TTL,
--     control staleness, global/project control epochs, control-vector digest,
--     lease generation, canonical acquisition commitment) + a durable revoke marker +
--     an excess/over-cap debt record — so an acquisition replay reconstructs EXACTLY
--     the original envelope and can never extend expiry / substitute clock, policy,
--     catalog or control (P0-01);
--   • the subject/day provider-spend ceiling + effective-interval fields on policy &
--     catalog versions (P1-04 A/D);
--   • provider reservations carry the trusted provider-turn id + over-cap/excess
--     columns; settlements carry over-cap/excess/incident (P1-01/P1-03);
--   • an orphan-reap index on (state, expires_at_ms) (P1-05 B).
-- ═════════════════════════════════════════════════════════════════════════

-- ── policy versions (ceilings live here; NOT part of any counter's identity) ──
CREATE TABLE IF NOT EXISTS budget_policy_versions (
  id                                  TEXT PRIMARY KEY,
  project_id                          TEXT NOT NULL,                    -- '*' = global default
  status                              TEXT NOT NULL CHECK (status IN ('active','inactive','superseded')),
  effective_from                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until                     TIMESTAMPTZ,                      -- P1-04 D — NULL = open-ended
  session_money_ceiling_micros        BIGINT NOT NULL CHECK (session_money_ceiling_micros >= 0),
  session_provider_calls              BIGINT NOT NULL CHECK (session_provider_calls >= 0),
  session_execution_admissions        BIGINT NOT NULL CHECK (session_execution_admissions >= 0),
  subject_day_money_ceiling_micros    BIGINT NOT NULL DEFAULT 0 CHECK (subject_day_money_ceiling_micros >= 0), -- P1-04 A
  project_day_money_ceiling_micros    BIGINT NOT NULL CHECK (project_day_money_ceiling_micros >= 0),
  project_month_money_ceiling_micros  BIGINT NOT NULL CHECK (project_month_money_ceiling_micros >= 0),
  global_day_money_ceiling_micros     BIGINT NOT NULL CHECK (global_day_money_ceiling_micros >= 0),
  policy_digest                       TEXT NOT NULL,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS idx_budget_policy_active ON budget_policy_versions (project_id, status, effective_from DESC);

-- ── price catalog versions + entries (verification-bounded; default EMPTY) ──
CREATE TABLE IF NOT EXISTS budget_price_catalog_versions (
  id              TEXT PRIMARY KEY,
  status          TEXT NOT NULL CHECK (status IN ('active','inactive','revoked')),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,                                          -- P1-04 D — NULL = open-ended
  catalog_digest  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS idx_budget_catalog_active ON budget_price_catalog_versions (status, effective_from DESC);

CREATE TABLE IF NOT EXISTS budget_price_catalog_entries (
  id                       TEXT PRIMARY KEY,
  catalog_version_id       TEXT NOT NULL REFERENCES budget_price_catalog_versions(id),
  provider                 TEXT NOT NULL,
  model                    TEXT NOT NULL,
  service_tier             TEXT,
  billing_dimension        TEXT NOT NULL,
  currency_code            TEXT NOT NULL,
  unit_size                BIGINT NOT NULL CHECK (unit_size > 0),
  rate_micros              BIGINT NOT NULL CHECK (rate_micros >= 0),
  effective_from           TIMESTAMPTZ NOT NULL,
  effective_until          TIMESTAMPTZ,
  verified_at              TIMESTAMPTZ NOT NULL,
  verification_expires_at  TIMESTAMPTZ NOT NULL,
  source_id                TEXT NOT NULL,
  source_digest            TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN ('active','inactive','revoked')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (verification_expires_at >= verified_at),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS idx_budget_catalog_entry_lookup
  ON budget_price_catalog_entries (provider, model, billing_dimension, status, effective_from DESC);

-- ── control epochs (monotonic; emergency kill / disable) ──
CREATE TABLE IF NOT EXISTS budget_control_epochs (
  scope_type       TEXT NOT NULL CHECK (scope_type IN ('global','project')),
  scope_key_digest TEXT NOT NULL,
  control_epoch    BIGINT NOT NULL CHECK (control_epoch >= 0),
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  killed           BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  record_digest    TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_key_digest)
);

-- ── budget sessions (keyed to the GATEWAY-owned session authority digest, §5/§11) ──
-- The trusted ownership tuple (gateway_session_digest, subject_digest, project_id) is
-- IMMUTABLE: an existing row is reusable ONLY on exact equality of all three (P0-02).
CREATE TABLE IF NOT EXISTS budget_sessions (
  id                     TEXT PRIMARY KEY,
  gateway_session_digest TEXT NOT NULL UNIQUE,   -- a NEW digest = a NEW per-session scope
  subject_digest         TEXT NOT NULL,
  project_id             TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── stable scope-period counters (identity EXCLUDES policy/catalog version, §10) ──
CREATE TABLE IF NOT EXISTS budget_scope_counters (
  id                    TEXT PRIMARY KEY,
  scope_type            TEXT NOT NULL CHECK (scope_type IN ('gateway_session','subject','project','global')),
  scope_key_digest      TEXT NOT NULL,
  period_kind           TEXT NOT NULL CHECK (period_kind IN ('session','day','month','lifetime')),
  period_start_utc      TIMESTAMPTZ NOT NULL,
  budget_class          TEXT NOT NULL CHECK (budget_class IN ('EXECUTION_ADMISSION','PROVIDER_SPEND')),
  accounting_dimension  TEXT NOT NULL CHECK (accounting_dimension IN ('money_micros','provider_calls','execution_admissions')),
  currency_code         TEXT NOT NULL,
  held                  BIGINT NOT NULL DEFAULT 0 CHECK (held >= 0),
  charged               BIGINT NOT NULL DEFAULT 0 CHECK (charged >= 0),
  consumed              BIGINT NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  released              BIGINT NOT NULL DEFAULT 0 CHECK (released >= 0),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- STABLE key: no policy/catalog version ⇒ a rollover never resets accounting.
  CONSTRAINT uniq_budget_scope_counter UNIQUE (scope_type, scope_key_digest, period_kind, period_start_utc, budget_class, accounting_dimension, currency_code)
);
CREATE INDEX IF NOT EXISTS idx_budget_counter_period ON budget_scope_counters (scope_type, scope_key_digest, period_kind, period_start_utc);

-- ── envelopes (the durable pre-reservation; acquisition idempotency key) ──
-- REMEDIATION-01 (P0-01): every immutable issuance pin is persisted so a replay of the
-- acquisition key reconstructs EXACTLY the original envelope (never the current clock/
-- policy/catalog/control) and a terminal/expired/revoked envelope is never resurrected.
CREATE TABLE IF NOT EXISTS budget_envelopes (
  id                             TEXT PRIMARY KEY,
  acquisition_key                TEXT NOT NULL UNIQUE,        -- create-once idempotency
  request_digest                 TEXT NOT NULL,               -- legacy comparator (kept for audit)
  acquisition_commitment         TEXT NOT NULL,               -- P1-04 E — canonical collision-resistant commitment
  budget_class                   TEXT NOT NULL CHECK (budget_class IN ('EXECUTION_ADMISSION','PROVIDER_SPEND')),
  budget_session_id              TEXT NOT NULL REFERENCES budget_sessions(id),
  gateway_session_digest         TEXT NOT NULL,
  subject_digest                 TEXT NOT NULL,
  project_id                     TEXT NOT NULL,
  policy_version_id              TEXT NOT NULL REFERENCES budget_policy_versions(id),
  price_catalog_version_id       TEXT REFERENCES budget_price_catalog_versions(id),
  -- immutable issuance pins (P0-01 A) ─────────────────────────────────────────
  global_control_epoch           BIGINT NOT NULL CHECK (global_control_epoch >= 0),
  project_control_epoch          BIGINT NOT NULL CHECK (project_control_epoch >= 0),
  control_vector_digest          TEXT NOT NULL,
  -- P0-01 FROZEN-LIFECYCLE — the TRUSTED gateway process/boot instance identifier pinned at
  -- issuance (browser/model/provider can never choose it). NOT NULL for every newly issued
  -- envelope + immutable for its lifetime. A replay whose current trusted boot nonce differs is
  -- refused (envelope_previous_boot) → the envelope enters the conservative forfeit lifecycle, so
  -- a process restart never resurrects old local allocation authority even if a durable revoke
  -- write never landed. (No replica_epoch/instance_generation: replica generation is NOT naturally
  -- available in this single-process gateway core, so the bootNonce is the minimum sufficient bind.)
  boot_nonce                     TEXT NOT NULL,
  lease_ttl_ms                   BIGINT NOT NULL CHECK (lease_ttl_ms >= 0),
  max_control_staleness_ms       BIGINT NOT NULL CHECK (max_control_staleness_ms >= 0),
  lease_generation               BIGINT NOT NULL DEFAULT 1 CHECK (lease_generation >= 0),
  issued_at_ms                   BIGINT NOT NULL,
  expires_at_ms                  BIGINT NOT NULL,
  -- immutable original quota (P0-01 A) ────────────────────────────────────────
  money_held_micros              BIGINT NOT NULL CHECK (money_held_micros >= 0),
  provider_calls_held            BIGINT NOT NULL CHECK (provider_calls_held >= 0),
  execution_admissions_held      BIGINT NOT NULL CHECK (execution_admissions_held >= 0),
  -- reconciliation outputs ────────────────────────────────────────────────────
  money_charged_micros           BIGINT NOT NULL DEFAULT 0 CHECK (money_charged_micros >= 0),
  money_released_micros          BIGINT NOT NULL DEFAULT 0 CHECK (money_released_micros >= 0),
  provider_calls_charged         BIGINT NOT NULL DEFAULT 0 CHECK (provider_calls_charged >= 0),
  provider_calls_released        BIGINT NOT NULL DEFAULT 0 CHECK (provider_calls_released >= 0),
  execution_admissions_consumed  BIGINT NOT NULL DEFAULT 0 CHECK (execution_admissions_consumed >= 0),
  execution_admissions_released  BIGINT NOT NULL DEFAULT 0 CHECK (execution_admissions_released >= 0),
  -- excess / over-cap debt that cannot be represented as spend (P1-03 D / §10 G) ─
  excess_money_micros            BIGINT NOT NULL DEFAULT 0 CHECK (excess_money_micros >= 0),
  incident_reason                TEXT,
  -- lifecycle ─────────────────────────────────────────────────────────────────
  state                          TEXT NOT NULL CHECK (state IN ('held','reconciled','forfeited')),
  revoked_at                     TIMESTAMPTZ,                 -- P0-01 B — durable revoke marker
  revoked_reason                 TEXT,
  acquired_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  acquired_at_ms                 BIGINT NOT NULL,
  reconciled_at                  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_budget_envelope_session ON budget_envelopes (gateway_session_digest, state);
CREATE INDEX IF NOT EXISTS idx_budget_envelope_state ON budget_envelopes (state, acquired_at);
-- P1-05 B — orphan-reap scan: held envelopes past their authoritative expiry.
CREATE INDEX IF NOT EXISTS idx_budget_envelope_reap ON budget_envelopes (state, expires_at_ms);

-- ── envelope allocations (per-counter held amount of an envelope) ──
CREATE TABLE IF NOT EXISTS budget_envelope_allocations (
  id                   TEXT PRIMARY KEY,
  envelope_id          TEXT NOT NULL REFERENCES budget_envelopes(id),
  scope_counter_id     TEXT NOT NULL REFERENCES budget_scope_counters(id),
  accounting_dimension TEXT NOT NULL CHECK (accounting_dimension IN ('money_micros','provider_calls','execution_admissions')),
  held_amount          BIGINT NOT NULL CHECK (held_amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_budget_alloc_envelope ON budget_envelope_allocations (envelope_id);

-- ── decisions (admitted / refused audit) ──
CREATE TABLE IF NOT EXISTS budget_decisions (
  id                       TEXT PRIMARY KEY,
  acquisition_key          TEXT NOT NULL,
  budget_class             TEXT NOT NULL CHECK (budget_class IN ('EXECUTION_ADMISSION','PROVIDER_SPEND')),
  gateway_session_digest   TEXT NOT NULL,
  project_id               TEXT NOT NULL,
  policy_version_id        TEXT REFERENCES budget_policy_versions(id),
  price_catalog_version_id TEXT REFERENCES budget_price_catalog_versions(id),
  decision                 TEXT NOT NULL CHECK (decision IN ('ADMITTED','REFUSED')),
  detail                   TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_budget_decision_key ON budget_decisions (acquisition_key, created_at);

-- ── provider reservations + settlements (durable ledger of provider spend) ──
-- REMEDIATION-01 (P1-01): reservation_ref carries the TRUSTED provider-turn id so an
-- exact-duplicate reserve across facade recreation / process restart hydrates the same
-- reservation (no fresh authority); a conflicting reuse fails closed. over_cap/excess
-- columns represent an actual-over-reservation incident (P1-03 D) without under-accounting.
CREATE TABLE IF NOT EXISTS budget_provider_reservations (
  id                     TEXT PRIMARY KEY,
  envelope_id            TEXT NOT NULL REFERENCES budget_envelopes(id),
  reservation_ref        TEXT NOT NULL UNIQUE,   -- the trusted providerTurnId (idempotency)
  provider_spend_class   TEXT NOT NULL CHECK (provider_spend_class IN ('REASONING','TRANSCRIPTION','TTS')),
  request_commitment     TEXT NOT NULL,          -- canonical commitment of (class, estimate) for conflict detection
  money_micros           BIGINT NOT NULL CHECK (money_micros >= 0),
  provider_units         BIGINT NOT NULL CHECK (provider_units >= 0),
  state                  TEXT NOT NULL CHECK (state IN ('open','settled','revoked')),
  over_cap               BOOLEAN NOT NULL DEFAULT FALSE,
  excess_units           BIGINT CHECK (excess_units IS NULL OR excess_units >= 0),
  incident_reason        TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_budget_reservation_envelope ON budget_provider_reservations (envelope_id, state);

CREATE TABLE IF NOT EXISTS budget_provider_settlements (
  id              TEXT PRIMARY KEY,
  reservation_id  TEXT NOT NULL REFERENCES budget_provider_reservations(id),
  charged_micros  BIGINT NOT NULL CHECK (charged_micros >= 0),
  released_micros BIGINT NOT NULL CHECK (released_micros >= 0),
  actual_units    BIGINT CHECK (actual_units IS NULL OR actual_units >= 0),
  over_cap        BOOLEAN NOT NULL DEFAULT FALSE,
  excess_units    BIGINT CHECK (excess_units IS NULL OR excess_units >= 0),
  incident_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── execution consumptions (idempotent per executionId; hydratable per envelope) ──
CREATE TABLE IF NOT EXISTS budget_execution_consumptions (
  id                     TEXT PRIMARY KEY,
  envelope_id            TEXT NOT NULL REFERENCES budget_envelopes(id),
  gateway_session_digest TEXT NOT NULL,
  execution_id           TEXT NOT NULL UNIQUE,
  request_digest         TEXT NOT NULL,
  admission_ref          TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_budget_exec_consumption_envelope ON budget_execution_consumptions (envelope_id);

-- ── reconciliations (idempotent per reconciliation key) ──
CREATE TABLE IF NOT EXISTS budget_reconciliations (
  id                 TEXT PRIMARY KEY,
  reconciliation_key TEXT NOT NULL UNIQUE,
  envelope_id        TEXT NOT NULL REFERENCES budget_envelopes(id),
  clean              BOOLEAN NOT NULL,
  crash_forfeit      BOOLEAN NOT NULL DEFAULT FALSE,   -- P1-05 — reaper/crash forfeiture marker
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_budget_reconcile_envelope ON budget_reconciliations (envelope_id);

-- (No seeded policy / price catalog / control row / credential is created here.)
