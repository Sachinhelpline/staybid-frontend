-- HQ Support Desk — RLS policy fix + follow-up.
--
-- The two tables were created with RLS ENABLED but ZERO policies, which blocked
-- the anon key (@/lib/sb SB_KEY) that the party-side server routes use → tickets
-- failed to create ("create_failed"). Every other app table (complaints,
-- support_conversations, bids, …) carries this exact permissive policy; row
-- scoping is enforced in the server routes (owner_scope ∈ the caller's ids),
-- not by RLS. This aligns the support tables with that app-wide convention.
--
-- Applied live via Supabase MCP apply_migration (project uxxhbdqedazpmvbvaosh).

DROP POLICY IF EXISTS all_anon_all ON public.hq_support_tickets;
CREATE POLICY all_anon_all ON public.hq_support_tickets
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS all_anon_all ON public.hq_support_messages;
CREATE POLICY all_anon_all ON public.hq_support_messages
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
