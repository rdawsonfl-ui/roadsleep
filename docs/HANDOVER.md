# RoadSleep — Handover

Everything a new owner or operator needs to take control of RoadSleep and keep
it running. Read `docs/FEATURES.md` first for what the product does; this
document covers what you own, how to access it, how to operate it, and what to
watch out for.

---

## 1. Assets being transferred

| Asset | Where it lives | Transfer method |
|---|---|---|
| Source code | GitHub repo `rdawsonfl-ui/roadsleep` | Repo transfer to buyer's GitHub account |
| Hosting | Vercel project `roadsleep` | Project transfer, or redeploy from the transferred repo |
| Database, auth, storage | Supabase project `ipfztqjxcaahwdpatkbn` | Project ownership transfer within Supabase |
| Domain | `roadsleep.com` | Registrar transfer (auth code + unlock) |
| Driving distances | Mapbox account (Matrix API token) | Buyer should create their own token rather than inherit the account |
| Analytics | Vercel Web Analytics | Rides along with the Vercel project |
| Documentation | `README.md` and `/docs` in the repo | Included in the repo transfer |

There is no other infrastructure. No custom backend service, no message queue,
no cron host, no third-party SaaS beyond the above. Everything is a Next.js
route or a direct Supabase query from the client.

---

## 2. Access and credentials checklist

Work through this in order on handover day. Nothing here should be skipped —
several of these credentials are the only thing standing between the new owner
and a locked-out asset.

1. **GitHub** — accept the repo transfer; confirm `main` is the deploy branch.
2. **Vercel** — accept the project transfer; confirm the production domain is
   attached and the build succeeds from the new owner's account.
3. **Supabase** — accept the project transfer; confirm the new owner has Owner
   role on the organization, not just member access.
4. **Rotate the Supabase service role key.** The old key must be considered
   compromised the moment ownership changes. Rotate in the Supabase dashboard,
   then update the Vercel environment variable and redeploy.
5. **Rotate the admin password.** Log into `/admin`, use the Change Password
   control. It writes a new bcrypt hash via the `change_admin_password` RPC.
6. **Change the public contact email.** Admin console → Change Contact Email.
   This drives what's shown in the site footer; leaving the seller's address
   there means customer email goes to the wrong person.
7. **Issue a fresh Mapbox token** on the buyer's own Mapbox account and replace
   `NEXT_PUBLIC_MAPBOX_TOKEN` in Vercel. Do not inherit the seller's token.
8. **Domain** — complete the registrar transfer, then verify DNS still points at
   Vercel and the certificate renews.
9. **Take a database backup** before doing any of the above, and again after.
10. **Reset any hotelier-facing email sender configuration** so password-reset
    and confirmation emails come from the new owner's domain.

---

## 3. Environment variables

Set in Vercel → project → Settings → Environment Variables.

| Variable | Purpose | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project endpoint | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side database access | Public by design; protected by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server-side access | **Secret. Never expose client-side. Rotate on handover.** |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Driving distances and ETAs | Optional — app falls back to estimated distances if absent |

`lib/supabase.ts` hard-codes the Supabase URL and anon key as fallbacks so the
app builds even without env vars configured. The service role key falls back to
the anon key, which means privileged operations silently degrade rather than
crash if it's missing. **A new owner should set all variables explicitly and
consider removing the hard-coded fallbacks.**

---

## 4. Deploying

Vercel auto-deploys from `main`. The normal workflow is:

```bash
git add .
git commit -m "your message"
git push origin main
```

Vercel builds and promotes automatically. `deploy.sh` and `DEPLOY.md` document a
manual CLI path (`vercel deploy --prod`) as a fallback if the Git integration
breaks.

**Front-end changes are low risk.** Push freely; a bad deploy is one rollback
away in the Vercel dashboard.

**Database changes are the risk surface.** The rules that keep this product
stable:

- Additive only. Add columns and tables; never drop or rename anything the live
  app reads.
- Never tighten an RLS policy the current front-end depends on. A prior
  migration that dropped anonymous read policies took the driver-facing pages
  offline. Do not repeat that.
- Test structural migrations on a Supabase preview branch before running them
  against production.
- Migrations live in `/migrations` as plain SQL, run manually through the
  Supabase SQL editor. There is no automated migration runner.

---

## 5. Routine operations

### Adding inventory

Interstates → exits → hotels, in that order. Every hotel must attach to an exit,
and every exit to an interstate, so the parents have to exist first. This is
done through the admin console, or in bulk via SQL for larger imports.

### Verification calling

