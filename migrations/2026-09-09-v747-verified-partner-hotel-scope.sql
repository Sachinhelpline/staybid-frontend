-- ═══════════════════════════════════════════════════════════════════════════
-- SEC-00B — Protected PARTNER↔HOTEL SCOPE authority.
-- ═══════════════════════════════════════════════════════════════════════════
-- The verified-stay evidence writer (hardened /api/partner/checkin|checkout)
-- must prove the caller is authorized for a SPECIFIC hotel. Until now that scope
-- was resolved from `hotels.ownerId` and `hotel_room_units.owner_user_id` — but
-- independent production verification shows BOTH of those tables have permissive
-- RLS (anon + authenticated full CRUD, ALL policy qual=true / with_check=true).
-- So a normal customer with a legitimate signed customer-family token could edit
-- one of those public ownership mappings to their own subject and then cause the
-- server service-role to mint protected verified_stay_evidence. That mapping is
-- CLIENT-FORGEABLE and must NOT be the partner↔hotel security authority.
--
-- This table is the dedicated, protected, forge-proof partner↔hotel binding:
--   • one row = "this partner subject is an ACCEPTED, ACTIVE partner authorized
--     for this EXACT hotel". A revoked/disabled binding grants nothing.
--   • it is the authority the evidence writer reads (service-role) to decide
--     partner-hotel authorization; the public hotels.ownerId /
--     hotel_room_units.owner_user_id mappings remain DISPLAY / inventory data
--     only, never the evidence-writer security authority.
--
-- SECURITY MODEL (deny-by-default for clients):
--   • RLS enabled AND forced.
--   • ZERO policies for anon / authenticated → clients can NEITHER read NOR
--     write (no permissive public ALL policy).
--   • grants revoked from anon / authenticated; only the Supabase `service_role`
--     (BYPASSRLS, the server-only SUPABASE_SERVICE_ROLE_KEY) may read or write.
--   • unique (partner_subject, hotel_id) → idempotent binding.
--
-- ⚠ NOT APPLIED TO PRODUCTION by the PR that introduces it. Applying it is an
--    owner-controlled operation (Supabase MCP / linked CLI). Until it is applied
--    AND an ops/admin path has populated ACTIVE bindings for real partners, the
--    evidence writer fails closed (no scope → 403), which is the intended safe
--    default. Do NOT broadly lock down hotels / hotel_room_units here — this
--    isolated protected authority is the minimal blast-radius fix.
--
-- Additive / forward-only. TEXT ids (CUIDs), no FK constraints (repo contract).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.verified_partner_hotel_scope (
  id              text primary key,             -- vphs_<partner_subject>_<hotel_id>
  partner_subject text        not null,         -- the verified token subject
  hotel_id        text        not null,
  role            text        not null default 'hotel_partner',  -- accepted partner role/domain
  status          text        not null default 'active',         -- 'active' | 'revoked'
  granted_by      text,                          -- ops/admin identity that created it
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

-- Idempotency / uniqueness: exactly one binding per (partner subject, hotel).
create unique index if not exists uniq_vphs_binding
  on public.verified_partner_hotel_scope (partner_subject, hotel_id);
create index if not exists idx_vphs_subject
  on public.verified_partner_hotel_scope (partner_subject);
create index if not exists idx_vphs_hotel
  on public.verified_partner_hotel_scope (hotel_id);

-- RLS: deny-by-default. ENABLE + FORCE so even the table owner is subject to it;
-- only a role with BYPASSRLS (service_role) can read/write.
alter table public.verified_partner_hotel_scope enable row level security;
alter table public.verified_partner_hotel_scope force  row level security;

-- Drop any policy a prior/incorrect apply might have created — this table must
-- have NO client policy at all (no SELECT, and never a permissive ALL).
drop policy if exists vphs_all             on public.verified_partner_hotel_scope;
drop policy if exists vphs_select_readonly on public.verified_partner_hotel_scope;
drop policy if exists vphs_select          on public.verified_partner_hotel_scope;

-- Least privilege at the GRANT layer too: clients get NOTHING; service_role all.
revoke all on public.verified_partner_hotel_scope from anon, authenticated;
grant  all on public.verified_partner_hotel_scope to   service_role;
