# Decision Log

The "why" behind major product and technical choices. Buyers read this to understand whether the platform was built deliberately or vibe-coded together.

Each entry: what was decided, when (roughly), and the reasoning. Decisions are listed in roughly chronological order.

---

## Product decisions

### D-1. Interstate corridors are the primary axis

**Why:** Every other lodging app starts with "what city are you in?" That fits a tourist or business traveler — it does not fit a long-haul driver. A trucker on I-75 doesn't care that there's a Motel 6 in downtown Lakeland; they care whether there's truck parking at the next four exits.

The corridor-first model means every search starts with the road, not the city. This is the entire premise of the product.

### D-2. East of the Mississippi only (for now)

**Why:** The data acquisition cost per corridor is real (4-8 hours of seeding). Starting east-of-the-Mississippi covers ~70% of the long-haul-trucking volume in the U.S. with ~50% of the corridor mileage. Better to be deep in 13 corridors than shallow in 50.

I-5 is wired in code but not seeded — it's the first west-coast corridor and a test of the cross-country expansion process.

### D-3. Direction filter is GPS-derived, not user-selected

**Why:** Earlier prototypes had Northbound/Southbound buttons the driver tapped manually. Drivers got it wrong constantly — they'd think they were going north because they came from the south. Comparing GPS lat (or lng for E/W roads) to exit lat/lng eliminates the question. The buttons still exist for override but the default is automatic.

### D-4. Distance slider is a max cap, not a band

**Why:** Originally the slider was "+/-50 mi from target value." Driver at slider=100 wouldn't see hotels at 30 mi (too close). User complaint: "where are the hotels in Naples? I'm going there." The +/-50 model assumed drivers wanted "stops 100 mi from now"; in reality they wanted "everything within 100 mi."

Now: slider value = max distance shown. Slider at "Anywhere" disables the cap entirely.

### D-5. The slider sorts results by distance to slider value, not pure closest-first

**Why:** Closest-first conflicts with trip planning. If you slide to 500 mi to plan a longer leg, the top of the list shouldn't still be the gas station 5 mi away — it should be hotels around the 500 mi mark. The sort target = slider value when slider is engaged; closest-first when slider is at "Anywhere."

### D-6. Pill row auto-selects the closest corridor on first GPS resolve

**Why:** User feedback: "I didn't know enough to click the route pill to enable it." The pills were inert decoration until tapped. Auto-selecting the corridor of the closest listing on first paint means the driver gets useful results in zero taps.

Auto-select fires once per session, not on every GPS update — so driving between corridors doesn't yank a driver away from a list they're already reading.

### D-7. Pill radius tracks the slider with a 200 mi floor

**Why:** Earlier the pill row was locked to "within 75 mi" regardless of slider position. Driver in Cape Coral pushing the slider to 500 mi to plan a longer trip would see I-10 hotels in the list but no I-10 pill — couldn't filter by it.

Now: pill radius = max(slider value, 200 mi). The floor protects "I want to see nearby corridors even at slider=25." The slider value as the ceiling protects "I'm planning a 500 mi leg, show me what's reachable."

### D-8. RV parks live in the `hotels` table

**Why:** They share 95% of the schema (name, phone, address, amenities, exit). Splitting them into a separate table would have meant duplicating most queries. A `type` column distinguishes them, and the homepage banner buttons filter on it.

The cost: the table name "hotels" is a mild misnomer. The benefit: one query path everywhere.

### D-9. Settings table for runtime toggles

**Why:** `show_unverified_to_drivers` needs to flip without a redeploy. Hardcoding it as a constant would mean a code change every time the verification queue moves. The settings table is a cheap key/value store; the homepage reads it on mount.

The flip side is "config in two places" — env vars for secrets, settings table for product toggles. Document new keys in `DATA_DICTIONARY.md`.

---

## Technical decisions

### T-1. Supabase, not a custom backend