The operational core of the business. The admin Hotels tab is built as a calling
workspace: work down the list, phone each property, confirm it's open and that
the phone number reaches the front desk, then mark it verified with notes and a
priority flag. Listings that turn out to be closed get hidden, not deleted.

### The unverified toggle

`show_unverified_to_drivers` in the `settings` table, switchable from the admin
console, decides whether unverified listings are visible to drivers. It's the
single biggest lever in the product: on, the catalog looks full but some
listings will be wrong; off, everything shown is confirmed but the map thins
out. Know which side of that trade you're on and set it deliberately.

### Onboarding a hotelier

They sign up themselves at `/hotelier`. If a listing for their property already
exists in the database, the account-linking path matches on email and stitches
the records together. The operator then sets billing type, rate, and status in
the admin Hoteliers tab.

### Billing

There is no payment processor. Boost usage and call volume are visible in the
dashboards; invoicing and collection happen off-platform. Wiring Stripe against
the existing `billing_type` / `rate` / `billing_status` fields is the single
highest-leverage piece of unbuilt work.

### Running a campaign

Pick a short tag, put `roadsleep.com/yourtag` on the media, and the middleware
handles the rest. Results appear in the admin Campaigns tab as visits and calls
per source. **If you add a new top-level route to the app, add its first path
segment to the `RESERVED` set in `middleware.ts`** — otherwise visitors to that
route get redirected to the homepage and treated as a campaign tag.

---

## 6. Known issues and gotchas

Listed plainly, because a new owner will hit these within the first week.

**Admin sort order.** Previously listings sorted by interstate label as a
string, putting I-10 ahead of I-4. Now sorted numerically in the admin hotels
list, the admin interstates list, and the driver corridor picker. Labels with no
digits sort to the end alphabetically.

**Null state fields on some hotel rows.** A handful of hotels have null
`hotels.state`/`hotels.city` and derive location entirely from their linked
exit. The app now falls back to `exits.state` when composing addresses, so
display and directions are correct. The underlying data is fixed by
`migrations/003_backfill_hotel_city_state.sql` — run it, then this stops being
a trap for ad-hoc SQL. Treat `exits.state` as authoritative regardless.

**Arrival tracking rarely completes.** iOS Safari suspends background JavaScript
within roughly 30 seconds, so the 90-minute GPS tracker almost never runs to
completion. The arrival indicator was pulled from the hotelier dashboard rather
than show misleading data. The `arrived_at` column is retained for the planned
SMS-based replacement documented in `TODO.md`. This is a platform limitation,
not a bug to fix in this codebase.

**`google_check` had RLS disabled.** Fixed by
`migrations/002_google_check_rls.sql` — run it. Until it's run, the anon key can
write to that table.

**Credentials hard-coded as fallbacks** in `lib/supabase.ts`. Still present
deliberately: removing them breaks the build for anyone who hasn't set the
environment variables. Once a new owner has all four variables configured in
Vercel and verified a successful deploy, delete the fallbacks. See section 3.

**Admin auth is a single shared password.** Fine for one operator; replace with
Supabase Auth roles before adding staff. Not a defect — a scaling decision.

**No booking flow.** The product hands the driver a phone number. Bookings
happen off-platform, which is a deliberate decision — the target properties are
independents without booking systems. See `docs/DECISION_LOG.md`.

**Mapbox free tier.** Requests are batched and throttled specifically to stay
inside it. Significant traffic growth means either a paid Mapbox plan or a
harder look at the haversine fallback. Working as designed.

---

## 7. Where to look next

| Document | Contents |
|---|---|
| `docs/FEATURES.md` | What every feature does and where it lives |
| `docs/ARCHITECTURE.md` | System design and data flow |
| `docs/DATA_DICTIONARY.md` | Table-by-table, column-by-column schema |
| `docs/DECISION_LOG.md` | Why the product is shaped the way it is |
| `docs/RUNBOOK.md` | Operational procedures |
| `docs/FOR_BUYERS.md` | Acquisition-facing asset overview |
| `TODO.md` | Open work, with reasoning |
| `supabase-schema.sql` | Original schema bootstrap |
| `migrations/` | Incremental SQL migrations, run manually |

---

## 8. Suggested first 30 days

1. Complete the credential rotation in section 2. Nothing else matters until
   that's done.
2. Read `docs/DECISION_LOG.md` before changing anything — most of the product's
   apparent oddities are deliberate.
3. Verify a slice of inventory yourself by phone. It's the fastest way to
   understand what the business actually is.
4. Decide where `show_unverified_to_drivers` should sit.
5. Wire up payment collection. The fields exist; the revenue doesn't until
   something charges for it.
6. Get one hotelier paying. That single event changes the asset's category more
   than any feature would.
