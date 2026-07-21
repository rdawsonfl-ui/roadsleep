# Architecture

This document describes how RoadSleep is built — what runs where, how data moves, and the small set of design decisions you need to understand before changing anything.

It is intentionally short. The full reasoning behind each decision lives in `DECISION_LOG.md`.

---

## 1. Topology

```
┌─────────────────────┐         ┌──────────────────────┐
│  Driver's phone     │         │  Hotelier laptop     │
│  (mobile browser)   │         │  (web browser)       │
└──────────┬──────────┘         └──────────┬───────────┘
           │                               │
           │   https                       │  https
           ▼                               ▼
   ┌───────────────────────────────────────────────┐
   │              Vercel (CDN + edge)              │
   │     Next.js 16 SSR + static pages             │
   │     Auto-deploy on push to main               │
   └────────┬─────────────────────────┬────────────┘
            │                         │
            ▼                         ▼
   ┌──────────────────┐      ┌────────────────────┐
   │   Supabase       │      │  Mapbox Matrix API │
   │   - Postgres     │      │  - driving miles   │
   │   - Auth         │      │  - free 50K/mo     │
   │   - RLS          │      └────────────────────┘
   │   - Storage*     │       (*not in current use)
   └──────────────────┘
```

There is no separate backend service. Browser → Vercel-hosted Next.js → Supabase / Mapbox. That's the whole stack.

---

## 2. Data model (one paragraph)

Everything hangs off `interstates`. Each interstate has many `exits` (with mile_marker, direction, lat/lng). Each exit has many `hotels` (which also includes RV parks, distinguished by `type`). Hoteliers register accounts in `hoteliers` and can claim ownership of one or more hotel rows. When a driver taps the "Call" button, we write a row to `call_logs` for analytics and (eventually) billing. A small `settings` key/value table holds operational toggles.

Full column-by-column reference: see `DATA_DICTIONARY.md`.

---

## 3. The four pages a driver sees

```
/                Homepage. Picks corridor + direction + distance.
/search          Results page (currently a thin wrapper around the home filter).
/hotel/[id]      Detail page for one listing.
                 Shows phone, address, amenities, hours, photos.
                 The "Call" button writes a call_logs row before dialing.
```

There is also `/hotelier`, `/admin`, and `/dashboard` for the operator side. See section 6.

---

## 4. The homepage filter pipeline (the heart of the product)

Most of the interesting code is in `app/page.tsx`. It runs entirely in the browser after a single Supabase fetch on mount. The filter pipeline:

```
   raw hotels[] from Supabase
        │
        ▼
   1. attach distance      ──┐ uses Mapbox driving miles when available,
                             │ falls back to haversine × 1.25
                             │
        ▼                    │
   2. category filter        │ hotel vs rv_park (banner buttons)
        │                    │
        ▼                    │
   3. corridor filter        │ only show listings on selectedInterstate
        │                    │
        ▼                    │
   4. direction filter       │ ahead-of-driver only (NB/SB or EB/WB)
        │                    │
        ▼                    │
   5. distance cap           │ from the slider — hotels beyond drop off
        │                    │
        ▼                    │
   6. sort                   │ "near slider value first" if engaged,
                             │ otherwise plain closest-first
                             │
        ▼                    │
   visible hotels            │
                             │
   In parallel, the same     │
   raw hotels[] feeds:       │
                             │
   - Pill row (distinct      │ filtered to corridors with any listing
     interstate names)       │ within max(slider, 200 mi)
                             │
   - Auto-select effect      │ picks the corridor of the closest
     (fires once per         │ listing on first GPS resolve
     session)                │
```

Every step is pure JS over the in-memory hotel list. No round-trips after the initial fetch.

---

## 5. GPS handling

Two states on the homepage:

- **`userLoc`** — live, updated on every `watchPosition` callback (~30s in motion). Drives the corridor pill filter, direction filter, and on-screen distance display.
- **`stableUserLoc`** — throttled copy. Only updates when the driver has moved more than 1 mi from the last anchor. Drives the Mapbox Matrix refetch.

Why two? Mapbox's free tier is 50,000 requests/month. Refetching on every `userLoc` tick at highway speed would burn it in days. The split lets the cheap stuff (in-memory math) stay live while the expensive call (Matrix API) is throttled.