**Why:** A solo operator can't maintain a custom Postgres + Auth + RLS stack. Supabase gives all three for free at the current scale. The downside is vendor lock-in (some Supabase patterns don't map cleanly to raw Postgres) — manageable, since the schema is portable and the Auth users could be re-created.

### T-2. Next.js 16 App Router + browser-side Supabase queries

**Why:** Almost every page is essentially a Supabase query + render. SSR'ing them adds latency without benefit (the data is the same for every visitor). The browser fetches directly using the anon key; RLS protects writes.

The exception: pages that need privileged operations (admin write paths) use the service role key in route handlers, never client-side.

### T-3. Mapbox Matrix API, not Google Maps

**Why:** Google Maps Distance Matrix is more accurate but vastly more expensive past free tier. Mapbox gives 50,000 Matrix requests/month free, which (with the >1mi throttle) covers thousands of users.

Fallback to haversine × 1.25 when Mapbox is unavailable means the product never breaks if the token expires — it just degrades to approximate distances.

### T-4. `watchPosition` for GPS, throttled state for Mapbox refetch

**Why:** "Pills appear as you approach a new corridor" requires live GPS, which means `watchPosition` (not `getCurrentPosition`). But every GPS tick triggers a state update, and the Mapbox refetch effect is keyed off lat/lng — so naively you'd burn through the Mapbox free tier in days.

Solution: two state variables. `userLoc` (live, used for in-memory math) and `stableUserLoc` (only updates when driver moves >1 mi, used for Mapbox refetch). The cheap stuff stays current; the expensive stuff is throttled.

### T-5. Two paged Supabase fetches instead of one

**Why:** PostgREST has a server-side hard cap of 1000 rows. With ~1,980 listings, a single query silently truncates the tail — and Supabase orders by insertion order by default, so the most recently added corridors disappear first.

Two `.range(0, 999)` and `.range(1000, 1999)` calls in `Promise.all`, merged in JS. Same speed as one fetch (parallel), no truncation. When inventory exceeds 2,000, add a third page or a smarter query.

### T-6. RLS as the trust boundary

**Why:** With browser-side Supabase queries, the anon key is in every page bundle. The only thing protecting the database is RLS. We tested this: with RLS off, an attacker could `UPDATE hotels SET phone='...'` from the browser console.

RLS policies are documented in `DATA_DICTIONARY.md`. If a future change loosens them, the entire trust model collapses.

**Correction (July 2026):** RLS was enabled on every table, but the write policies were `USING(true)`, so the attack described above was in fact possible the whole time — enabling RLS is not the same as scoping it. Superseded by D-14.

### T-7. No staging environment

**Why:** Solo operator. The cost of maintaining a separate staging Supabase + Vercel project is high, the benefit at current size is low. `git push main` deploys directly to production. Bad changes can be rolled back in Vercel UI in seconds.

This decision should be revisited if the platform onboards more than ~10 hoteliers — at that point, breaking production has real customer impact.

### T-8. Vercel Web Analytics, not Google Analytics

**Why:** Vercel Analytics is anonymous, requires no cookies, and is GDPR-compliant out of the box. Google Analytics requires consent banners and cookies — extra UX friction for a product that needs to be tap-and-go on a tired driver's phone.

The tradeoff is less detail (no cross-session user tracking), but for the current "is anyone using the site, what pages do they hit" question, Vercel Analytics is enough.

### T-9. The `hotels.exit_id` and `hotels.near_interstate_id` split

**Why:** Most listings are anchored to a specific exit (`exit_id`). A small minority — typically RV parks — sit a few miles off the highway and don't tie cleanly to one exit. For those, `near_interstate_id` lets us still associate them with a corridor without inventing a fake exit, with `distance_off_route_mi` capturing how far off.

The homepage handles both cases in the corridor join.

### T-10. Single-photo per listing (no gallery)

