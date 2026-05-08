# Data Dictionary

Every table, every column, what it means, and any non-obvious behavior. Pulled directly from the live Supabase schema (production, not the older `supabase-schema.sql` baseline which has drifted).

---

## Tables at a glance

| Table | Rows | Purpose |
|---|---|---|
| `interstates` | 13 | The 13 active interstate corridors |
| `exits` | 606 | Exits along those corridors, with mile markers and lat/lng |
| `hotels` | 1,647 | Listings (despite the name, includes RV parks) |
| `hoteliers` | 2 | Business owners with login accounts |
| `call_logs` | 35 | One row per "Call" button tap |
| `settings` | varies | Operational toggles (key/value) |

---

## `interstates`

The list of corridors the product covers. Each row's `name` (e.g. `"I-75"`) drives the pill row on the homepage when `is_active = true`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, auto-generated |
| `name` | text | "I-95", "I-10", etc. **Unique.** This string appears in the UI. |
| `is_active` | bool, default `true` | Hide a corridor from drivers without deleting (e.g. corridor not yet seeded) |
| `created_at` | timestamptz | Auto |

**Operational note:** the homepage's `INTERSTATE_AXIS` const in `app/page.tsx` must contain a `'NS'` or `'EW'` entry for any new interstate, or the direction pills (Northbound/Southbound vs. Eastbound/Westbound) won't render. Adding a row here without updating that const = direction filter silently broken.

---

## `exits`

Each exit on a corridor. The atomic unit hotels hang off.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `interstate_id` | uuid | FK → `interstates.id`, `on delete cascade` |
| `direction` | text, NOT NULL | `'N'`, `'S'`, `'E'`, or `'W'`. **Note:** check constraint enforces this. |
| `exit_label` | text | Human label, e.g. `"Exit 42"` |
| `mile_marker` | numeric(6,1), NOT NULL | The MM number. Used for sort order along a corridor. |
| `city` | text | City of the exit |
| `state` | text | 2-letter state code |
| `lat` | numeric | **Critical.** Used for distance calculations. Many older rows are null. |
| `lng` | numeric | Same as lat. |
| `created_at` | timestamptz | Auto |

**Gotcha:** the `direction` column is non-null on the schema, but it's effectively redundant with `interstate_id` for our usage — the homepage doesn't query it. Direction filtering is done via lat/lng comparison to the driver's GPS, not via this column.

---

## `hotels`

The main listings table. Despite the name, RV parks live here too — distinguished by `type`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `exit_id` | uuid | FK → `exits.id`. **Most listings have this.** |
| `near_interstate_id` | uuid | FK → `interstates.id`. **Alternative to `exit_id`** for listings that aren't on a specific exit but are "near" an interstate. Rare — see `distance_off_route_mi`. |
| `name` | text, NOT NULL | Display name. **Empty strings are filtered out** by the homepage. |
| `phone` | text | Tappable on mobile. The "Call" button uses this. |
| `address` | text | Legacy combined address field |
| `street_address`, `city`, `state`, `zip` | text | Newer split address fields. Prefer these when populated. |
| `latitude`, `longitude` | double precision | **Listing-level coords.** When present, override `exits.lat/lng` for distance calcs. |
| `price_min`, `price_max` | int | Nightly rate range in USD |
| `amenities` | text[], default `'{}'` | Tags: `truck_parking`, `pets`, `24hr_checkin`, `wifi`, `pool`, etc. |
| `availability_badge` | text | `available`, `limited`, or `full`. Mostly unused right now. |
| `featured` | bool, default `false` | Old "promoted" flag — partially superseded by boost system |
| `photo_url` | text | Single photo URL. No multi-photo support yet. |
| `description` | text | Free text |
| `check_in_time`, `check_out_time` | text, defaults `'3:00 PM'` / `'11:00 AM'` | Display only |
| `website` | text | Tappable link on detail page |
| `verified` | bool, NOT NULL, default `false` | **Currently 0 of 1,647 are verified.** Drivers see all listings because `settings.show_unverified_to_drivers = 'true'`. |
| `last_verified_at` | timestamptz | Set when admin marks a listing verified |
| `verification_notes` | text | Free-text admin notes about verification |
| `boost_price` | int | If non-null and `boost_ends_at > now()`, listing floats above default sort |
| `boost_started_at`, `boost_ends_at` | timestamptz | Boost time window |
| `boost_duration_hr` | smallint | Convenience: how long this boost was paid for |
| `last_boost_date` | date | For rate-limiting per-day boost purchases |
| `priority` | text | Older priority flag, mostly unused |
| `est_revenue_per_call` | int, default `85` | Used for hotelier ROI display on dashboard |
| `owner_email` | text | Pre-Auth way to track ownership. Mostly null since Auth was added. |
| `hotelier_id` | uuid | FK → `hoteliers.id`. Set when a hotelier claims this listing. |
| `admin_notes` | text | Internal — never shown to drivers |
| `type` | text, default `'hotel'` | `'hotel'` or `'rv_park'`. Drives the banner button filter. |
| `distance_off_route_mi` | numeric | For `near_interstate_id` listings — how far off the highway |
| `created_at`, `updated_at` | timestamptz | Auto |

