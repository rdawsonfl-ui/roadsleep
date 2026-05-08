# For Buyers — Asset Overview

This document is for someone evaluating RoadSleep as an acquisition. It exists because the rest of this repo is written for developers and operators; a buyer needs the 30-minute version.

If you want depth on any topic here, the other docs in `/docs` go deeper.

---

## What you're buying

A working, deployed mobile web app at **roadsleep.com** with:

- **1,647 lodging listings** (1,335 hotels + 312 RV parks) across 13 active interstate corridors east of the Mississippi
- **606 mapped exits** with mile markers and lat/lng coordinates
- A **corridor-aware search system** that filters by interstate, direction of travel, and forward distance — distinct from any "hotels near me" competitor
- A complete **Next.js 16 + Supabase + Vercel** codebase with no proprietary infrastructure
- A working **hotelier-facing dashboard** for self-service listing management and call-tracking
- An **admin console** for inventory management
- All source code, all data, all documentation, all deployment configuration

---

## What's *not* in the box

Worth being explicit:

| Item | Status |
|---|---|
| Verified inventory | 0 of 1,647 listings have been independently verified. The site currently shows all listings via a `show_unverified_to_drivers = true` toggle. |
| Recurring revenue | $0/mo. Two hoteliers signed up; neither has been billed. |
| Mobile app | None. Mobile web only. |
| Booking flow | None. The product hands the driver a phone number; bookings happen off-platform. |
| Brand IP / trademarks | The "RoadSleep" name and the roadsleep.com domain are included; no registered trademark exists. |
| West-coast corridors | I-5 is wired in code; no exits or hotels are seeded. The other 49 western interstates are not built out. |
| Native payment processing | Hotelier billing fields exist in the schema; no Stripe or processor integration is live. |

---

## What makes it worth more than its data

A scraper could assemble 1,647 hotel rows in a weekend. The reason this asset is worth more than that:

**1. The corridor-direction-distance model.** This is the differentiated thinking. Most lodging apps are point-radius searches around a city. RoadSleep is a forward-looking filter aligned to a moving driver on a known route. Building this from scratch is a multi-week design + implementation lift; it's already done.

**2. Real geographic structure.** The 606 mapped exits with mile markers, lat/lng, and corridor associations are the durable asset. Even if every hotel listing was thrown out, the exit graph is the platform.

**3. The interstate-aware UX.** Auto-selecting the closest corridor, GPS-tracked pill row that updates as the driver moves, slider-tied filter radius — these are the kind of details that come from real user feedback, not a spec doc. They're embedded in the codebase and documented in `DECISION_LOG.md`.

**4. A clean, modern stack.** Next.js 16 + React 19 + Supabase + Tailwind 4. No legacy code, no dead frameworks, no proprietary platforms. A new owner can hire any frontend developer to maintain it.

**5. Documentation that actually exists.** Most assets at this size come with a README and good wishes. This one has architecture, data dictionary, runbook, and decision log. A buyer's tech evaluation should take an afternoon, not a week.

---

## Suggested due-diligence checklist

For a buyer's technical evaluator:

- [ ] Read `ARCHITECTURE.md` (15 min)
- [ ] Read `DATA_DICTIONARY.md` (15 min)
- [ ] Spot-check 10 listings — call the phone number, verify it rings the right place
- [ ] Open `/admin` with provided credentials, edit a test listing
- [ ] Check Vercel build logs — look for warnings or errors that have been ignored
- [ ] Check Supabase RLS policies match what `DATA_DICTIONARY.md` claims
- [ ] Run `npm run dev` locally, verify the homepage renders against your own GPS
- [ ] Look at the git log — are commits coherent and well-described, or vibe-coded chaos?
- [ ] Read the most-recent 20 commit messages — they tell you how the product is being built right now

For a buyer's commercial evaluator:

- [ ] How many hoteliers in your network would pay $X/mo for placement?
- [ ] What's the cost to verify (call + confirm) the existing 1,647 listings?
- [ ] What corridors do your customers care about that aren't covered yet?
- [ ] What's your organic traffic acquisition story? (The platform has none today.)
- [ ] What's the build-vs-buy comparison if you started from scratch with a CSV?

---

## Honest limitations a serious buyer should price in

**Single-developer codebase.** Almost all code (and all documentation) was written by one developer working with AI assistance. There is no team, no second pair of eyes, no code review history. A buyer who wants a mature engineering org around this needs to build that from scratch.

**Zero verified usage data.** 35 call-log rows. That's not a meaningful sample for valuing the platform's actual driver appeal. A 90-day pre-acquisition observation period would tell a buyer far more than the asset itself can today.

**Inventory data quality unknown.** Listings were sourced from Google Places and OpenStreetMap. Some percentage will have wrong phone numbers, closed businesses, or stale addresses. The verification queue is the work to find out which ones — and that work hasn't started.

**No defensible moat against a well-resourced clone.** The corridor-direction-distance model is differentiated but not patented. A funded competitor could replicate the UX in 2-3 months with a bigger data team. The defensible position is hoteliers under contract — and there are 2.

---

## What the next 90 days of work would look like

If a buyer wants to maximize valuation before sale (or if a buyer is themselves planning the next 90 days):

**Highest-leverage:**
1. Verify 200-300 listings, mostly in the highest-traffic corridors (I-75, I-95, I-10). Verification is mostly phone calls — outsourceable.
2. Onboard 10-20 paying hoteliers at $50-100/mo. Even at small numbers, this turns "no revenue" into "early revenue trajectory."
3. Add Stripe billing so hoteliers self-pay rather than being manually invoiced.

**Medium-leverage:**
4. Seed I-5 + 1-2 other west-coast corridors. Geographic completeness is a buyer signal.
5. Wire reviews or photos uploaded by hoteliers themselves.
6. Build a one-page "for hoteliers" marketing site to drive self-serve signups.

**Lower-leverage but visible:**
7. Native mobile app (PWA-first, then native if traction warrants).
8. Booking integration (likely an aggregator partner — Booking.com, Expedia API).

The first three items, done well, would meaningfully shift the asset from "early-stage prototype with inventory" to "operating platform with revenue trajectory" — which is the inflection point in valuation.

---

## Repository handover checklist

When the sale closes, the handover package is:

- [ ] GitHub repo transferred to buyer's account (or buyer's GitHub username added as owner)
- [ ] Vercel project ownership transferred (Settings → General → Transfer Ownership)
- [ ] Supabase project ownership transferred (Settings → General → Transfer Project)
- [ ] Mapbox account credentials handed over (or buyer creates new token, environment variable updated)
- [ ] Domain `roadsleep.com` transferred at registrar
- [ ] All environment variables documented with current values
- [ ] All third-party service credentials reset and handed off (or replaced by buyer)
- [ ] Final database backup provided to buyer
- [ ] One-hour walkthrough call with seller for context Q&A

---

## Contact

Owner: see repo settings.

For sale inquiries, due-diligence requests, or walkthrough scheduling, contact the owner directly. This document, the rest of `/docs`, and the codebase itself should answer ~80% of evaluation questions.