**Why:** Most listings come from external sources (Google Places, OSM) where one decent photo is available; multi-photo curation is hours per listing. Until verification is done, the marginal value of a gallery is low. Once hoteliers self-onboard and upload their own photos, this becomes a sensible upgrade.

### D-14. Admin is a Supabase Auth identity, not a shared password

**Why:** `/admin` used to bcrypt-check a password in the browser and then query Postgres as `anon`. Postgres therefore had no way to distinguish the owner from a visitor, which forced every admin write policy to `USING(true)`. The names said "Admin insert hotels"; the expressions granted it to everyone holding the public anon key.

Two options were considered:

1. **Service-role key behind Next.js API routes.** Correct, but required rewriting all 27 admin query sites and introduced a server-held secret.
2. **Make admin a real authenticated principal.** Sign in through Supabase Auth, check membership in a `site_admins` table via the `is_site_admin()` helper, then scope policies to it.

Option 2 won because every existing admin query keeps working untouched — the client is simply authenticated now — and no new secret enters the system. The trade-off is that admin rights are granted by SQL insert rather than a UI, which is acceptable for an operation performed once or twice in the product's life.

Consequence worth knowing: hoteliers and admin now share one auth system, so the `is_site_admin()` check on `/admin` is what separates them, not the login itself.

### D-15. Lodging discovery rejects short-term rentals by review count

**Why:** Google Places files every Airbnb and VRBO listing under type `lodging`. The first discovery run returned 350 results for I-87, of which 171 were private homes, spare rooms, and campsites. A driver at 11pm needs a front desk and a phone that answers, not a 3-night minimum on someone's guest room.

Review count is the discriminator: short-term rentals carry their reviews on the booking platform, not on the Google Place, so they arrive unrated or with a handful. A real hotel that has sat at an interchange for years always has dozens. The gate is a Google rating plus 25+ reviews, with a name blocklist for the gas stations, mobile-home parks, and campgrounds Google also files as lodging.

**Explicitly not filtered on star rating.** Low-rated highway motels stay in. A tired driver at 2am wants a bed, not a 4.5.

### D-16. No in-app voice or turn-by-turn guidance

**Why:** Considered spoken mile alerts ("10 miles to your exit"). Rejected on three counts:

1. The app cannot know which side of the highway the ramp is on — hotel coordinates don't imply ramp geometry, and guessing wrong at 70mph is worse than silence.
2. It cannot know which hotel the driver has chosen unless they say so, and most are still shopping.
3. Once the driver taps Go, iOS backgrounds the page and suspends its JavaScript. Maps is already announcing the exit — correctly, including the side of the road.

The only version with room to exist was a pre-decision heads-up ("Exit 45 ahead, 2 miles, four hotels"), which Maps cannot offer because it doesn't know the driver wants a bed. Shelved rather than built.

### D-17. `route_position` replaces `mile_marker` for ordering

**Why:** `exits.mile_marker` actually holds **exit numbers** on all 13 corridors — `exit_label` mirrors it exactly ("Exit 135" / 135.0). On most interstates exit number and milepost roughly coincide, so nothing broke. I-87 is the exception: it restarts numbering at Albany (Thruway 1–24, then Northway 1–44), so Harriman reads as 45 while Albany reads as 4 despite sitting 150 miles apart.

Anything doing ahead/behind math on that column silently dropped valid stops from long-range results. `route_position` is continuous miles from each corridor's south/west terminus, derived from lat/lng, and is now what the direction filter and sort read. `mile_marker` is retained as a fallback and is still what the driver sees on the card — relabelled "Exit 45" rather than the incorrect "MM 45".

---

## Decisions still pending

| Question | Status |
|---|---|
| Stripe vs. invoiced billing for hoteliers? | Open |
| Native mobile app (React Native? Expo? PWA?) | Open |
| Booking flow on-platform vs. always handing off | Open |
| Open the API for affiliate aggregator partners? | Open |
| West-coast corridor expansion (start with I-5) | Wired, not seeded |

These are all upside-value items a buyer could prioritize differently.
