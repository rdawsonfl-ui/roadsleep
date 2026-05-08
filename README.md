# RoadSleep

**A corridor-aware lodging finder for long-haul drivers.**

Most hotel apps ask "what city are you in?" RoadSleep asks "what road are you on, and which way are you going?" — then shows you the next set of hotels and RV parks ahead of you on that interstate, sorted by distance.

Live at: **[roadsleep.com](https://roadsleep.com)**

---

## Status (current)

| Metric | Count |
|---|---|
| Active interstate corridors | 13 |
| Mapped exits | 606 |
| Hotels | 1,335 |
| RV parks | 312 |
| **Total listings** | **1,647** |
| Hoteliers onboarded | 2 |
| Phone-call taps logged | 35 |

Geographic focus: east of the Mississippi (I-4, I-10, I-20, I-30, I-40, I-65, I-70, I-75, I-80, I-81, I-85, I-87, I-95). I-5 is wired in code but not yet seeded with data.

---

## What makes it different

The platform is built around four ideas that competitors don't combine:

1. **Interstate as the primary axis.** Every listing is anchored to an exit on a specific interstate at a specific mile marker. The driver picks their road first, then everything else follows.
2. **Direction-aware filtering.** Knowing you're on I-75 isn't enough — northbound vs. southbound completely changes which exits are "ahead." We compare driver GPS to exit lat/lng to filter out exits behind you.
3. **Forward planning, not "near me."** A standard radius search doesn't fit a moving driver. The distance slider is a forward-looking range ("within 100 mi"), and the route picker auto-populates with corridors you might reach within slider range, not just corridors you're sitting on right now.
4. **GPS that updates as you drive.** `watchPosition` keeps the location fresh, so as you approach a new corridor it appears in the picker automatically. Mapbox driving distances are throttled to >1mi shifts to stay inside the free tier.

---

## Stack

- **Frontend:** Next.js 16 (App Router) + React 19 + Tailwind 4
- **Backend:** Supabase (Postgres, Auth, RLS)
- **Routing distance:** Mapbox Matrix API (driving miles, not haversine)
- **Hosting:** Vercel (auto-deploy from `main`)
- **Analytics:** Vercel Web Analytics (anonymous, GDPR-clean)

No custom backend service. Everything is either a Next.js route or a direct Supabase query from the client.

---

## Repository layout

```
app/
  page.tsx              homepage — driver-facing search UI
  search/               results page (corridor + direction filtered)
  hotel/[id]/           hotel detail page
  hotelier/             hotelier login + dashboard
  admin/                admin console (gated by AdminGate)
  dashboard/            hotelier-facing call-tracking dashboard
lib/
  supabase.ts           shared Supabase client
  mapbox.ts             Matrix API helper for driving distances
docs/                   you are here — see below
supabase-schema.sql     baseline schema (note: production has drifted, see DATA_DICTIONARY.md)
```

## Documentation

For a buyer or new operator, read in this order:

1. **[FOR_BUYERS.md](docs/FOR_BUYERS.md)** — exec summary, asset valuation context, what's included
2. **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the pieces fit together
3. **[DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md)** — every table, every column
4. **[RUNBOOK.md](docs/RUNBOOK.md)** — common operational tasks
5. **[DECISION_LOG.md](docs/DECISION_LOG.md)** — why the product is built the way it is

For a developer:

6. **[DEPLOY.md](DEPLOY.md)** — how deploys work
7. **[AGENTS.md](AGENTS.md)** — note on Next.js 16 breaking changes (matters if working with AI tools)

---

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Mapbox keys
npm run dev                  # http://localhost:3000
```

Required environment variables (see `RUNBOOK.md` for sourcing them):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_MAPBOX_TOKEN=
```

## Deploy

`git push origin main` → Vercel auto-deploys. See [DEPLOY.md](DEPLOY.md).

---

## License

Proprietary — all rights reserved. Contact owner for inquiries.
