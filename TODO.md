# RoadSleep — To-Do List

Single source of truth for open work on RoadSleep. Updated as items ship.
Last touched: 2026-07-21

## ✅ Shipped 2026-07-21

- **Security: RLS rewrite.** `hotels` and `hoteliers` write policies were
  `USING(true)` — the public anon key had owner-level write access, and
  `hoteliers` / `call_logs` / `campaign_visits` were world-readable. Closed and
  verified as the `anon` role. `/admin` now signs in via Supabase Auth and
  checks the new `site_admins` table (`is_site_admin()`).
- **`route_position`** column on `exits` — continuous miles from each
  corridor's terminus. Direction filtering and sort now use it; `mile_marker`
  holds exit numbers and is non-monotonic on I-87.
- **Lodging discovery pipeline** — `enqueue/fire/collect_lodging_discovery`,
  with a permanent gate rejecting short-term rentals. 610 hotels published,
  every zero-coverage exit filled. Network at ~2,007 live hotels.
- **Corridor auto-switch** now releases a manual pill selection once the driver
  has clearly left that road.
- UI: Day/Night toggle moved to nav, wordmark into the page H1, "Find a Stop"
  removed, ← Home added off-homepage, cards show "Exit 45" not "MM 45".

## 🔜 Open, small

- **Second admin account.** `site_admins` has one row. Losing that password
  means losing admin permanently. Enroll a backup address.
- **Poughkeepsie mis-assignment.** Two hotels are attached to I-87 exits but
  Poughkeepsie isn't on I-87. Reassign or drop.
- **~297 previously-hidden listings** never reviewed. Separate from the
  discovery batch.
- **`route_position` backfill for new exits.** The backfill was a one-off
  query; new exits land with a null. Either re-run it after seeding a corridor
  or make it a trigger.
- **Discovery for remaining corridors** is done for every exit that had zero
  hotels. Exits that already had one or two were never re-checked, so thin
  coverage is still thin.

## 🎯 Arrival proof v2 — SMS confirmation (next session w/ Twilio)
The "📍 arrived" pill was removed from the hotelier dashboard 2026-05-29
because iOS Safari kills background JS within ~30s, so the 90-minute GPS
tracker almost never completed. We were quietly showing misleading data.

The honest replacement is SMS-back confirmation:
1. Driver taps Call on boosted hotel → log timestamp + initial distance (already done)
2. Compute ETA: (distance × 1.4) / 60mph. e.g. 12mi tap → 17min ETA
3. At ETA + 5min, Twilio SMS the driver: "At Hampton Inn Tampa now? Tap → roadsleep.com/c/abc"
4. They tap → page opens with live GPS → if within 0.5mi, write arrived_at
5. Hotelier sees: "Driver tapped from 12.4mi · SMS-confirmed arrival 18min later"

**Blocker:** Twilio + A2P 10DLC registration (same blocker as carsnfc SMS).
**Cost:** $0.008/text, <$10/mo even at 1000 boost calls.
**Capture rate:** probably 40-60%. But every confirmed arrival is REAL,
vs the old tracker that was mostly noise.

**Need to capture driver phone first** — currently we don't ask. Could add
optional "we'll text you a 1-tap check-in to prove the boost worked" prompt
right after they tap Call, NOT before (don't add friction to the actual call).
arrived_at column is preserved on call_logs so this slots in cleanly later.

---

## 🌅 NEXT (tomorrow AM) — Google API to load verified hotels
**The ask:** load hotels into roadsleep that are *verified* (not random scrape).

What "verified" most likely means here (confirm at start of session):
- **Google Places API** — Google's own business listings. Each Place has a
  `business_status` ("OPERATIONAL"), a stable `place_id`, real reviews, hours,
  photos, address, lat/lng. That's the standard for "verified."
- Filter by `type=lodging` (and/or `hotel`) within a search area.

What to think through BEFORE wiring:
1. **Cost.** Google Places billing is per-call. Text Search ≈ $32 / 1000 calls,
   Place Details ≈ $17 / 1000, Photos ≈ $7 / 1000. Free $200/mo credit covers
   light usage but burns fast on autocomplete-style UX. Strategy: cache results
   in Supabase (places_cache table) so we don't re-bill every refresh.
2. **API key safety.** Browser-side key must be restricted (HTTP referrer +
   API restriction = Places only) OR proxy through a serverless function with
   the key in env vars. Proxy is safer for billing.
3. **Search model.** "Near me" (geolocation) vs. "by city/route." For roadsleep
   the route/city model makes more sense (planning a road trip).
4. **What does the buyer/user actually need?** Probably: hotel name, photo,
   price hint (Google doesn't give live rates — you'd need Booking.com/Expedia
   affiliate APIs for that), rating, distance, address, one-tap call.

Honest flag: Google Places does NOT include live nightly rates. If "verified
hotels with prices" is the real ask, that's a SECOND integration (Booking
affiliate, Expedia Rapid, or similar) and a real business decision. Confirm
scope before building.

