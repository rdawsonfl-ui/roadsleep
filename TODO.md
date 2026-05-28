# RoadSleep — To-Do List

Single source of truth for open work on RoadSleep. Updated as items ship.
Last touched: 2026-05-28

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
