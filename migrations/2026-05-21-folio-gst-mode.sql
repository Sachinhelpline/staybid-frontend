-- v171 — Billing: GST mode (inclusive / exclusive) on folios.
--
-- Adds gst_mode to guest_folios so the bill summary can show a
-- GST-inclusive vs GST-exclusive bifurcation. Default 'exclusive'
-- keeps every existing folio unchanged.
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.

ALTER TABLE public.guest_folios
  ADD COLUMN IF NOT EXISTS gst_mode TEXT NOT NULL DEFAULT 'exclusive';
