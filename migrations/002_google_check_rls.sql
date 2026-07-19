-- Migration: enable Row Level Security on google_check
--
-- Why: google_check is the only table in the database with RLS disabled.
-- With RLS off, the public anon key can read AND write every row. The table
-- holds Google Places verification state (business_status, phone_matches,
-- checked_at) keyed to hotel_id — not catastrophic if read, but writable by
-- anyone who opens devtools, which means a stranger could mark every listing
-- CLOSED_PERMANENTLY and quietly take the catalog offline.
--
-- Safe to run: no application code reads or writes google_check from the
-- client. It's populated by operator-run enrichment jobs using the service
-- role key, which bypasses RLS entirely. The read policy below is included
-- anyway so a future admin-side read doesn't break.
--
-- Run in the Supabase SQL Editor.

ALTER TABLE public.google_check ENABLE ROW LEVEL SECURITY;

-- Read-only for anon/authenticated. Writes are service-role only, which
-- happens automatically once RLS is on and no write policy exists.
DROP POLICY IF EXISTS "Public read google_check" ON public.google_check;
CREATE POLICY "Public read google_check"
  ON public.google_check
  FOR SELECT
  USING (true);

-- Verify afterwards:
--   select relname, relrowsecurity from pg_class where relname = 'google_check';
--   -- expect relrowsecurity = true