Build plan (when we start):
- [ ] Confirm exact "verified" definition with user
- [ ] Confirm whether prices are needed (Places vs Places + affiliate)
- [ ] Get Google Cloud project + Places API enabled + billing on
- [ ] Restricted API key in roadsleep Vercel env
- [ ] Serverless proxy `/api/hotels?lat=&lng=&radius=` (caches to Supabase)
- [ ] Frontend: search box + results list with photos/rating/address

---

**Important framing:** RoadSleep is a SEPARATE asset from NFCSales,
intended as a quick-flip exit for cash, not strategic to the portfolio.
For broader portfolio strategy and the $500K NFCSales target see
`STRATEGY.md` in the forsalenfc repo:
https://github.com/rdawsonfl-ui/forsalenfc/blob/main/STRATEGY.md

---

## Disposition strategy

**RoadSleep = throwaway flip.** Realistic outcomes:
- As-is, no paying hoteliers: $5-25K to a hotel marketing operator
- With 1-3 paying hoteliers: $50-150K
- Premium with 10+ paying: $200-500K (unlikely given operator
  focus is NFCSales, not this)

Selling targets:
- MicroAcquire / Acquire.com / IndieAcquisitions
- Hotel marketing operators (Travel Media Group competitors)
- HotelCoupons.com (own a similar print directory, may want to
  acquire the digital version to neutralize)

**Operator stance:** stop investing time in features. Whatever's
deployed is what gets sold. Polish and growth work is off the
table.

---

## 🔥 Sale-readiness items only

### Get any hoteliers to convert paid

The threshold that turns RoadSleep from "$25K demo" to "$50-150K
asset with proof." Even one paid hotelier helps. Three nearby
hotels from the coupon book operator already has.

- [ ] 3 phone calls from the I-87 corridor coupon book
- [ ] Pitch: free month, then $99-249/mo boost tier
- [ ] Even one yes is enough for valuation lift

### Clean handoff doc for a buyer

When the time comes, the buyer needs a clear "here's what you're
getting" packet:

- [ ] Stack overview: Next.js + Supabase + Vercel
- [ ] Account access: Supabase project `ipfztqjxcaahwdpatkbn`,
      Vercel project `roadsleep`, GitHub repo
- [ ] Customer pipeline (if any paid hoteliers exist by then)
- [ ] Operational state: who has access, how to transfer

### Listing for sale

- [ ] List on MicroAcquire / Acquire.com when ready
- [ ] Asking: $25K floor without traction, $75-150K with
      paying customers
- [ ] No earnouts; cash close only
- [ ] Allow buyer to transfer the domain (`roadsleep.com`) and
      GitHub repo cleanly

---

## ✅ Already-shipped (final state for sale)

- ✅ Full hotelier signup → boost activation → expiry flow
- ✅ GPS arrival tracking with consent modal (privacy-compliant)
- ✅ /privacy + /terms pages (commit 4420fc9)
- ✅ iOS tel: dial fixed — no app-picker bug on Call (commit 8c8c9cf)
- ✅ Mobile-only boost panel above tabs on /hotelier (commit 876cf93)
- ✅ Terms wording: "You control when boost is active" (commit 5be2b17)
- ✅ Hilton Garden Inn Albany Airport zombie boost cleared
- ✅ pg_cron job sweeping orphaned boosts every 5 minutes — DB is
      authoritative source of truth for featured state
- ✅ Service role write lockdown on production tables

---

## 💭 Known issues NOT being fixed (sell-as-is)

The following are real flaws a buyer might find. Operator decided NOT
to invest more time fixing them because RoadSleep is the flip not the
strategic asset:

- Admin "Featured" checkbox bypasses boost system, creates orphan
  featured state (now auto-cleaned by cron, but the UI toggle is
  still misleading)
- Boost flow has UI ambiguity on which hotel is being boosted when
  hotelier owns multiple
- No real-time arrival SMS/email to hotelier when driver lands
- Google Places fetch sometimes returns stale data
- Lake George Village inventory gap (no hotels in that corridor)
- No admin view for suspicious-tap detection
- Per-corridor heat map not built
- SMS boost code delivery not built
- Apple Maps fallback for Android-blocked Maps not built

Buyer takes these on. We disclose them in the handoff.

---

## Tech reference (for the next Claude)

- **GitHub repo:** github.com/rdawsonfl-ui/roadsleep (public)
- **Live URL:** roadsleep.com
- **Vercel project ID:** `roadsleep` (slug)
- **Vercel team:** team_ghDOvv6Jx1eOGpvuG5cKgkNu
- **Supabase project:** ipfztqjxcaahwdpatkbn
- **Architecture:** Next.js (App Router) + Supabase + Vercel
- **Test hotelier account:** rdawsonfl@gmail.com / TempBoost2026!
  linked to Motel 6 Queensbury (`7eb23abc-a676-4559-8299-01aed346d65b`)
- **Key tables:** hotels, hoteliers, call_logs, boost_orders
- **Cron job:** sweep-expired-boosts runs every 5 min in
  Postgres (clears featured=true rows where boost_ends_at is null or past)
