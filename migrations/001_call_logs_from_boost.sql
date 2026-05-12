-- Migration: add from_boost flag to call_logs
--
-- Why: hoteliers pay for boosts to drive calls to their listing. Without
-- attribution, "you got 5 calls today" doesn't tell them whether the
-- boost paid off — could all be organic. This column flags the calls
-- where the driver tapped the Call button on a currently-boosted listing,
-- so the dashboard can show "5 calls today (3 from boost)".
--
-- Nullable + default false so existing rows stay valid and new code that
-- doesn't set it still works.
--
-- Run this in Supabase SQL Editor:

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS from_boost BOOLEAN NOT NULL DEFAULT false;

-- Optional: index for the dashboard query that filters boosted calls
-- on a per-hotel + per-time-window basis.
CREATE INDEX IF NOT EXISTS call_logs_hotel_from_boost_idx
  ON call_logs (hotel_id, from_boost, called_at);