---

## 6. Operator-side surfaces

| Route | Audience | What it does |
|---|---|---|
| `/admin` | Owner only | Edit any hotel/exit/interstate. Gated by `AdminGate.tsx`, which hides everything until a password is entered. |
| `/hotelier` | Hoteliers | Login + signup. Backed by Supabase Auth, linked to `hoteliers.auth_user_id`. |
| `/dashboard` | Hoteliers | Their own hotels' call_logs, billing status, boost controls. |

Admin and hotelier surfaces share the same hotels table. A hotelier can only see/edit rows where `hotelier_id` matches their authenticated user — enforced both in the UI and via Supabase RLS policies.

---

## 7. Why Supabase RLS matters here

Almost every page reads from Supabase directly using the **anon key** (publicly visible in the browser bundle). That's safe **only because** RLS is on and correctly scoped.

Current policy set (rewritten July 2026 — see D-14 in `DECISION_LOG.md`):

| Table | anon (driver) | authenticated hotelier | site admin |
|---|---|---|---|
| `interstates`, `exits` | select | select | full |
| `hotels` | select | select; insert/update own (`hotelier_id = current_hotelier_id()`) | full |
| `hoteliers` | none | own row only (`auth_user_id = auth.uid()`) | full |
| `call_logs` | insert only | select for own hotels | full |
| `campaign_visits` | insert only | none | select |
| `google_check` | none | none | select |
| `settings` | select of two whitelisted keys | same | via RPC |

Admin is identified by the `site_admins` table and the `is_site_admin()` SECURITY DEFINER helper, which checks `auth.uid()`. Admin is no longer a client-side password — see section 7a.

If you ever loosen these policies, the entire trust model collapses. Don't.

The **service role key** (server-only, never sent to browser) bypasses RLS entirely. Never expose it.

### 7a. Admin authentication

`/admin` authenticates through Supabase Auth, then calls `is_site_admin()`. A hotelier who signs in and navigates to `/admin` is signed back out.

Granting admin to another account is one insert:

```sql
insert into public.site_admins (user_id, email)
select id, email from auth.users where email = 'someone@example.com';
```

Revoking is the matching delete. There is no UI for this deliberately — it's a rare, high-consequence operation.

**Historical note:** until July 2026 `/admin` used a bcrypt password checked in the browser, and the client then talked to Postgres as `anon`. That forced every admin write policy to be `USING(true)`, which meant anyone holding the public anon key had owner-level write access to `hotels`, `hoteliers`, and read access to all `call_logs`. The policy names said "Admin insert hotels"; the expressions did not. If you are reading a copy of this document dated before July 2026, it described the intended model rather than the deployed one.

---

## 8. Why the hotel fetch is paged

Supabase PostgREST has a server-side hard cap of 1000 rows per response, even when the client asks for more. With ~1,980 listings, a single `.limit(2000)` silently returns only 1,000 — and the truncated tail is whichever rows were inserted most recently (the newest corridors).

Both the homepage and admin work around this by issuing **two parallel `.range()` calls** of 1000 rows each and merging in JS. When inventory crosses ~2000 per category, we'll need a third page or a smarter query strategy (e.g. group by corridor server-side).

This is the single most common gotcha in the codebase. If you ever see "I-XX hotels are missing," check the row count first.

---

## 9. Deploy pipeline

```
local commit → git push main → GitHub webhook → Vercel build → Vercel CDN
```

Vercel reads from the repo's `vercel.json` (currently minimal — just a Next.js build). Environment variables live in the Vercel project settings, not in the repo. There is **no staging environment** — `main` is production. Branches don't auto-deploy. If you want a preview, push to a branch and open a PR; Vercel will create a preview URL.

---

## 10. What's intentionally not here

- **No mobile app.** The product is a mobile web app. Adding native iOS/Android is on the roadmap but not started.
- **No payment system yet.** `hoteliers.billing_type` and `rate` columns exist; the mechanism (Stripe? per-call invoicing?) doesn't.
- **No search beyond corridor.** No "search by hotel name" — the corridor + direction model is the search.
- **No reviews, no booking.** The product hands the driver a phone number to call, and tracks the tap. Bookings happen off-platform.

These are deliberate scope decisions. Each one is a value-add a buyer could build to grow the platform.
