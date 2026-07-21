# RoadSleep — Feature Guide

A plain-English walkthrough of everything the product does, written for someone
who has never seen the codebase. Each section names the files involved so a
developer can jump straight to the source.

There are three audiences using this product, and the app is organized around
them: **drivers** (free, no account), **hoteliers** (paid, self-service), and
**the operator** (admin console).

---

## 1. The driver experience

### 1.1 The core idea

Every other lodging app asks *"what city are you in?"* RoadSleep asks *"what
road are you on, and which way are you heading?"* Every listing in the database
is anchored to a specific exit, on a specific interstate, at a specific mile
marker. That single structural decision is what makes the rest of the product
possible.

**What that looks like to a driver.** It's 7:30 in the evening. You've been
behind the wheel since morning, you're tired, and you need to stop — but not
necessarily at the next exit, and not fifty miles further than you can stand.
You open RoadSleep and slide the distance control. The list redraws as you move
it: everything within ten miles ahead, then thirty, then sixty. You can see
where you are in relation to what's coming up, and pick a stopping point that
matches how much driving you have left in you.

No searching. No typing a city name you'd have to guess at. No scrolling a
travel site that wants to sell you a room three hundred miles away in a
destination you're not going to. The road already knows where you are — the app
just shows you what's in front of you and how far.

Files: `app/page.tsx` (the main driver screen), `app/search/page.tsx`,
`app/search/HighwayView.tsx`, `app/hotel/[id]/page.tsx`.

### 1.2 Corridor detection and the route picker

On load, the app requests GPS and pulls the list of active interstates from the
`interstates` table. It then works out which corridors the driver could
plausibly reach within their selected distance range — not just the road they're
sitting on. So a driver 40 miles from an I-75 interchange sees I-75 appear as an
option before they get there.

The driver can override the auto-detected corridor at any time; once they do,
an `interstateUserTouched` flag stops the auto-detection from overwriting their
choice.

### 1.3 Direction-of-travel inference

Knowing you're on I-95 isn't enough — northbound and southbound produce
completely different answers to "what's ahead of me." The app infers heading by
comparing consecutive GPS fixes:

1. `bearingDegrees()` computes a compass bearing between two fixes.
2. `bearingToDirection()` snaps that bearing to N/S/E/W based on whether the
   corridor runs north-south or east-west.

The snap-to-axis step matters because interstates curve. A driver heading 200°
(slightly west of due south) on a north-south corridor gets `S`, not `W`. This
keeps the filter correct on roads like I-95 through the Carolinas or I-87
through the Adirondacks.

The driver can override the inferred direction manually.

### 1.4 Forward-looking distance, not radius

A radius search is wrong for a moving vehicle — it returns places behind you.
The distance control is a forward-looking range: 10, 30, 60, 120 miles, or
"closest." Exits behind the driver's position, given their direction of travel,
are filtered out entirely.

### 1.5 Real driving distance

Straight-line distance understates road miles by roughly 20–25%. Two mechanisms
handle this:

- **Mapbox Matrix API** (`lib/mapbox.ts`) returns real driving miles and ETAs.
  It batches up to 24 destinations into a single request, which is what keeps
  usage inside the free tier. Requests are throttled so they only re-fire when
  the driver has moved more than a mile.
- **Haversine fallback** with a 1.25× circuity multiplier, used whenever the
  Mapbox token is missing or the call fails. Distances shown this way are
  labeled approximate so drivers aren't misled.

### 1.6 Live GPS refresh

`watchPosition` keeps the driver's location current roughly every 30 seconds
while the page is open. As they drive, the corridor list, the direction
inference, and the distance sort all update on their own. There is a separate
`stableUserLoc` value that only moves on meaningful position changes, used to
avoid re-querying and re-rendering on GPS jitter.

### 1.7 Hotels vs. RV parks

Listings carry a `type` of `hotel` or `rv_park`, driving a toggle on the driver
screen. Adding further categories (truck stops, rest areas) is an `ALTER` on the
database CHECK constraint plus a toggle label — the code doesn't hard-code the
two-category assumption anywhere structural.

