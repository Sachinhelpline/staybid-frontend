-- ═══════════════════════════════════════════════════════════════════════════
-- SEC-00B — Protected VERIFIED-STAY EVIDENCE authority.
-- ═══════════════════════════════════════════════════════════════════════════
-- The mutable public tables `bids`, `bookings`, and `checkin_checkout_logs`
-- have permissive RLS (anon + authenticated full CRUD), so a client can forge
-- any status/row in them. They MUST NOT be trusted as Verified-Guest
-- AUTO_APPROVE authority. This table is the dedicated, protected, forge-proof
-- evidence of a real, partner-verified stay.
--
-- SECURITY MODEL (deny-by-default for clients):
--   • RLS enabled AND forced.
--   • ZERO policies for anon / authenticated → clients can NEITHER read NOR
--     write (SELECT / INSERT / UPDATE / DELETE all denied by RLS + revoked
--     grants). No permissive public ALL policy exists.
--   • Only the Supabase `service_role` (BYPASSRLS) — i.e. the server-only
--     SUPABASE_SERVICE_ROLE_KEY held by the hardened partner check-in route —
--     may read or write. Verified-Guest eligibility reads it service-role too.
--   • One evidence row per (source_type, source_id): idempotent check-in /
--     check-out updates via the unique index.
--
-- ⚠ NOT APPLIED TO PRODUCTION by the PR that introduces it. Applying it is an
--    owner-controlled operation (Supabase MCP / linked CLI). Until it is applied
--    the table does not exist and Verified-Guest bid/stay proof fails closed
--    (empty), which is the intended safe default.
--
-- Additive / forward-only. TEXT ids (CUIDs), no FK constraints (repo contract).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.verified_stay_evidence (
  id            text primary key,
  customer_id   text        not null,
  hotel_id      text        not null,
  source_type   text        not null,          -- 'bid' | 'booking'
  source_id     text        not null,
  proof_state   text        not null,          -- 'checked_in' | 'checked_out'
  check_in_at   timestamptz,
  check_out_at  timestamptz,
  verified_at   timestamptz not null default now(),
  verifier_type text        not null,          -- 'partner' | 'admin'
  verifier_id   text        not null,
  created_at    timestamptz not null default now()
);

-- Idempotency / uniqueness: exactly one evidence row per underlying reservation.
create unique index if not exists uniq_vse_source
  on public.verified_stay_evidence (source_type, source_id);
create index if not exists idx_vse_customer
  on public.verified_stay_evidence (customer_id);
create index if not exists idx_vse_hotel
  on public.verified_stay_evidence (hotel_id);

-- RLS: deny-by-default. ENABLE + FORCE so even the table owner is subject to it;
-- only a role with BYPASSRLS (service_role) can read/write.
alter table public.verified_stay_evidence enable row level security;
alter table public.verified_stay_evidence force  row level security;

-- Drop any policy that a prior/incorrect apply might have created — this table
-- must have NO client policy at all (no SELECT, and never a permissive ALL).
drop policy if exists vse_all             on public.verified_stay_evidence;
drop policy if exists vse_select_readonly on public.verified_stay_evidence;
drop policy if exists vse_select          on public.verified_stay_evidence;

-- Least privilege at the GRANT layer too: clients get NOTHING; service_role all.
revoke all on public.verified_stay_evidence from anon, authenticated;
grant  all on public.verified_stay_evidence to   service_role;