**Critical relationships to understand:**

- A hotel can be tied to a corridor via `exit_id` (most common) OR `near_interstate_id` (rarer). The homepage joins both.
- `verified = false` doesn't hide a listing from drivers — `settings.show_unverified_to_drivers` does. Be careful when toggling that setting.
- `hotelier_id` is the trust anchor. Listings without a `hotelier_id` are admin-curated; listings with one are claimed and the hotelier can edit them via `/dashboard`.

---

## `hoteliers`

Business-owner accounts.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `email` | text, NOT NULL | Unique by Auth, but no DB constraint |
| `password_hash` | text, NOT NULL | **Legacy.** New accounts auth via Supabase Auth (`auth_user_id`). |
| `auth_user_id` | uuid | FK → Supabase `auth.users.id`. Newer accounts. |
| `name` | text | Display name |
| `business_phone` | text | Their direct number |
| `billing_type` | text, default `'per_call'` | Future-proofing for billing models |
| `rate` | int, default `5` | Cents per call (or per-month flat, depending on `billing_type`) |
| `billing_status` | text, default `'active'` | `active`, `paused`, `delinquent` |
| `notes` | text | Admin-only |
| `created_at` | timestamptz | Auto |

**Note:** `password_hash` predates Supabase Auth integration. New signups should use Auth and populate `auth_user_id`. Don't write to `password_hash` for new rows.

---

## `call_logs`

Every "Call" button tap. The single source of truth for hotelier billing and driver-side analytics.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `hotel_id` | uuid | FK → `hotels.id` (which listing was called) |
| `hotelier_id` | uuid | Denormalized for fast per-hotelier queries |
| `called_at` | timestamptz, default `now()` | When the tap happened |
| `user_agent` | text | Best-effort device info |
| `referrer` | text | Where the tap came from on the site |

**Note:** rows are inserted from the browser using the anon key, before the `tel:` link fires. RLS allows insert by anyone but select only by matching `hotelier_id`. This is the row that turns into "you got 12 calls this week" on the hotelier dashboard.

---

## `settings`

Operational toggles. Key/value table.

| Column | Type | Notes |
|---|---|---|
| `key` | text, NOT NULL | Unique |
| `value` | text, NOT NULL | Free-form, but treat as typed by convention |
| `updated_at` | timestamptz, NOT NULL | Auto |

**Currently active keys:**

| Key | Value | Effect |
|---|---|---|
| `show_unverified_to_drivers` | `'true'` | When `'true'`, the homepage skips the `verified = true` filter and shows all listings. Set to `'false'` to enforce verification gating. |

If you add new keys, document them here.

---

## Foreign-key map

```
interstates.id ──┬─< exits.interstate_id
                 │
                 └─< hotels.near_interstate_id

exits.id ────────── hotels.exit_id

hoteliers.id ────── hotels.hotelier_id
                ╲
                 ╲── call_logs.hotelier_id

hotels.id ───────── call_logs.hotel_id

auth.users.id ───── hoteliers.auth_user_id   (Supabase Auth)
```

All cascades on the corridor/exit side are `on delete cascade` — deleting an interstate deletes its exits and (transitively) its hotels. **Be very careful with deletes.**

---

## Indexes

```sql
exits_interstate_direction_idx  (interstate_id, direction)
exits_mile_marker_idx           (mile_marker)
hotels_exit_id_idx              (exit_id)
hotels_featured_idx             (featured)
```

Add new indexes as needed; performance is fine at current scale.

---

## RLS policies (summary)

| Table | Read | Write |
|---|---|---|
| `interstates` | Public | Service role only |
| `exits` | Public | Service role only |
| `hotels` | Public | Service role + matching `hotelier_id` |
| `hoteliers` | Self only | Self only |
| `call_logs` | Matching `hotelier_id` only | Public insert |
| `settings` | Public read of allow-listed keys | Service role only |

If a buyer asks "is the data exposed?" — the answer is yes, by design. Anything in `interstates`, `exits`, `hotels` is meant to be readable by any anonymous browser. The trust model relies on RLS preventing **writes**, not reads.