### 1.8 Call and Directions

These are the two actions the product actually exists to produce.

**Call** fires a `tel:` handoff and writes a row to `call_logs` capturing the
hotel, the hotelier, the timestamp, the driver's distance at tap time, whether
the listing was boosted, and the marketing source for the session. This log is
the product's core proprietary data — first-party evidence of purchase intent
that no competitor has.

The write goes through the `log_call` SECURITY DEFINER RPC, not a direct insert.
The caller needs the new row's id back so the approach tracker can update it,
and PostgREST implements that as `INSERT ... RETURNING` — which requires a
SELECT policy. Anon has none on `call_logs`, because call logs are hotelier
business data. The RPC returns the id of the row the caller just created
without granting any read access to the table.

**De-duplication.** A single tap was observed producing two rows ~0.8s apart
(distances 9.25 and 9.24 on the same hotel), meaning the handler ran twice
across a re-render. Call count is the headline number shown to a hotelier, so
over-counting is the one failure this table can't have. Guarded in two places:
a 20-second in-memory guard per hotel on the client, and a 20-second lookback in
`log_call` that returns the existing row's id rather than inserting again. The
server-side guard is the one that matters — three separate pages write call
logs, and a client-only fix would leave two of them exposed.

**What the log does and doesn't prove.** It records the *tap*, not a connected
call. A driver who taps and hangs up before it rings still produces a row. The
honest phrasing for a hotelier is "12 drivers tapped to call you," not "12
completed calls."

