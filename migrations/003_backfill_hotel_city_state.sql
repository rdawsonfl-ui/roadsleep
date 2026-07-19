-- Migration: backfill null hotels.city / hotels.state from the linked exit
--
-- Why: a small number of hotel rows carry null city/state on the hotel record
-- and derive their location entirely from the exit they hang off. Any query
-- that filters on hotels.state silently drops them — they don't error, they
-- just vanish, which is the worst failure mode for an inventory table.
--
-- The application code now falls back to exits.city / exits.state when
-- composing an address, so the driver-facing display is already correct.
-- This migration fixes the data itself so ad-hoc SQL and future features
-- don't have to remember the fallback.
--
-- exits.state is the authoritative field. This only writes where the hotel
-- value is currently null — it never overwrites an existing value, so it is
-- safe to run more than once.
--
-- Run in the Supabase SQL Editor.

-- 1. Inspect first. Run this before the update and keep the output.
SELECT h.id, h.name, h.city AS hotel_city, h.state AS hotel_state,
       e.city AS exit_city, e.state AS exit_state
FROM public.hotels h
JOIN public.exits e ON e.id = h.exit_id
WHERE h.state IS NULL OR h.city IS NULL;

-- 2. Backfill.
UPDATE public.hotels h
SET city  = COALESCE(h.city,  e.city),
    state = COALESCE(h.state, e.state)
FROM public.exits e
WHERE e.id = h.exit_id
  AND (h.state IS NULL OR h.city IS NULL);

-- 3. Confirm. Expect zero rows, except any hotel whose exit is also missing
--    city/state — those need manual attention, not a backfill.
SELECT h.id, h.name
FROM public.hotels h
LEFT JOIN public.exits e ON e.id = h.exit_id
WHERE h.state IS NULL OR h.city IS NULL;
