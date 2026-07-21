# Runbook

Operational tasks, in plain language. The intended reader is whoever takes over running RoadSleep — they may or may not be a developer.

If you're a developer looking for "how is this built," go to `ARCHITECTURE.md` instead.

---

## Quick reference: where to do what

| I want to... | Go to |
|---|---|
| Add or remove an interstate corridor | Supabase SQL editor (`interstates` table) + `app/page.tsx` |
| Add or edit a hotel/RV park | `/admin` page on the live site |
| See call activity | Supabase SQL editor (`call_logs` table), or hotelier `/dashboard` |
| Onboard a hotelier | They sign up at `/hotelier`; you claim listings to them in `/admin` |
| Verify a listing | `/admin` (toggle the verified flag) |
| Push a code change | `git push origin main` → Vercel auto-deploys |
| See an error in production | Vercel dashboard → Deployments → Runtime Logs |
| Check the database directly | Supabase dashboard → SQL Editor |

---

## Discovering hotels for exits that have none

**Costs money.** Roughly $0.032 per Nearby Search call and $0.003 per Place
Details call, billed to the Google Places account. A 75-exit run cost about
$4.20 all in. Always price the batch before running it.

Find the gaps first:

```sql
select i.name, count(*) filter (where h.id is null) as exits_with_no_hotels
from exits e
join interstates i on i.id = e.interstate_id
left join lateral (
  select 1 as id from hotels h2
  where h2.exit_id = e.id and coalesce(h2.type,'hotel') = 'hotel' limit 1
) h on true
where e.lat is not null
group by i.name order by 2 desc;
```

Then queue, fire, collect. **Fire and collect are separate calls on purpose** —
`pg_net` is asynchronous, so collecting immediately after firing returns zero.
Wait 20–30 seconds.

```sql
select enqueue_lodging_discovery('I-75', 40);  -- corridor, max exits
select fire_lodging_discovery(40);             -- sends the HTTP requests
-- wait ~30s
select collect_lodging_discovery();            -- parses results into hotels
```

Everything inserts with `hidden = true` and `enrichment_status = 'discovered'`.
Nothing reaches drivers until you publish it. The collector already rejects
short-term rentals, gas stations, mobile-home parks, and anything more than 15
miles from the exit — see `DECISION_LOG.md` D-15.

New rows have no phone number, because Nearby Search doesn't return one and a
listing without a phone is useless here. Fetch phones via Place Details:

```sql
insert into phone_refresh_queue(hotel_id, place_id, old_phone)
select h.id, h.google_place_id, h.phone
from hotels h
left join phone_refresh_queue q on q.hotel_id = h.id
where h.enrichment_status = 'discovered'
  and h.google_place_id is not null and h.phone is null and q.hotel_id is null;

select fire_phone_refresh(600);
-- wait ~40s
select collect_phone_refresh();

update hotels h set phone = q.google_phone
from phone_refresh_queue q
where q.hotel_id = h.id and q.google_phone is not null
  and h.phone is null and h.enrichment_status = 'discovered';
```

Review what landed, then publish:

```sql
update hotels
set hidden = false, enrichment_status = 'published'
where enrichment_status = 'discovered' and phone is not null;
```

---

## Granting or revoking admin access

```sql
-- grant
insert into public.site_admins (user_id, email)
select id, email from auth.users where email = 'someone@example.com';

-- revoke
delete from public.site_admins where email = 'someone@example.com';
```

The account must already exist in Supabase Auth. Verify the new admin can load
`/admin` **before** revoking anyone — there is no recovery UI, and removing the
last row locks everybody out of the admin console permanently.

---

## Adding a new interstate corridor

This has been done several times. Roughly 30 minutes of admin work + 2-4 hours of data sourcing.

**Step 1 — Add the row.**

In Supabase SQL editor:

```sql
INSERT INTO interstates (name, is_active) VALUES ('I-XX', true);
```

The pill won't appear yet because the homepage needs the orientation map updated.

**Step 2 — Update the orientation map.**

Edit `app/page.tsx`. Find `INTERSTATE_AXIS` (near the top of the component) and add a new entry:

```ts
'I-XX': 'NS',  // or 'EW'
```

Use `NS` for north-south corridors (I-5, I-65, I-75, I-81, I-85, I-87, I-95) or `EW` for east-west (I-4, I-10, I-20, I-30, I-40, I-70, I-80). If you skip this, the direction pills will fall through to the wrong default and show E/W on a north-south road.

**Step 3 — Seed exits and hotels.**

There is no script for this. The pattern used for prior corridors:

1. Pick a sensible exit count for the corridor length (usually one exit every 30-60 mi at major metros).
2. For each exit, populate `mile_marker`, `city`, `state`, `lat`, `lng`. Pull data from Wikipedia interstate-exit lists or DOT exit guides.
3. For each exit, find 5-15 hotels nearby. Sources: Google Places API, OpenStreetMap, hotel chain websites.
4. Insert in batches via Supabase SQL editor. **Do not exceed 1000-row inserts** — break into multiple statements.

**Step 4 — Verify.**

Open the live site. The new corridor's pill should appear in the route picker (within range, per GPS) and tapping it should show the seeded hotels with correct mile markers.

---

## Adding or editing a hotel manually

Use `/admin` on the live site. It's password-gated by `AdminGate.tsx`. The password is the value of the `NEXT_PUBLIC_ADMIN_PASSWORD` env var (or whatever the current build is using — check Vercel env settings).

The admin page lists every hotel. You can filter by name (Ctrl+F works in-browser), edit any field, set `verified` to true/false, and apply boost windows.

For bulk edits (more than ~20 rows at a time), do it in Supabase SQL editor instead.

---

## Onboarding a hotelier