**Directions** builds a Google Maps URL that launches voice-guided turn-by-turn
immediately rather than the preview-with-a-Start-button page. The parameters
that make this work (`dir_action=navigate`, `travelmode=driving`, and an
`origin` set to the driver's GPS) are documented inline in `app/page.tsx`. On
iOS this requires the Google Maps app; without it the browser opens the web
version, which works but without voice.

### 1.9 Boost rate codes

When a driver calls a boosted listing, the app generates a short human-readable
code in the format `RS-XXXX` (six characters, ambiguous glyphs like O/0 and I/1
excluded). The driver shows it at the front desk as visual proof they came
through RoadSleep and is owed the boost rate. It isn't cryptographic — collisions
don't matter, because the code's only job is to be legible to a desk clerk.

### 1.10 Arrival tracking and consent

After a boosted call, the app can sample GPS every 60 seconds for up to 90
minutes, recording the closest approach to the hotel and marking arrival when
the driver comes within a quarter mile. The purpose is hotelier-grade proof that
a boost produced a real body in a real bed.

Because this shares location data with a third party (the hotelier), it sits
behind a just-in-time consent modal (`lib/consent.ts`,
`components/ConsentModal.tsx`) with a plain-English explanation, asked once per
device and reversible from `/privacy`. Ordinary map-style geolocation is *not*
gated this way — the browser's own permission prompt covers it.

**Two caveats, and the second one was hidden for months.**

First, iOS Safari suspends background JavaScript within about 30 seconds, so the
90-minute tracker rarely completes in practice. The "arrived" indicator was
removed from the hotelier dashboard for that reason.

Second — and this was the larger problem — `call_logs` had no UPDATE policy, and
Postgres enforces SELECT policies on any UPDATE carrying a WHERE clause. Anon
cannot read `call_logs` by design, so every tracking write matched zero rows and
was discarded silently from the day the feature shipped. PostgREST reports an
RLS-blocked update as success, and the client discarded the result, so nothing
ever surfaced. Fixed in July 2026 by routing tracking through the
`record_call_progress` SECURITY DEFINER RPC, which also refuses to touch a call
log older than three hours so old ids can't be replayed to fabricate arrivals.

Expect arrivals to start recording now, but expect the capture rate to stay low
because of the iOS limitation. Treat it as supporting colour, never as the
headline metric. The `arrived_at` column also feeds the planned SMS check-in
replacement. See `TODO.md`.

### 1.11 Campaign source attribution

Offline media needs a clean address. A billboard reading `roadsleep.com/i75` is
usable; `roadsleep.com/?src=i75` is not.

`middleware.ts` treats any bare single-segment path as a source tag and
redirects it to the homepage with `?src=` set. A `RESERVED` set protects real
routes — **when you add a new top-level route, you must add its first path
segment to `RESERVED`, or visitors to it get bounced to the homepage.**

From there, `lib/analytics.ts` captures the tag, stores it in sessionStorage,
logs a single `campaign_visits` row per source per session (so refreshes don't
inflate counts), and stamps the same tag onto any `call_logs` row the driver
generates. The result is a real per-channel funnel — source → visits → calls —
so a billboard, a fuel-desk QR code, and a forum post can be compared on
cost-per-call rather than guessed at.

---

## 2. The hotelier experience

Files: `app/hotelier/page.tsx` (signup, login, listing management, boosts),
`app/dashboard/page.tsx` (call analytics), `app/hotelier/reset-password/page.tsx`.

### 2.1 Accounts

Hoteliers get real accounts on Supabase Auth — email/password, email
confirmation, forgot-password, and an in-dashboard change-password modal. This
is genuine authentication, unlike the admin gate described below.

A `hoteliers` row is linked to the auth user by `auth_user_id`. There's a
reconciliation path (`resolveHotelierForAuthUser`) that matches on email and
backfills `auth_user_id` — this exists because some hotelier records were
created by the operator before the owner ever signed up, and the two have to be
stitched together on first login.

### 2.2 Listing management

A logged-in hotelier can create and edit their own listings: name, phone,
address, price range, amenities, photo, and which exit they sit at. The exit
picker renders the full corridor context in one line — interstate, direction,
mile marker, city, state — so the hotelier can find their own exit without
knowing internal IDs.

### 2.3 Boosts

The revenue mechanism. A hotelier facing empty rooms at 4pm can put a discount
in front of drivers who are, right now, on the road heading their way.

- They set a discount price and a duration of 1, 2, or 3 hours.
- The listing is promoted on the driver screen for that window with a live
  countdown.
- Boosts are limited to one per listing per day, enforced via `last_boost_date`
  evaluated in Eastern time.
- They can end a boost early; the daily lockout still applies afterward.
- Expiry is also enforced server-side by the `expire_finished_boosts` RPC, which
  the driver page calls on load — so a boost still ends correctly even if no
  hotelier session is open to clean it up.

### 2.4 Call analytics

The hotelier dashboard shows call counts per listing over time, a daily
breakdown, boost-attributed versus organic split (`call_logs.from_boost`), and
estimated revenue using a per-hotel `est_revenue_per_call` figure. Each listing
card also carries a recent-calls mini-log.

### 2.5 Billing fields

The `hoteliers` table carries `billing_type` (per-call or otherwise), `rate`,
and `billing_status`. These are set and adjusted by the operator in the admin
console. **No payment processor is wired up** — the fields describe what a
hotelier owes, but collection happens off-platform. Adding Stripe is a
self-contained piece of work against fields that already exist.

---

## 3. The admin console

File: `app/admin/page.tsx`, gated by `app/admin/AdminGate.tsx`. Five tabs.

### 3.1 The gate

Email and password through Supabase Auth, followed by an `is_site_admin()`
check against the `site_admins` table. A hotelier who signs in and navigates to
`/admin` is signed straight back out — authenticated is not the same as admin.
Session state comes from Supabase, not a `localStorage` flag.

Granting admin is a single insert into `site_admins`; revoking is the matching
delete. There is deliberately no UI for it — see `RUNBOOK.md`.

**Why it changed (July 2026).** The gate used to be one shared password checked
in the browser, after which the client still talked to Postgres as `anon`.
Postgres therefore had no way to tell the owner from a visitor, which forced
every admin write policy to `USING(true)`. The policies were named "Admin insert
hotels"; the expressions granted it to anyone holding the public anon key. See
`DECISION_LOG.md` D-14.

### 3.2 Hotels tab

The main inventory workspace, and where the verification calling actually
happens:

- Create, edit, and delete listings; duplicate an existing listing as a
  template for a neighboring property.
- Toggle `featured`.
- Mark a listing verified, with a timestamp and free-text verification notes.
- Set a priority triage flag (high/medium/low) captured during the call.
- Free-form admin notes per listing.
- Filter by category (hotel / RV park).
- A global `show_unverified_to_drivers` setting, stored in `settings`, controls
  whether unverified inventory is live to drivers. This is the single most
  consequential switch in the product — it trades catalog breadth against
  listing accuracy.

Sort order is by interstate number (parsed from the label), then state, then mile
marker ascending — so I-4 comes before I-10 and the list reads like driving the
corridor. Labels containing no digits sort to the end alphabetically.

### 3.3 Hidden tab

Listings hidden from drivers, with individual and bulk reinstate. Bulk
operations are chunked in batches of 200 to stay inside request limits. Hiding
is a soft state (`hidden` boolean) — nothing is destroyed, so an automated sweep
that hides too aggressively is fully reversible.

### 3.4 Interstates tab

Manage corridors and their exits: add an interstate, toggle it active, add exits
with direction, label, mile marker, city and state, delete exits.

Deactivating an interstate removes it from the driver picker without touching
any of its data — the way to retire a corridor without losing the inventory
underneath it.

### 3.5 Hoteliers tab

The customer list. Per hotelier: adjust billing type, rate, and billing status;
delete. This is where the commercial relationship is administered.

### 3.6 Campaigns tab

Aggregates `campaign_visits` and `call_logs` by source into a per-channel table
of visits and calls. This is the read-out for the attribution system described
in 1.11.

### 3.7 Contact email

The public contact address shown in the site footer is stored in `settings`
under `contact_email` and rotated through the `change_contact_email` RPC, gated
on the admin password. Changing the site's public contact does not require a
deploy.

---

## 4. Cross-cutting

### 4.1 Data model shape

Three joined tables carry location:

- `interstates` — corridor name (`I-75`) and active flag
- `exits` — mile marker, direction, label, city, state, and parent interstate
- `hotels` — the listing itself, pointing at an exit

**Always join all three when querying location, and treat `exits.state` as the
authoritative state field.** Some hotel rows have a null `hotels.state` and
derive location purely from the linked exit — filtering on `hotels.state`
silently drops them.

Supporting tables: `hoteliers`, `call_logs`, `campaign_visits`, `settings`,
`google_check`.

### 4.2 Security posture

RLS is enabled *and scoped* on every table. Drivers (anon) read `hotels`,
`exits` and `interstates` and can write call logs through an RPC; they cannot
read hotelier records, call logs, or campaign data. Hoteliers see only rows tied
to their own `auth.uid()`. Writes require admin or ownership. Admin is an
identity in `site_admins`, checked by `is_site_admin()`.

Operations that need to cross a policy boundary go through SECURITY DEFINER
RPCs rather than loosened policies: `log_call`, `record_call_progress`,
`link_my_hotelier_record`, `expire_finished_boosts`, contact email change.

**Prior state, disclosed.** Until July 2026 the write policies on `hotels` and
`hoteliers` were `USING(true)` with no role restriction, and `hoteliers`,
`call_logs` and `campaign_visits` were world-readable. Anyone with the public
anon key could have read every hotelier account or repointed any listing's phone
number. Verified closed by querying as the `anon` role. Note the lesson: RLS
being *enabled* is not the same as RLS being *scoped*, and an earlier version of
this document described the intended model rather than the deployed one.

Remaining item: Supabase credentials are hard-coded as fallbacks in
`lib/supabase.ts` so the app builds without env vars. The anon key is designed
to be public and is now genuinely protected by RLS, so that fallback is
defensible — but the service role key must only ever come from an environment
variable.

### 4.3 Progressive web app

`app/PWAInit.tsx` and the manifest in `public/` let drivers install RoadSleep to
their home screen. No app-store presence, no native build.

### 4.4 Legal pages

`/privacy` and `/terms` exist and are linked from the footer. `/privacy` also
carries the reset control for the arrival-tracking consent choice.