1. Hotelier signs up at `/hotelier`. This creates an `auth.users` row + a matching `hoteliers` row.
2. You go to `/admin`, find their listing(s), and set `hotelier_id` to their `hoteliers.id`. This "claims" the listing for them.
3. They log in at `/hotelier` and see their dashboard at `/dashboard` showing call activity for their claimed listings.

There is no automated onboarding flow. Step 2 is manual.

---

## Verifying a listing

1. Spot-check the listing — call the phone number, confirm address against Google Maps, verify amenities.
2. In `/admin` (or directly in Supabase), set:
   - `verified = true`
   - `last_verified_at = now()`
   - `verification_notes = 'Phone confirmed YYYY-MM-DD; amenities updated.'`
3. The listing now passes the verified filter (when `settings.show_unverified_to_drivers` is `'false'`).

**Current state:** 1,405 of 1,980 listings are verified; 297 are hidden from drivers. The site bypasses the filter via the settings toggle. If you want to enforce verification before launch, work through the verification queue first, then flip the setting.

---

## Toggling driver-visibility of unverified listings

```sql
UPDATE settings
SET value = 'false', updated_at = now()
WHERE key = 'show_unverified_to_drivers';
```

Effect: the homepage will only show listings where `verified = true`. With current data (0 verified), this would show drivers an empty site. Don't flip it without verifying inventory first.

---

## Deploying a code change

```bash
git add .
git commit -m "your message"
git push origin main
```

Vercel webhook picks it up within seconds. Build takes 1-3 minutes. Production updates automatically — there is no staging.

If a deploy fails, check Vercel dashboard → Deployments → click the failed deploy → read the build log.

If a deploy gets stuck in `QUEUED` (rare, happens during platform incidents), pushing an empty commit to nudge can sometimes help: `git commit --allow-empty -m "kick" && git push`.

---

## Rolling back a bad deploy

In Vercel dashboard → Deployments → find a known-good prior deploy → click `⋯` → `Promote to Production`. Takes ~5 seconds, no rebuild.

---

## Backing up the database

Supabase auto-backs up daily on paid tiers. To grab a manual snapshot:

```bash
# Requires Supabase CLI
supabase db dump --project-ref ipfztqjxcaahwdpatkbn -f backup.sql
```

Or use the dashboard: Settings → Database → Backups → Download.

Recommend a manual backup before:
- Bulk inserts (new corridor seed)
- Schema changes
- Anything involving `DELETE` without a `WHERE` clause

---

## Where the secrets live

All in Vercel project settings → Environment Variables:

| Key | What it is | Where to find a fresh value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Supabase dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase key | Same place |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key | Same place — **never expose this in client code** |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox API key | Mapbox dashboard → Access tokens |
| `NEXT_PUBLIC_ADMIN_PASSWORD` | `/admin` page gate | Set when first deployed; rotate by editing here |

For local dev, copy these into `.env.local`. The file is `.gitignore`d.

---

## Common debugging recipes

### "A hotel I added isn't showing up on the homepage"

1. Is its `name` non-empty? (The homepage filters out empty/null names.)
2. Is its `type` set to `'hotel'` or `'rv_park'`? (Defaults to `'hotel'`.)
3. Does its exit have lat/lng populated? Listings without coords can't be filtered by GPS distance.
4. Is the homepage hitting the 1000-row cap? Currently we paginate to 2000 — past that, the most recently inserted rows are silently dropped. Run `SELECT count(*) FROM hotels WHERE type='hotel'` to check.

### "The route picker doesn't show I-XX"

The pill row is GPS-filtered. It only shows corridors within the slider's distance value (with a 200 mi floor) of the driver. From a Florida laptop, you won't see I-80. Push the slider to "Anywhere" or click "Show all interstates" to verify.

If a corridor never appears even at "Show all," check:
- Is `interstates.is_active = true`?
- Are there hotels seeded on it? (The pill filter requires at least one listing on the corridor.)

### "Direction pills are wrong (E/W on a north-south road)"

The interstate is missing from `INTERSTATE_AXIS` in `app/page.tsx`. Add an `'NS'` entry and redeploy.

### "Mapbox is returning weird distances"

`lib/mapbox.ts` calls the Matrix API. If the token is missing or the API is down, we silently fall back to haversine × 1.25. Check the browser console for `Mapbox Matrix error` and verify `NEXT_PUBLIC_MAPBOX_TOKEN` is set in Vercel.

---

## Things never to do

- **Don't disable RLS** on any table. The app trusts RLS for write protection.
- **Don't write a policy as `USING(true)`** on any table that isn't meant to be world-writable. Enabling RLS is not the same as scoping it — this exact mistake left `hotels` and `hoteliers` open to the public anon key until July 2026.
- **Don't delete the last row of `site_admins`.** It is the only thing granting admin, and nothing in the UI can restore it.
- **Don't run a paid Places batch without pricing it first.** Nearby Search and Place Details are billed per call.
- **Don't expose `SUPABASE_SERVICE_ROLE_KEY`** in any `NEXT_PUBLIC_*` env var, client-side import, or commit. It bypasses RLS entirely.
- **Don't `DELETE FROM interstates`** without a `WHERE`. The `on delete cascade` will wipe every exit and hotel.
- **Don't bulk-insert without `ON CONFLICT` handling** if there's any chance of re-running the same script. Especially for `interstates.name` (unique).
- **Don't deploy from a branch** assuming it's a draft. Vercel only auto-deploys `main`, but if you merge accidentally, it goes live instantly.

---

## Who to ask

- Codebase questions → see `ARCHITECTURE.md` and `DECISION_LOG.md`. The code is heavily commented.
- Schema questions → `DATA_DICTIONARY.md`.
- "Why did we do it this way?" → `DECISION_LOG.md`.
- Anything else → owner.
