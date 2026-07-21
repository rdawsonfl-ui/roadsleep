'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import SiteFooter from '@/app/components/SiteFooter'
import { getDrivingDistances } from '@/lib/mapbox'
import { getSource } from '@/lib/analytics'

type Hotel = {
  id: string
  name: string
  phone: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  price_min: number | null
  price_max: number | null
  amenities: string[] | null
  featured: boolean | null
  exit_id: string | null
  // Boost columns - present on the row when hotelier has activated a boost.
  // featured doubles as 'currently boosted'; boost_price is the discount.
  boost_price: number | null
  boost_ends_at: string | null
  // Verification status — drives the '✔ Front desk confirmed' trust badge
  // shown above the Call/Go buttons. true = admin has personally called
  // and confirmed the front desk number works.
  verified?: boolean | null
  // How this listing was verified. 'frontdesk' = a human called the front desk
  // and confirmed (premium trust signal). 'google' = Google Places API says the
  // business is OPERATIONAL — automated, not as strong, but still useful.
  // null = not verified. Drives which badge (if any) renders above the Call
  // button: Front desk gets the bold green badge, Google gets a lighter pill.
  verification_source?: 'frontdesk' | 'google' | null
  // Approximate miles from the assigned highway exit to the hotel. Computed
  // as straight-line haversine × 1.4 (standard short-trip circuity factor).
  // Accurate to within ~0.3 mi at short ranges. Helps a driver decide whether
  // to detour — "0.4 mi" is way different from "8 mi" even at the same exit.
  distance_from_exit_mi?: number | null
  // Structured address. We prefer these over the legacy single 'address'
  // field. Either source can be used to compose what we show / send to maps.
  street_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  // Category — drives the All / Hotels / RV Parks toggle. Defaults to 'hotel'
  // server-side so legacy/null rows always render under the Hotels view.
  type?: 'hotel' | 'rv_park' | null
  // RV-park-specific: how far you have to drive off the interstate to reach
  // the park. Hotels typically sit AT exits and have this null. RV parks
  // are usually 5–20 mi off the highway and we want to be honest about it
  // so drivers can decide if the detour is worth it.
  distance_off_route_mi?: number | null
  near_interstate?: { name: string | null } | null
  exits?: { lat: number | null; lng: number | null; city: string | null; state: string | null; mile_marker: number | null; route_position: number | null; interstates?: { name: string | null } | null } | null
  distance: number | null
}

/** Sort interstate labels by their number, not as strings, so I-4 comes
 *  before I-10. Labels with no digits (odd corridor names) sort to the end
 *  and then alphabetically among themselves. */
export function compareInterstateNames(a: string, b: string): number {
  const num = (s: string) => {
    const m = s.match(/\d+/)
    return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER
  }
  const d = num(a) - num(b)
  return d !== 0 ? d : a.localeCompare(b)
}

/** Build a single-line address from the structured fields, falling back
 *  to the legacy 'address' column. Used for both card display and the
 *  directions URL. Skips empty parts gracefully so we don't end up with
 *  ugly leading commas or double-spaces.
 *
 *  City and state fall back to the linked exit. Some hotel rows have null
 *  hotels.city/hotels.state and carry their location only on the exit they
 *  hang off — without this fallback those listings render a bare street
 *  address, and the directions URL becomes ambiguous enough that Maps can
 *  route to the wrong state. exits.state is the authoritative field. */
function composeAddress(h: Hotel): string {
  const city  = h.city?.trim()  || h.exits?.city?.trim()  || ''
  const state = h.state?.trim() || h.exits?.state?.trim() || ''
  const parts = [
    h.street_address?.trim(),
    city,
    [state, h.zip?.trim()].filter(Boolean).join(' ').trim(),
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(', ')
  return h.address?.trim() || ''
}

// Build a Google Maps URL that LAUNCHES TURN-BY-TURN NAVIGATION immediately
// (with voice prompts), not the preview-with-Start-button page.
//
// The key params:
//   dir_action=navigate     -> skip the route preview, go straight to
//                              voice-guided turn-by-turn. Without this,
//                              Maps loads the route but stays silent
//                              until the driver taps a Start button.
//   travelmode=driving      -> lock the mode. Otherwise Maps occasionally
//                              defaults to whatever the user last used
//                              (transit/walking) which is wrong here.
//   origin=lat,lng          -> driver's current GPS, when we have it.
//                              Skips the "set starting point" interstitial
//                              that sometimes shows when device location
//                              isn't immediately available to Maps.
//
// On iOS, Google Maps must be installed for these params to do anything;
// if it isn't, the browser opens maps.google.com which works similarly
// but voice guidance requires the app. Apple Maps does its own thing
// from a separate URL scheme — not handled here. Most drivers have
// Google Maps installed; we'll add Apple Maps fallback later if needed.
function directionsUrl(h: Hotel, origin?: { lat: number; lng: number } | null): string {
  const lat = h.latitude ?? h.exits?.lat
  const lng = h.longitude ?? h.exits?.lng
  const base = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate'
  const originParam = origin ? `&origin=${origin.lat},${origin.lng}` : ''
  if (lat && lng) {
    return `${base}${originParam}&destination=${lat},${lng}`
  }
  const addr = composeAddress(h)
  if (addr) {
    return `${base}${originParam}&destination=${encodeURIComponent(addr)}`
  }
  // Last-resort fallback: hotel name search. No turn-by-turn possible
  // without a real destination, so we drop the navigate action here.
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.name)}`
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Compass bearing in degrees (0 = N, 90 = E, 180 = S, 270 = W) from
// point 1 to point 2. Used to infer which way the driver is going by
// comparing consecutive GPS fixes. Returns null if the points are
// effectively the same (no meaningful heading to compute).
function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number | null {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const dLng = toRad(lng2 - lng1)
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const y = Math.sin(dLng) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng)
  if (Math.abs(y) < 1e-9 && Math.abs(x) < 1e-9) return null
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// Map a compass bearing to one of N/S/E/W based on whether the corridor
// runs NS or EW. We snap to whichever cardinal the heading is closest to
// on that axis — so a driver going 200° (slightly west of south) on an
// NS corridor gets 'S', not 'W'. This makes the filter robust to highways
// that curve (I-95 in NC, I-87 through the Adirondacks).
function bearingToDirection(bearing: number, axis: 'NS' | 'EW'): 'N' | 'S' | 'E' | 'W' {
  if (axis === 'NS') {
    // bearing in [0, 90] or [270, 360] = north-ish; else south-ish
    return (bearing < 90 || bearing > 270) ? 'N' : 'S'
  }
  // EW corridor: [0, 180] = east-ish (rising lng); [180, 360] = west-ish
  return bearing < 180 ? 'E' : 'W'
}

// Insert a call_logs row. Returns the new row's id when from_boost is true
// so the caller can hand it to trackApproach() for arrival proof. Non-boost
// calls don't bother — no need to track arrival for organic taps.
async function logCall(
  hotelId: string,
  fromBoost: boolean = false,
  initialDistanceMi: number | null = null,
): Promise<string | null> {
  try {
    const insert: Record<string, unknown> = {
      hotel_id: hotelId,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      // Mark the call when the driver tapped a currently-boosted listing.
      // Hoteliers can then see, on their dashboard, how many of today's
      // calls were attributable to the boost vs. organic placement.
      // Column is nullable for backwards compatibility with rows logged
      // before this column existed.
      from_boost: fromBoost,
      // Marketing channel the driver arrived through (billboard, QR, NFC,
      // social, SEO), if any — captured on landing, null for direct traffic.
      source: getSource(),
    }
    // Snapshot the distance at the moment of tap so the dashboard can show
    // 'closed from 12mi to 0.2mi' rather than just 'arrived'. Only meaningful
    // when we actually have a GPS fix; null otherwise.
    // Capture the driver's distance at tap for EVERY call, not just boosted
    // ones — this is what populates 'avg miles at tap' on the hotelier report.
    // The page already holds a live GPS fix from the nearby-hotel sort, so
    // there's no extra permission prompt; we were simply discarding this on
    // organic taps before. closest_approach seeds to the same value since
    // there's no reliable post-call tracking on web.
    if (initialDistanceMi != null) {
      const d = Number(initialDistanceMi.toFixed(2))
      insert.initial_distance_mi = d
      insert.closest_approach_mi = d
    }
    const { data, error } = await supabase
      .from('call_logs').insert(insert).select('id').single()
    if (error) {
      console.error('call log failed', error)
      return null
    }
    return data?.id ?? null
  } catch (e) {
    console.error('call log failed', e)
    return null
  }
}

// GPS-based arrival proof for boost calls. After the driver taps Call on a
// boosted hotel, we keep watching their GPS for up to 90 minutes (long
// enough for a 50-mile approach at highway speed). Every minute we:
//   - sample current GPS
//   - compute distance to the hotel
//   - if this is the closest we've seen, update closest_approach_mi
//   - if distance < 0.25mi, mark arrived_at = now() and stop
// Stops when: arrival detected, 90 minutes elapse, or page unloads. The
// tracker is fire-and-forget; the caller doesn't need to await it.
//
// Why this matters: it's hotelier-grade proof that the boost paid off.
// A tap that never gets closer than 12mi looks suspicious. A tap that
// closes from 8mi to 0.1mi at highway speed is unambiguous: real driver,
// real arrival, real booking attempt.
//
// Returns the cleanup function so the caller can cancel tracking early
// if e.g. the modal closes.
function trackApproach(
  callLogId: string,
  hotelLat: number,
  hotelLng: number,
): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return () => {}
  }

  const startedAt = Date.now()
  const MAX_TRACKING_MS = 90 * 60 * 1000   // 90 minutes
  const SAMPLE_INTERVAL_MS = 60 * 1000      // every minute
  const ARRIVAL_THRESHOLD_MI = 0.25

  let closestMi = Number.POSITIVE_INFINITY
  let arrived = false
  let cancelled = false

  const tick = () => {
    if (cancelled || arrived) return
    if (Date.now() - startedAt > MAX_TRACKING_MS) {
      // Window expired — final write of tracking_ended_at and we're done.
      supabase.from('call_logs').update({
        tracking_ended_at: new Date().toISOString(),
      }).eq('id', callLogId).then(undefined, () => {})
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled || arrived) return
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        // Haversine inline so we don't depend on the milesBetween helper
        // (this file is shared across server/client boundaries in some
        // refactors and the helper might not be in scope here).
        const R = 3958.8
        const toRad = (d: number) => (d * Math.PI) / 180
        const dLat = toRad(hotelLat - lat)
        const dLng = toRad(hotelLng - lng)
        const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat)) * Math.cos(toRad(hotelLat)) * Math.sin(dLng / 2) ** 2
        const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

        if (d < closestMi) {
          closestMi = d
          const update: Record<string, unknown> = {
            closest_approach_mi: Number(d.toFixed(2)),
          }
          if (d < ARRIVAL_THRESHOLD_MI && !arrived) {
            arrived = true
            update.arrived_at = new Date().toISOString()
            update.tracking_ended_at = new Date().toISOString()
          }
          supabase.from('call_logs').update(update).eq('id', callLogId)
            .then(undefined, () => {})
        }

        if (!arrived) {
          setTimeout(tick, SAMPLE_INTERVAL_MS)
        }
      },
      () => {
        // GPS failed — try again next interval, don't kill tracking.
        if (!cancelled && !arrived) setTimeout(tick, SAMPLE_INTERVAL_MS)
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
    )
  }

  // Kick off first sample after a short delay so the driver has time to
  // exit the dialer and (typically) return to the app.
  setTimeout(tick, 5000)

  return () => {
    cancelled = true
    // Best-effort: stamp tracking_ended_at so the dashboard knows the
    // tracker terminated cleanly rather than going stale.
    supabase.from('call_logs').update({
      tracking_ended_at: new Date().toISOString(),
    }).eq('id', callLogId).then(undefined, () => {})
  }
}

// Short human-readable confirmation code for boost rates that drivers
// show at the front desk. 6 chars, no ambiguous glyphs (no O/0/I/1).
// Format: RS-XXXX so it's clearly from RoadSleep when seen on a screen.
// Not cryptographically unique; collisions don't matter — the code is
// just visual proof the driver got the rate via the app, not via
// random typing. The desk clerk reads it, sees "RS-..." prefix, and
// honors the boost price.
function generateBoostCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `RS-${s}`
}

export default function HomePage() {
  const [hotels, setHotels] = useState<Hotel[]>([])
  // When a driver taps Call on a currently-boosted hotel, we pause briefly
  // to show them the boost rate + a confirmation code they can show at
  // the front desk. The modal isn't a hard block — driver can tap Call
  // again to actually dial, or screenshot the screen and call later.
  // null = no modal open. Holds the Hotel + the generated code so the
  // code stays stable while the modal is up.
  const [boostRateModal, setBoostRateModal] = useState<{ hotel: Hotel; code: string } | null>(null)
  const [loading, setLoading] = useState(true)
  // NOTE: a max-price slider used to live here. Pulled because the price
  // data we have on hotels is not consistently up-to-date — filtering on
  // it would silently hide listings the driver would actually want. We can
  // bring it back once we trust price freshness (e.g. after hoteliers
  // self-update via their dashboard, or after a periodic refresh job).
  // Distance preset: 'closest' shows everything sorted by closest first.
  // Numeric values cap to that many miles. Default = 'closest' so drivers
  // Distance preset. We removed the More Filters panel that let drivers
  // narrow this — Closest is the only setting now. Kept as state (not a
  // const) because the Closest button toggles it, and it's a low-risk
  // anchor if we want to bring filters back later.
  const [distance, setDistance] = useState<'10' | '30' | '60' | '120' | 'closest'>('closest')
  // Distance slider state — represents the CENTER of where the driver wants
  // to stop, not a max cap. e.g. value=200 with WINDOW=50 shows hotels in
  // the 150-250 mi band. Default 100 = thumb near left = 'I want to stop
  // soon' which matches the most common driver intent (tired, near a stop).
  // Driver who's planning further ahead slides right.
  const [targetDistance, setTargetDistance] = useState<number>(100)
  // ±50 mi window around the target. Wide enough that drivers see real
  // options at every slider position; narrow enough that the band feels
  // intentional. Drivers planning a 4-hr stop care about a stretch, not
  // a single milepost.
  const DISTANCE_WINDOW = 50

  // Interstate filter — when set, only listings on this interstate show.
  // Default null = no filter (all corridors mixed); auto-populated below
  // once GPS + hotels resolve to whichever corridor the driver is closest
  // to. Driver can change/clear by tapping pills.
  const [selectedInterstate, setSelectedInterstate] = useState<string | null>(null)
  // Tracks whether the driver has manually touched the corridor filter
  // (tapped a pill or cleared one). Once true, auto-select stops trying
  // to override — driver's choice wins. Reset would require a fresh page
  // load, which is fine: the auto-pick is a first-load convenience, not
  // a continuous behavior.
  const [interstateUserTouched, setInterstateUserTouched] = useState<boolean>(false)
  // Name of the corridor we last switched to on our own. Drives a short
  // banner so the driver understands why the list just changed under them
  // at 70mph — a silent repopulate reads as a bug. Cleared on tap.
  const [autoSwitchedTo, setAutoSwitchedTo] = useState<string | null>(null)
  // Direction filter — only meaningful after an interstate is selected.
  // 'N'/'S' for north-south interstates, 'E'/'W' for east-west. We use
  // GPS lat (for NS) or lng (for EW) to figure out which exits are
  // 'ahead' of the driver and hide the rest. Null = both directions.
  const [selectedDirection, setSelectedDirection] = useState<'N'|'S'|'E'|'W'|null>(null)
  // Direction inferred from consecutive GPS fixes (compass bearing). Lets
  // the ahead/behind filter work even when the driver hasn't tapped a
  // direction button. Manual selectedDirection always wins when set —
  // this is the fallback. Null until we have two fixes far enough apart
  // to compute a stable heading.
  const [inferredDirection, setInferredDirection] = useState<'N'|'S'|'E'|'W'|null>(null)
  // Last GPS fix we used to compute heading. Tracked separately from
  // userLoc so the heading calc only fires when the driver has moved
  // far enough for the bearing to be meaningful (sub-100ft jitter would
  // produce wildly unstable headings).
  const lastHeadingFixRef = useRef<{ lat: number; lng: number } | null>(null)

  // Orientation map for our 6 corridors. Determines whether the direction
  // row shows NB/SB or EB/WB buttons. North-south = compares lat to
  // driver's lat. East-west = compares lng to driver's lng.
  const INTERSTATE_AXIS: Record<string, 'NS' | 'EW'> = {
    'I-4':  'EW',
    'I-10': 'EW',
    'I-20': 'EW',
    'I-30': 'EW',
    'I-40': 'EW',
    'I-70': 'EW',
    'I-80': 'EW',
    'I-5':  'NS',
    'I-65': 'NS',
    'I-75': 'NS',
    'I-81': 'NS',
    'I-85': 'NS',
    'I-87': 'NS',
    'I-95': 'NS',
  }

  // Real-world interstate intersections — corridors that physically cross or
  // closely connect (within ~35 mi via interchange/beltway). Derived once from
  // the closest exit pair between every two corridors in our DB; entries kept
  // when the closest pair was <= 35 mi (true interchanges + beltway-connected
  // corridors like I-95 ↔ I-40 via Raleigh's I-440), excluded above that
  // (parallel corridors like I-75 ↔ I-95 in Florida — closest is 60 mi, never
  // touch within the state).
  //
  // Why this exists: GPS-based "within slider range" alone is wrong for
  // parallel highways. A driver going north on I-75 in Florida sees I-95
  // showing up as a pill because it's geographically within 150 mi to the
  // east — but they can't get to it without a major detour. Intersection
  // filter hides corridors that don't cross the selected one.
  //
  // Each intersection has an anchor lat/lng (the midpoint of the closest
  // exit pair) so we can check "is this intersection AHEAD of the driver"
  // in their direction of travel. Symmetric: lookup works either direction.
  //
  // I-4 intersections (Tampa for I-75, Daytona Beach for I-95) were added
  // after I-4's exits/hotels landed in the DB. Empty/unseeded corridors
  // (I-5, I-20, I-30, I-85) still have no entries because their exits
  // aren't in the DB — handled correctly by the filter (those corridors
  // have no listings to show anyway).
  type Intersection = { lat: number; lng: number; nearCity: string }
  const INTERSTATE_INTERSECTIONS: Record<string, Record<string, Intersection>> = {
    'I-4': {
      // I-4 ↔ I-75 closest exit pair was 7.77 mi (DB query): I-4's Tampa
      // Downtown exit (27.9506, -82.4572) and I-75's Tampa exit (28.063,
      // -82.456). Midpoint placed at the I-75/I-4 interchange near Tampa.
      'I-75': { lat: 28.007, lng: -82.457, nearCity: 'Tampa' },
      // I-4 ↔ I-95 closest pair was effectively 0 mi: both exits sit
      // at the I-4/I-95 interchange in Daytona Beach (29.2108, -81.0228).
      'I-95': { lat: 29.211, lng: -81.023, nearCity: 'Daytona Beach' },
    },
    'I-10': {
      'I-65': { lat: 30.69, lng: -88.04, nearCity: 'Mobile' },
      'I-75': { lat: 30.19, lng: -82.64, nearCity: 'Lake City' },
      'I-95': { lat: 30.32, lng: -81.66, nearCity: 'Jacksonville' },
    },
    'I-40': {
      'I-65': { lat: 36.16, lng: -86.78, nearCity: 'Nashville' },
      'I-75': { lat: 35.96, lng: -83.92, nearCity: 'Knoxville' },
      'I-81': { lat: 36.05, lng: -83.45, nearCity: 'Knoxville (I-81 split)' },
      'I-95': { lat: 35.78, lng: -78.64, nearCity: 'Raleigh' },
    },
    'I-65': {
      'I-10': { lat: 30.69, lng: -88.04, nearCity: 'Mobile' },
      'I-40': { lat: 36.16, lng: -86.78, nearCity: 'Nashville' },
      'I-70': { lat: 39.77, lng: -86.16, nearCity: 'Indianapolis' },
      'I-80': { lat: 41.59, lng: -87.34, nearCity: 'Gary' },
    },
    'I-70': {
      'I-65': { lat: 39.77, lng: -86.16, nearCity: 'Indianapolis' },
      'I-75': { lat: 39.78, lng: -84.20, nearCity: 'Dayton' },
      'I-81': { lat: 39.62, lng: -77.72, nearCity: 'Hagerstown' },
      'I-95': { lat: 39.40, lng: -76.71, nearCity: 'Baltimore' },
    },
    'I-75': {
      'I-4':  { lat: 28.007, lng: -82.457, nearCity: 'Tampa' },
      'I-10': { lat: 30.19, lng: -82.64, nearCity: 'Lake City' },
      'I-40': { lat: 35.96, lng: -83.92, nearCity: 'Knoxville' },
      'I-70': { lat: 39.78, lng: -84.20, nearCity: 'Dayton' },
    },
    'I-80': {
      'I-65': { lat: 41.59, lng: -87.34, nearCity: 'Gary' },
      'I-81': { lat: 41.05, lng: -75.99, nearCity: 'Hazleton' },
    },
    'I-81': {
      'I-40': { lat: 36.05, lng: -83.45, nearCity: 'Knoxville (I-81 split)' },
      'I-70': { lat: 39.62, lng: -77.72, nearCity: 'Hagerstown' },
      'I-80': { lat: 41.05, lng: -75.99, nearCity: 'Hazleton' },
    },
    'I-87': {
      'I-95': { lat: 40.91, lng: -73.85, nearCity: 'Bronx' },
    },
    'I-95': {
      'I-4':  { lat: 29.211, lng: -81.023, nearCity: 'Daytona Beach' },
      'I-10': { lat: 30.32, lng: -81.66, nearCity: 'Jacksonville' },
      'I-40': { lat: 35.78, lng: -78.64, nearCity: 'Raleigh' },
      'I-70': { lat: 39.40, lng: -76.71, nearCity: 'Baltimore' },
      'I-87': { lat: 40.91, lng: -73.85, nearCity: 'Bronx' },
    },
  }
  // Active interstates loaded from Supabase. Starts empty so we don't paint
  // a stale list; the corridor row simply doesn't render until data lands
  // (typically <100ms). Fetched once on mount — interstates are admin-managed
  // and don't change during a session.
  const [INTERSTATES, setInterstates] = useState<string[]>([])
  // 'Show all' override for the corridor pill row. When false (default),
  // we filter pills by GPS — only show interstates with at least one exit
  // within 75 mi of the driver. When true, show every active interstate.
  // Auto-falls-back to true when GPS denied or zero matches (driver is
  // far from any of our corridors, e.g. trip-planning from home).
  const [showAllInterstates, setShowAllInterstates] = useState<boolean>(false)
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null)
  // Throttled copy of userLoc that only updates when the driver has moved
  // more than 1 mi from the last anchor. Used as the dep for the Mapbox
  // Matrix refetch effect — without this, watchPosition firing every 30s
  // at 70mph would trigger a fresh Matrix batch ~once per mile and burn
  // through the free 50K/mo tier in days. Live userLoc is still used for
  // the pill filter, direction filter, and haversine fallback distance,
  // all of which are cheap in-memory math.
  const [stableUserLoc, setStableUserLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [locStatus, setLocStatus] = useState<'idle' | 'asking' | 'granted' | 'denied'>('idle')

  // Real driving distances from Mapbox Matrix API. Map keyed by hotel.id.
  // When this is populated, the render uses real driving miles. When empty
  // (initial load, API failure, no GPS), the render falls back to haversine
  // × 1.25 (the prior 'approx' behavior). Updates progressively as batches
  // come back — drivers see haversine first, then real numbers replace.
  const [drivingMiles, setDrivingMiles] = useState<Map<string, number>>(new Map())

  // Position along the corridor, used for all ahead/behind math. Prefers
  // route_position (continuous miles from the route's south/west end,
  // derived from lat/lng) and falls back to mile_marker where the backfill
  // hasn't run. mile_marker holds EXIT NUMBERS, which are not monotonic on
  // every corridor — I-87 restarts numbering at Albany (Thruway 1-24, then
  // Northway 1-44), so Harriman reads as 45 while Albany reads as 4 despite
  // sitting 150 mi apart. Sorting or direction-filtering on that column
  // silently drops legitimate stops from a long-range planning list.
  const routePos = (h: Hotel): number | null => {
    const rp = h.exits?.route_position
    if (rp != null) return Number(rp)
    const mm = h.exits?.mile_marker
    return mm != null ? Number(mm) : null
  }
  // Two-state category toggle. We deliberately don't offer 'All' — drivers
  // who want hotels and RV parks together would just be confused by mixing
  // them, and most travelers know which they need before opening the app.
  // Default = Hotels because supply is heavier (188 vs 37) and the majority
  // of road travelers want hotels. RV users will tap the other button.
  const [category, setCategory] = useState<'hotel' | 'rv_park'>('hotel')

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocStatus('denied')
      return
    }
    setLocStatus('asking')
    // watchPosition (not getCurrentPosition) — userLoc is now live. As the
    // driver moves, GPS callbacks fire and we update state, which means
    // the GPS-based interstate pill filter, the direction filter, and the
    // distance-to-hotel calcs all stay accurate during a long drive.
    // Without this, a driver who opened the app in Cape Coral and drove
    // 4 hours north would still see Cape Coral's nearby corridors.
    //
    // enableHighAccuracy: true asks the OS for GPS-grade fix instead of
    // wifi/cell trilateration. Worth the battery hit on a phone in a car
    // mount; the whole product depends on knowing the road you're on.
    // maximumAge: 30s — accept a fix up to 30s old to avoid hammering the
    // GPS chip; at 70mph that's ~1 mi of staleness, well under our 75mi
    // pill-filter threshold so it doesn't matter for that.
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocStatus('granted')
      },
      () => setLocStatus('denied'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // Promote userLoc -> stableUserLoc only on > 1 mi shifts. First fix
  // always promotes (no anchor yet). Subsequent fixes only promote when
  // the driver has actually moved a meaningful amount; sub-mile jitter
  // from GPS noise or sitting still doesn't trigger Mapbox refetches.
  useEffect(() => {
    if (!userLoc) return
    setStableUserLoc(prev => {
      if (!prev) return userLoc
      const moved = milesBetween(prev.lat, prev.lng, userLoc.lat, userLoc.lng)
      return moved > 1 ? userLoc : prev
    })
  }, [userLoc])

  // Infer travel direction from consecutive GPS fixes. We need at least
  // ~0.25 mi of movement between fixes for the heading to be stable —
  // shorter than that and GPS noise dominates the bearing. Once set, the
  // value sticks until the driver moves another quarter mile, so brief
  // stops or curves don't flip it. Manual N/S/E/W tap always overrides
  // this; inferredDirection is the auto-fallback.
  useEffect(() => {
    if (!userLoc) return
    const anchor = lastHeadingFixRef.current
    if (!anchor) {
      lastHeadingFixRef.current = userLoc
      return
    }
    const moved = milesBetween(anchor.lat, anchor.lng, userLoc.lat, userLoc.lng)
    if (moved < 0.25) return  // not enough movement to trust bearing
    const bearing = bearingDegrees(anchor.lat, anchor.lng, userLoc.lat, userLoc.lng)
    if (bearing == null) {
      lastHeadingFixRef.current = userLoc
      return
    }
    // Snap to the cardinal closest to bearing. We don't know the corridor
    // axis here, so we pick globally and the filter will reconcile against
    // the selected corridor's axis.
    let dir: 'N' | 'S' | 'E' | 'W'
    if (bearing >= 315 || bearing < 45) dir = 'N'
    else if (bearing < 135) dir = 'E'
    else if (bearing < 225) dir = 'S'
    else dir = 'W'
    setInferredDirection(dir)
    lastHeadingFixRef.current = userLoc
  }, [userLoc])

  // Auto-select the corridor the driver is closest to, so they don't have
  // to figure out that the pills are interactive. Runs on first GPS fix,
  // AND re-runs as the driver moves so a I-75 -> I-10 transition (or any
  // other interstate-to-interstate handoff) is picked up automatically.
  //
  // To avoid flipping the pill mid-trip from GPS noise or a parallel
  // corridor briefly looking closer, the re-detection requires the new
  // candidate's nearest exit to be at least 5 mi closer than the current
  // selection's nearest exit. That's strict enough to ignore the case
  // where I-95 and I-87 are within ~30 mi of each other near Albany,
  // but loose enough to catch a real interstate switch (where the new
  // road is right under the driver, ~0 mi, and the old road is now miles
  // back).
  //
  // interstateUserTouched still wins — if the driver manually tapped a
  // pill, never override.
  useEffect(() => {
    if (!userLoc || hotels.length === 0) return

    // Find the closest exit per interstate
    const bestPerInterstate = new Map<string, number>()
    for (const h of hotels) {
      const lat = h.latitude ?? h.exits?.lat
      const lng = h.longitude ?? h.exits?.lng
      const iname = h.exits?.interstates?.name || h.near_interstate?.name
      if (lat == null || lng == null || !iname) continue
      const d = milesBetween(userLoc.lat, userLoc.lng, Number(lat), Number(lng))
      const prev = bestPerInterstate.get(iname)
      if (prev === undefined || d < prev) bestPerInterstate.set(iname, d)
    }
    if (bestPerInterstate.size === 0) return

    // Pick the global best
    let bestIname: string | null = null
    let bestDist = Number.POSITIVE_INFINITY
    bestPerInterstate.forEach((d, iname) => {
      if (d < bestDist) {
        bestDist = d
        bestIname = iname
      }
    })

    if (!bestIname) return

    // Manual lock. Tapping a pill used to disable auto-switch permanently,
    // which meant a driver who picked I-87 by hand never got handed off to
    // I-95 at the Bronx — the list just ran dry as they drove off the end
    // of the corridor. The lock now RELEASES once the driver has plainly
    // left the road they picked: their chosen corridor is 25+ mi behind
    // them and some other corridor's exits are essentially underneath them
    // (within 5 mi). Short of that, a manual pick still wins outright, so
    // trip-planning from the couch and deliberate corridor browsing are
    // unaffected.
    if (interstateUserTouched) {
      const heldDist = selectedInterstate
        ? bestPerInterstate.get(selectedInterstate) ?? Number.POSITIVE_INFINITY
        : Number.POSITIVE_INFINITY
      const drivingOnOther = bestDist <= 5 && heldDist >= 25
      if (!drivingOnOther) return
      setInterstateUserTouched(false)
    }

    // First-time auto-select (nothing currently chosen) — just pick.
    if (!selectedInterstate) {
      setSelectedInterstate(bestIname)
      return
    }

    // Already have a selection. Only switch if the new candidate is
    // clearly closer (>= 5 mi gap). This prevents flapping between
    // parallel corridors while still catching real route transitions.
    if (bestIname === selectedInterstate) return
    const currentDist = bestPerInterstate.get(selectedInterstate) ?? Number.POSITIVE_INFINITY
    if (currentDist - bestDist >= 5) {
      setAutoSwitchedTo(bestIname)
      setSelectedInterstate(bestIname)
      // Reset direction state too — bearing relative to a new road may
      // imply a different cardinal. The next GPS update will re-infer.
      setInferredDirection(null)
      setSelectedDirection(null)
    }
  }, [hotels, userLoc, selectedInterstate, interstateUserTouched])

  // Fetch the active interstates list from Supabase on mount. Sorted by
  // name so the corridor pill row has a stable, predictable order regardless
  // of insertion order in the DB. is_active=true lets admins hide a corridor
  // (e.g. before listings are seeded) without deleting the row.
  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('interstates')
        .select('name')
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (error) {
        console.error('failed to load interstates', error)
        return
      }
      if (data) {
        setInterstates(
          (data as { name: string | null }[])
            .map(r => r.name)
            .filter((n): n is string => !!n)
            // Re-sort client-side. The DB order() is a string sort, which puts
            // I-10 ahead of I-4 in the corridor pills. Drivers read these as
            // road numbers, so sort by the number.
            .sort(compareInterstateNames)
        )
      }
    })()
  }, [])

  useEffect(() => {
    setLoading(true)
    ;(async () => {
      // Lazy boost-expiry: any boost whose end-time has passed flips back to
      // featured=false before we read hotels. Idempotent, no cron needed.
      try { await Promise.resolve(supabase.rpc('expire_finished_boosts')) } catch { /* noop */ }
      // Read the testing-mode toggle from settings. When true, drivers see
      // EVERY listing including unverified ones. When false (production
      // default), only verified=true listings show up. Either way, the green
      // '✔ Front desk confirmed' badge stays bound to verified=true so it
      // keeps its meaning — no fake badges in testing mode.
      let showAll = false
      try {
        const { data: s } = await supabase
          .from('settings').select('value').eq('key', 'show_unverified_to_drivers').single()
        showAll = s?.value === 'true'
      } catch { /* default false */ }

      // Build the query. Server-side filter on type + (optionally) verified.
      // Defensive: skip rows with empty/null name (artifacts of interrupted
      // hotelier signup attempts).
      //
      // Why two paged fetches: PostgREST has a server-side 1000-row hard cap
      // per request that overrides client-set limits. With ~1,335 hotels in
      // the DB, a single .limit(2000) silently returned only the first 1000
      // — meaning the most recently inserted ~335 hotels (latest corridors)
      // never reached the homepage. Symptom: I-10 / I-65 / I-81 hotels
      // missing from search and corresponding pills missing from the GPS-
      // filtered route picker.
      // Fix: explicit range pagination. Each .range(a, b) under 1000 rows
      // returns its full slice. Two pages cover up to 2000 rows; we'll
      // need to paginate further (or move to a smarter query) when the
      // platform crosses ~2000 hotels per category.
      const baseSelect = 'id,name,phone,address,street_address,city,state,zip,latitude,longitude,price_min,price_max,amenities,featured,exit_id,boost_price,boost_ends_at,verified,verification_source,distance_from_exit_mi,type,distance_off_route_mi,near_interstate:near_interstate_id(name),exits(lat,lng,city,state,mile_marker,route_position,interstates(name))'
      const buildQuery = (start: number, end: number) => {
        let q = supabase
          .from('hotels')
          .select(baseSelect)
          .eq('type', category)
          .not('name', 'is', null)
          .neq('name', '')
          // Always exclude hotels we've explicitly hidden (e.g. Google flagged
          // CLOSED_PERMANENTLY / CLOSED_TEMPORARILY). Drivers should never see
          // these even in testing mode — risking a driver calling a closed
          // hotel breaks trust faster than anything else.
          .eq('hidden', false)
          .range(start, end)
        if (!showAll) {
          q = q.eq('verified', true)
        }
        return q
      }
      const [page1, page2] = await Promise.all([
        buildQuery(0, 999),
        buildQuery(1000, 1999),
      ])
      const data = [...(page1.data ?? []), ...(page2.data ?? [])]
      if (data.length > 0) {
        const withNullDist: Hotel[] = (data as any[]).map((h) => ({ ...h, distance: null }))
        setHotels(withNullDist)
      }
      setLoading(false)
    })()
  }, [category])

  // Mapbox Matrix API fetch — kicks in once we have GPS + hotels loaded.
  // Strategy:
  //   1. Pre-rank hotels by haversine distance (fast, in-memory)
  //   2. Take the closest 24 (Matrix API limit)
  //   3. Send them to Mapbox in ONE batch request
  //   4. Store results in drivingMiles state — render immediately uses them
  // We re-fetch when category changes (different hotels in scope) or when
  // userLoc changes meaningfully (>1 mi — driving down the road triggers
  // recalculation; standing still doesn't spam the API).
  // Fetches the closest batch first because that's what the driver sees;
  // if they slide the distance slider out to 500 mi we don't bother — the
  // haversine fallback is plenty accurate at that distance.
  // Note: keys on stableUserLoc (not userLoc) so we only refetch when the
  // driver has moved > 1 mi. Without this, watchPosition would trigger
  // Matrix calls every 30s — fast way to blow through the free tier.
  useEffect(() => {
    if (!stableUserLoc || hotels.length === 0) return
    // Rank by quick haversine first to pick the 24 closest worth fetching.
    const ranked = hotels
      .map(h => {
        const hLat = h.latitude ?? h.exits?.lat
        const hLng = h.longitude ?? h.exits?.lng
        if (hLat == null || hLng == null) return null
        return {
          id: h.id,
          lat: Number(hLat),
          lng: Number(hLng),
          d: milesBetween(stableUserLoc.lat, stableUserLoc.lng, Number(hLat), Number(hLng)),
        }
      })
      .filter((x): x is { id: string; lat: number; lng: number; d: number } => x !== null)
      .sort((a, b) => a.d - b.d)
      .slice(0, 24)

    if (ranked.length === 0) return

    let cancelled = false
    getDrivingDistances(
      { lat: stableUserLoc.lat, lng: stableUserLoc.lng },
      ranked.map(r => ({ id: r.id, lat: r.lat, lng: r.lng })),
    ).then(map => {
      if (cancelled || map.size === 0) return
      // Merge into existing state (don't replace — preserves any prior
      // batches in case we add multi-batch support later).
      setDrivingMiles(prev => {
        const next = new Map(prev)
        map.forEach((v, k) => next.set(k, v.miles))
        return next
      })
    })
    return () => { cancelled = true }
  }, [hotels, stableUserLoc?.lat, stableUserLoc?.lng])

  const hotelsWithDistance: Hotel[] = hotels.map((h) => {
    const hLat = h.latitude ?? h.exits?.lat
    const hLng = h.longitude ?? h.exits?.lng
    let dist: number | null = null
    if (userLoc && hLat && hLng) {
      // Prefer real driving distance from Mapbox Matrix API. If we don't
      // have it yet for this hotel (still loading, batch hasn't arrived,
      // or API failed), fall back to haversine × 1.25 — the same approx
      // we used to ship before Mapbox was wired.
      const real = drivingMiles.get(h.id)
      if (real != null) {
        dist = real
      } else {
        dist = milesBetween(userLoc.lat, userLoc.lng, Number(hLat), Number(hLng)) * 1.25
      }
    }
    return { ...h, distance: dist }
  })

  // Driver's current mile marker on the selected interstate. We pick the
  // closest exit on that interstate (any direction) by haversine and use
  // its mile_marker. Exits are spaced every few miles, so this gives
  // accuracy within ~half an exit gap — plenty for ahead/behind decisions.
  // Null when GPS denied or no interstate selected.
  const userMM: number | null = useMemo(() => {
    if (!userLoc || !selectedInterstate) return null
    let bestMM: number | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const h of hotels) {
      const iname = h.exits?.interstates?.name
      if (iname !== selectedInterstate) continue
      const lat = h.exits?.lat
      const lng = h.exits?.lng
      const mm = routePos(h)
      if (lat == null || lng == null || mm == null) continue
      const d = milesBetween(userLoc.lat, userLoc.lng, Number(lat), Number(lng))
      if (d < bestDist) {
        bestDist = d
        bestMM = Number(mm)
      }
    }
    // Sanity: if the closest exit is more than 20 mi away, we're probably
    // not actually on this interstate — return null and let the filter
    // fall back to lat/lng comparison rather than emit garbage MMs.
    if (bestDist > 20) return null
    return bestMM
  }, [userLoc, selectedInterstate, hotels])

  // Which way does mile_marker increase along this interstate's data?
  //
  // We can't assume MM follows the federal milepost convention (which
  // increases north on NS routes, east on EW). Our DB has at least one
  // corridor (I-87) where the stored MMs increase SOUTHWARD: Queensbury
  // (Albany end) = MM 285, while Westport (north end) = MM 281. So a
  // northbound driver in Glens Falls would have hotels "ahead" with
  // LOWER MMs, not higher — opposite of the federal convention.
  //
  // Fix: derive the MM-direction relationship empirically per interstate.
  // For an NS corridor we ask: does mile_marker correlate positively or
  // negatively with latitude across this corridor's exits? Positive
  // correlation = MM grows northward (federal). Negative = MM grows
  // southward (our I-87 data).
  //
  // The signed direction filter then becomes:
  //   driver going N + MM grows N  -> ahead = hotelMM > userMM
  //   driver going N + MM grows S  -> ahead = hotelMM < userMM
  //   driver going S + MM grows N  -> ahead = hotelMM < userMM
  //   driver going S + MM grows S  -> ahead = hotelMM > userMM
  // Same idea with lng for EW corridors.
  //
  // Returns +1 if MM increases with lat/lng (federal-style), -1 if it
  // decreases. Null if we have too few data points to decide.
  const mmAxisSign: 1 | -1 | null = useMemo(() => {
    if (!selectedInterstate) return null
    const axis = INTERSTATE_AXIS[selectedInterstate]
    // Collect (positional, mm) pairs from exits on this corridor
    const pairs: Array<{ pos: number; mm: number }> = []
    for (const h of hotels) {
      const iname = h.exits?.interstates?.name
      if (iname !== selectedInterstate) continue
      const lat = h.exits?.lat
      const lng = h.exits?.lng
      const mm = routePos(h)
      if (lat == null || lng == null || mm == null) continue
      const pos = axis === 'NS' ? Number(lat) : Number(lng)
      pairs.push({ pos, mm: Number(mm) })
    }
    if (pairs.length < 3) return null  // not enough to be confident

    // Quick sign-of-correlation check: compare extremes. Find the exit
    // with the lowest pos value and the one with the highest. If MM at
    // high-pos > MM at low-pos, MM increases with pos (sign = +1).
    let lowestPos = pairs[0], highestPos = pairs[0]
    for (const p of pairs) {
      if (p.pos < lowestPos.pos) lowestPos = p
      if (p.pos > highestPos.pos) highestPos = p
    }
    if (lowestPos.mm === highestPos.mm) return null
    return highestPos.mm > lowestPos.mm ? 1 : -1
  }, [selectedInterstate, hotels])

  // Direction the filter should treat as "ahead." Manual tap wins; else
  // we use what GPS bearing inferred. Null = no direction known, filter
  // is permissive (shows both ways).
  const effectiveDirection: 'N' | 'S' | 'E' | 'W' | null = selectedDirection ?? inferredDirection

  let filtered = [...hotelsWithDistance]

  // GPS-based corridor filter — figure out which interstates have at least
  // one exit/listing within range of the driver. Radius tracks the
  // distance slider so pushing it out opens up both the hotel list AND
  // the pill row in lockstep:
  //
  //   slider 25..200  -> pill radius = 200 (floor — always show nearby
  //                      corridors even when slider is zoomed tight)
  //   slider 200..999 -> pill radius = slider value (e.g. slider=500 ->
  //                      I-10 pill appears for an Atlanta driver, etc.)
  //   slider 1000 (Anywhere) -> show every active corridor (no filter)
  //
  // Also falls back to all corridors when:
  //   - GPS denied (no userLoc to compare against)
  //   - showAllInterstates toggled on (driver tapped 'Show all')
  //   - Zero matches (driver is far from every corridor — rather show all
  //     than show nothing)
  // The 200-mi floor means a driver who zooms the slider down to 25mi
  // for nearby search doesn't lose visibility into 'I-10 is nearby and
  // tappable' — both the list-distance filter and the pill filter are
  // honest distance filters, but they have different best defaults.
  // The 200-mi floor applies ONLY when no corridor is selected. In that state
  // the driver is orienting — "what roads am I near" — and a tight slider
  // shouldn't blank the pill row.
  //
  // Once a corridor IS selected the driver is planning a specific trip, and
  // the slider has to mean exactly what it says. With the floor still applied
  // there, a slider at 75 mi produced a 200 mi pill radius and surfaced
  // corridors like I-81 that are nowhere near 75 miles away — the number on
  // screen and the pills underneath it disagreed.
  const NEARBY_INTERSTATE_RADIUS_MI =
    targetDistance >= 1000
      ? Number.POSITIVE_INFINITY
      : selectedInterstate
        ? targetDistance
        : Math.max(targetDistance, 200)
  const nearbyInterstateSet: Set<string> = (() => {
    if (!userLoc) return new Set()
    const s = new Set<string>()
    for (const h of hotelsWithDistance) {
      if (h.distance == null || h.distance > NEARBY_INTERSTATE_RADIUS_MI) continue
      const iname = h.exits?.interstates?.name || h.near_interstate?.name
      if (iname) s.add(iname)
    }
    return s
  })()

  // Intersection-based pill filter (overrides nearbyInterstateSet when active).
  //
  // Why it exists: the route the driver is currently ON should not show
  // every nearby corridor — only the ones that ACTUALLY CROSS their
  // selected one within reach. A driver on I-87 in upstate NY doesn't
  // need I-95 on the pill row unless they're close enough to actually
  // hit the I-87 ↔ I-95 interchange (Bronx, ~190 mi south).
  //
  // Distance threshold for this filter uses the slider value DIRECTLY
  // (no 200-mi floor like nearbyInterstateSet has). The nearby filter's
  // floor is there to keep "what corridors exist near me" stable as the
  // slider zooms tight; this filter is a different question — "what
  // intersections are within my planned trip range" — and for that the
  // slider IS the answer. Slider at 25 mi -> only show crossing corridors
  // whose interchange is within 25 mi. Slider at 1000 / Anywhere -> show
  // all crossing corridors.
  const INTERSECTION_RADIUS_MI = targetDistance >= 1000 ? Number.POSITIVE_INFINITY : targetDistance
  // Trigger: driver has selected a corridor (selectedInterstate is set) and
  // GPS resolved. In that mode, the pill row should only show corridors the
  // driver could realistically reach — the selected corridor itself, plus
  // corridors that intersect it within slider range AHEAD of the driver.
  //
  // Why "ahead": parallel non-intersecting corridors are the obvious noise
  // case. But intersections behind the driver are also noise — a driver
  // heading north past Lake City, FL doesn't need to see I-10 anymore;
  // they've already passed that interchange.
  //
  // "Ahead" uses the corridor's NS/EW axis: NS corridor + driver heading
  // north = intersections with greater lat. NS + south = lesser lat. EW
  // + east = greater lng. EW + west = lesser lng. If no direction is
  // selected yet (selectedDirection is null), we keep intersections in
  // BOTH directions — driver's still scoping the trip.
  //
  // Distance: the intersection's anchor lat/lng vs the driver's GPS, in
  // straight-line miles. Threshold = INTERSECTION_RADIUS_MI (slider value
  // directly, no floor — see comment above).
  const intersectionInterstateSet: Set<string> | null = (() => {
    if (!selectedInterstate || !userLoc) return null
    // At "Anywhere" the driver isn't asking "what crosses my road soon" —
    // they're scoping a long trip. Narrowing to the hand-built intersection
    // table there is actively wrong: it hides corridors they could plainly
    // reach, and the table is sparse enough (I-87 has a single entry) that
    // the result looks broken. Bail out and let the full corridor list show.
    if (targetDistance >= 1000) return null
    const intersections = INTERSTATE_INTERSECTIONS[selectedInterstate]
    if (!intersections) return null
    const axis = INTERSTATE_AXIS[selectedInterstate]
    const s = new Set<string>([selectedInterstate])
    for (const [otherName, point] of Object.entries(intersections)) {
      // Distance to intersection from current GPS
      const d = milesBetween(userLoc.lat, userLoc.lng, point.lat, point.lng)
      if (d > INTERSECTION_RADIUS_MI) continue
      // Direction check — uses effectiveDirection (manual tap OR auto from
      // GPS bearing) so the pill row stays consistent with the hotel list
      // even when the driver hasn't tapped N/S/E/W.
      if (effectiveDirection) {
        if (axis === 'NS') {
          if (effectiveDirection === 'N' && point.lat <= userLoc.lat) continue
          if (effectiveDirection === 'S' && point.lat >= userLoc.lat) continue
        } else if (axis === 'EW') {
          if (effectiveDirection === 'E' && point.lng <= userLoc.lng) continue
          if (effectiveDirection === 'W' && point.lng >= userLoc.lng) continue
        }
      }
      s.add(otherName)
    }
    return s
  })()

  // What we actually render in the pill row.
  //
  //   1. showAllInterstates ON, GPS off, or slider at Anywhere -> ALL corridors
  //   2. otherwise -> the UNION of two sets:
  //        a. corridors that cross the selected one within slider range ahead
  //           (the intersection table — precise, but hand-written)
  //        b. corridors with at least one listing within slider range
  //           (distance-based, derived from live data)
  //
  // The union matters. The intersection table used to OVERRIDE the distance
  // set, which meant the pill row could never show more than whatever had
  // been typed into that table by hand. I-87 has a single entry (I-95), so a
  // driver on I-87 saw exactly two pills whether the slider was at 25 miles
  // or 750 — the slider had no effect at all, and reachable corridors like
  // I-80 and I-81 were invisible. The table is a useful signal about which
  // roads genuinely connect, but it is not a complete map, so it can add
  // corridors and must not remove them.
  let visibleInterstates: string[]
  if (showAllInterstates || !userLoc || targetDistance >= 1000) {
    visibleInterstates = INTERSTATES
  } else if (intersectionInterstateSet || nearbyInterstateSet.size > 0) {
    visibleInterstates = INTERSTATES.filter(
      name =>
        intersectionInterstateSet?.has(name) ||
        nearbyInterstateSet.has(name)
    )
  } else {
    visibleInterstates = INTERSTATES
  }
  // Safety: if the driver has an interstate selected that the pill filter
  // would otherwise hide (e.g. they picked I-5 then GPS resolved them in
  // Florida), keep that pill visible so they can still deselect it.
  if (selectedInterstate && !visibleInterstates.includes(selectedInterstate) && INTERSTATES.includes(selectedInterstate)) {
    visibleInterstates = [...visibleInterstates, selectedInterstate].sort(compareInterstateNames)
  }
  const isInterstateListFiltered = visibleInterstates.length < INTERSTATES.length

  // Category gate — restrict by selected type. Treat null/undefined type as
  // 'hotel' (DB default) so legacy rows aren't accidentally hidden when the
  // driver picks Hotels.
  filtered = filtered.filter((h) => (h.type || 'hotel') === category)

  // Interstate filter — when the driver picks one, drop everything not on
  // it. A listing's interstate comes from its exit (.exits.interstates.name)
  // for hotels with an exit_id, OR from .near_interstate.name for RV parks
  // that use the off-route data model. Either match counts.
  if (selectedInterstate) {
    filtered = filtered.filter((h) => {
      const viaExit = h.exits?.interstates?.name
      const viaNear = h.near_interstate?.name
      return viaExit === selectedInterstate || viaNear === selectedInterstate
    })
  }

  // Direction filter — drop hotels behind the driver, keep hotels ahead.
  // PRIMARY signal: signed mile-marker delta. For NB/EB, ahead = hotelMM
  // > userMM. For SB/WB, ahead = hotelMM < userMM. A 2-mile rearview
  // buffer keeps a hotel visible for one more exit after passing it, so
  // a driver can still pull off "last minute" if they change their mind.
  //
  // FALLBACK: when userMM can't be computed (no exit data near driver),
  // we use lat/lng comparison — same as before. This only happens off
  // the interstate corridor or in the rare case the closest exit has no
  // mile_marker. The lat/lng path was the source of the GA/Carolinas
  // 24-mi-gap bug because I-95 curves enough that "lat ahead" misclassifies
  // exits — but it's better than no direction filter at all.
  //
  // Hotels without coordinates get dropped when the filter is engaged
  // (same as before — we can't place them).
  if (selectedInterstate && effectiveDirection && userLoc) {
    const axis = INTERSTATE_AXIS[selectedInterstate]
    const REARVIEW_MI = 2  // how far behind we still show a passed hotel

    // Sanity: if the driver is hundreds of miles from the selected
    // interstate (e.g. tapped I-10 while standing in upstate NY), the
    // direction filter makes no sense — every I-10 hotel is "south" of
    // the driver, so Northbound shows zero. Detect this by checking
    // whether ANY hotel on this corridor is within 50 mi. If not, the
    // driver is browsing, not actually traveling on this road — skip
    // the direction filter entirely and let them see the corridor's
    // hotels sorted by distance.
    const anyHotelClose = filtered.some(h => h.distance != null && h.distance < 50)

    if (anyHotelClose) filtered = filtered.filter((h) => {
      // BOOST BYPASS: a hotelier paying for a boost gets visibility on
      // their own corridor regardless of direction or rearview position.
      // The boost is paid placement; the driver should always see it
      // when filtering to that interstate, even if they've already
      // driven past the boosted hotel. Without this bypass a hotelier
      // who boosts at 3pm would get nothing from a driver who's already
      // 5 mi past their exit. The corridor (selectedInterstate) filter
      // still applies — a boost on I-10 doesn't show to a driver on I-87.
      if (h.featured && h.boost_ends_at && new Date(h.boost_ends_at).getTime() > Date.now()) {
        return true
      }

      const lat = h.latitude ?? h.exits?.lat
      const lng = h.longitude ?? h.exits?.lng
      const hMM = routePos(h)
      if (lat == null || lng == null) return false

      // MM path — preferred when we know both the driver's MM and the
      // hotel's MM, AND we know which way MMs run on this corridor.
      // Signed delta in the direction of travel:
      //   When MM grows in the driver's direction:    signed =  hMM - userMM
      //   When MM grows opposite the driver's direction: signed =  userMM - hMM
      //
      // mmGrowsCardinal: does MM increase going north/east on this corridor?
      //   axis NS + sign +1 -> MM grows N (federal style)
      //   axis NS + sign -1 -> MM grows S (our I-87 data)
      //   axis EW + sign +1 -> MM grows E
      //   axis EW + sign -1 -> MM grows W
      // Driver going N: ahead means hotel is north of driver.
      //   if MM grows N -> ahead has higher MM -> signed =  hMM - userMM
      //   if MM grows S -> ahead has lower MM  -> signed =  userMM - hMM
      if (userMM != null && hMM != null && mmAxisSign != null) {
        const driverGoesPositive = effectiveDirection === 'N' || effectiveDirection === 'E'
        const mmGrowsWithDriver = (driverGoesPositive && mmAxisSign === 1)
                                || (!driverGoesPositive && mmAxisSign === -1)
        const mmSigned = mmGrowsWithDriver
          ? Number(hMM) - userMM
          : userMM - Number(hMM)

        // Geographic sanity check. The MM value can be miskeyed in the DB
        // (we've seen Westport Hotel @ MM 281 even though Westport is
        // north of Queensbury @ MM 285). When MM disagrees with lat/lng
        // about which side of the driver the hotel is on, trust geography.
        //
        // Convert lat/lng delta into a rough signed-miles value: degrees
        // of latitude are ~69 mi each; degrees of longitude are ~69 * cos(lat)
        // — but we only need sign + scale for rearview, so a flat 69 is
        // close enough for this check.
        const DEG_TO_MI = 69
        const positional = axis === 'NS' ? (Number(lat) - userLoc.lat)
                                          : (Number(lng) - userLoc.lng)
        const geoSigned = driverGoesPositive
          ? positional * DEG_TO_MI
          : -positional * DEG_TO_MI

        // If MM and geo disagree on the ahead/behind verdict (one is
        // positive, the other negative) AND the disagreement is meaningful
        // (more than 5 mi apart — small disagreements are just road curvature),
        // trust the geographic answer. Otherwise prefer MM since it's the
        // along-the-road measure.
        const disagreeAndMeaningful =
          Math.sign(mmSigned) !== Math.sign(geoSigned)
          && Math.abs(mmSigned - geoSigned) > 5
        const signed = disagreeAndMeaningful ? geoSigned : mmSigned

        return signed >= -REARVIEW_MI
      }

      // Fallback path — lat/lng comparison. Less accurate on curving
      // highways but works when MM data isn't available. We don't apply
      // the rearview buffer here because we don't have a clean miles-units
      // measure to apply it to without recomputing.
      if (axis === 'NS') {
        return effectiveDirection === 'N'
          ? Number(lat) >= userLoc.lat
          : Number(lat) <= userLoc.lat
      } else {
        return effectiveDirection === 'E'
          ? Number(lng) >= userLoc.lng
          : Number(lng) <= userLoc.lng
      }
    })
  }

  if (userLoc) {
    // Numeric presets (10/30/60/120) cap to that many miles. 'closest'
    // doesn't filter — it just sorts (handled below).
    const cap = distance === '10' ? 10
              : distance === '30' ? 30
              : distance === '60' ? 60
              : distance === '120' ? 120
              : null
    if (cap !== null) {
      filtered = filtered.filter((h) => h.distance !== null && (h.distance as number) <= cap)
    }
    // Slider as MAX CAP. Slider value = max distance to show.
    //   100 = show hotels 0-100 mi away
    //   500 = show hotels 0-500 mi away
    //   1000 = max value = 'Anywhere' (no filter applied)
    // Used to be a ±50 mi band centered on the target, but that hid
    // closer hotels (driver in Cape Coral with slider at 100 saw I-75
    // northbound options at 124 mi but missed Naples at 30 mi southbound).
    // Max-cap matches the universal mental model of distance sliders.
    if (targetDistance < 1000) {
      filtered = filtered.filter((h) => {
        if (h.distance === null) return false
        return (h.distance as number) <= targetDistance
      })
    }
  }

  // Off-exit distance: hotels stay in the list regardless of how far they
  // are from their exit, but the sort below promotes closer-to-exit hotels
  // to the top of each exit cluster. Earlier we tried hard-filtering to
  // ≤1.5 mi but drivers in sparse regions saw empty lists. Sort-bias
  // preserves coverage AND solves the "tricked into a 10-mile detour"
  // problem by making the easy detour always the first option at each exit.

  // Sort cascade. Always closest-first.
  //   1. Boosted listings first (paid placement — preserved across all states)
  //   2. Distance from DRIVER ascending — closest hotel to the driver rises.
  //   3. Within hotels at the same exit (same driver-distance ±0.1mi), the
  //      one CLOSEST TO THE EXIT rises. This is the real driver-trust win:
  //      at MM 131 with three hotels, the 0.4-mi-off-exit one ranks above
  //      the 8-mi-off-exit one. Tired drivers see the easy detour first.
  //   4. Listings with no distance data sink to the end.
  filtered.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1

    // Use real distance when available, else mile marker as a deterministic
    // fallback so 'closest' is still meaningful when GPS is denied.
    const aDist = a.distance ?? routePos(a) ?? Number.POSITIVE_INFINITY
    const bDist = b.distance ?? routePos(b) ?? Number.POSITIVE_INFINITY

    // When driver-distance is meaningfully different, that's the primary
    // ranking. Use a 0.1 mi tolerance so floating-point noise doesn't
    // accidentally flip the tiebreaker we actually want to apply below.
    if (Math.abs(Number(aDist) - Number(bDist)) > 0.1) {
      return Number(aDist) - Number(bDist)
    }

    // Driver-distance is effectively tied → same exit (or very close).
    // Tiebreaker: closer-to-exit hotel rises. NULL off-exit sinks to bottom
    // of this cluster so we don't reward hotels with missing data.
    const aOff = a.distance_from_exit_mi != null ? Number(a.distance_from_exit_mi) : Number.POSITIVE_INFINITY
    const bOff = b.distance_from_exit_mi != null ? Number(b.distance_from_exit_mi) : Number.POSITIVE_INFINITY
    return aOff - bOff
  })

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '20px 16px 48px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        {/* H1 carries the wordmark now — the nav gave up its logo slot to the
            Day/Night toggle, so the brand has to land here. Suffix adapts to
            the active category so the driver still sees what they're looking
            at. */}
        {/* Wordmark only, centered. Drawn as SVG with textLength so it fills
            the line exactly — biggest it can be on one row at any screen
            width. Rendered at 105% and pulled back by half that on the left
            so it stays centered while sitting 5% larger; the overhang lives
            in the page's 16px side padding and never clips. */}
        <h1 style={{ margin: '0 0 12px', textAlign: 'center', overflow: 'hidden' }} aria-label="RoadSleep">
          <svg
            viewBox="0 0 1000 132"
            width="100%"
            role="img"
            aria-hidden="true"
            style={{ display: 'block' }}
          >
            <text
              x="0"
              y="100"
              textLength="1000"
              lengthAdjust="spacingAndGlyphs"
              fontFamily="Syne, sans-serif"
              fontWeight="800"
              fontSize="100"
              fill="var(--white)"
            >
              Road<tspan fill="var(--amber)">Sleep</tspan><tspan fontSize="36" dy="-38" fontWeight="600">™</tspan>
            </text>
          </svg>
        </h1>
        {/* RV parks keep their subtitle — it does real work explaining that
            these sit off the highway. Hotels don't need one; they sit at the
            exit and the interstate/direction controls below say the rest. */}
        {category === 'rv_park' && (
          <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '12px' }}>
            RV parks within driving distance of your interstate
          </p>
        )}
        {locStatus === 'denied' && (
          <div style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid var(--amber)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: 'var(--mist)' }}>
            📍 Location blocked. Distance filtering disabled. <button onClick={() => window.location.reload()} style={{ background: 'none', border: 'none', color: 'var(--amber)', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>Enable GPS</button> to see nearest {category === 'rv_park' ? 'RV parks' : 'hotels'}.
          </div>
        )}

        {/* Category toggle — two big thumb-size buttons. Active = filled
            amber, inactive = outlined. No 'All' option: drivers know which
            they need before opening the app, and mixing the two only
            adds noise. Default is Hotels (heavier supply, majority audience).
            High contrast and ~50px tall so it's easy to tap one-handed
            while truckers are on the road. */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          {([
            { key: 'hotel',   label: 'Hotels' },
            { key: 'rv_park', label: 'RV Parks' },
          ] as const).map(opt => {
            const active = category === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => setCategory(opt.key)}
                style={{
                  flex: 1,
                  background: active ? 'var(--amber)' : 'transparent',
                  color: active ? 'var(--night)' : 'var(--amber)',
                  border: '2px solid var(--amber)',
                  borderRadius: '12px',
                  padding: '16px 12px',
                  fontSize: '20px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  fontFamily: 'Syne, sans-serif',
                  letterSpacing: '0.4px',
                  transition: 'all 0.15s',
                  // Thumb-size: 50px+ tall total, easy to tap on the road
                  minHeight: '54px',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        {/* (CLOSEST button removed — sort is always closest-first now and
            the 'Closest shows first' label below the result count tells
            drivers about the sort order. Button was a no-op since the
            distance state was hardcoded to 'closest' anyway.) */}

        {/* Label above the pill row — drivers don't always realize the
            pills are tappable. Subtle (small, mist-gray, uppercase) so it
            reads as a label, not a heading. Centered to match the pill
            row alignment below. */}
        <div style={{
          textAlign: 'center',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--fog)',
          fontFamily: 'DM Sans, sans-serif',
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
          marginBottom: '8px',
        }}>
          Upcoming Routes — tap to switch
        </div>

        {/* Auto-switch notice. Only appears when the app changed corridors on
            its own; tapping any pill clears it. */}
        {autoSwitchedTo && (
          <div style={{
            background: 'var(--amber)',
            color: '#fff',
            borderRadius: '10px',
            padding: '8px 12px',
            fontSize: '13px',
            fontWeight: 600,
            fontFamily: 'DM Sans, sans-serif',
            textAlign: 'center',
            marginBottom: '10px',
          }}>
            Now on {autoSwitchedTo} — showing stops on this route
          </div>
        )}

        {/* Interstate filter row. Single-select. Tapping the same one
            again deselects (and clears direction). All buttons same
            style — small outlined pills. Selected one fills with amber.
            Sits above the direction row + slider so the flow reads
            top-down: pick route → pick direction → pick distance.
            With GPS granted, the pill list is auto-filtered to corridors
            within 75 mi of the driver — Florida driver doesn't see I-5,
            Seattle driver doesn't see I-95. The 'Show all' link below
            opens the unfiltered list for trip-planning. */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          marginBottom: selectedInterstate ? '8px' : '16px',
          justifyContent: 'center',
        }}>
          {visibleInterstates.map(iname => {
            const active = selectedInterstate === iname
            return (
              <button
                key={iname}
                onClick={() => {
                  setInterstateUserTouched(true)
                  setAutoSwitchedTo(null)
                  if (active) {
                    setSelectedInterstate(null)
                    setSelectedDirection(null)
                  } else {
                    setSelectedInterstate(iname)
                    setSelectedDirection(null)  // reset direction on switch
                  }
                }}
                style={{
                  background: active ? 'var(--orange)' : 'var(--chip)',
                  color:      active ? '#ffffff'      : 'var(--mist)',
                  border:     '1px solid ' + (active ? 'var(--orange)' : 'var(--chipBorder)'),
                  borderRadius: '999px',
                  padding: '7px 16px',
                  fontSize: '13px',
                  fontWeight: active ? 700 : 600,
                  cursor: 'pointer',
                  fontFamily: 'DM Sans, sans-serif',
                  letterSpacing: '0.5px',
                  minWidth: '58px',
                }}
              >
                {iname}
              </button>
            )
          })}
        </div>

        {/* Show all / Show fewer link. Only renders when the GPS filter
            is actually hiding something — otherwise it'd just be noise.
            Center-aligned, small, mist-gray text-button (no border / no
            pill shape) so it reads as 'extra option' not 'main control'.
            If driver taps a hidden corridor (e.g. I-5 in trip-planning),
            we keep their selection visible by un-filtering automatically. */}
        {(isInterstateListFiltered || (showAllInterstates && userLoc && nearbyInterstateSet.size > 0)) && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: selectedInterstate ? '8px' : '16px',
          }}>
            <button
              onClick={() => setShowAllInterstates(v => !v)}
              style={{
                background: 'transparent',
                color: 'var(--fog)',
                border: 'none',
                padding: '4px 8px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
                textDecoration: 'underline',
                textUnderlineOffset: '2px',
              }}
            >
              {showAllInterstates ? 'Show only nearby' : `Show all interstates (${INTERSTATES.length})`}
            </button>
          </div>
        )}

        {/* Direction row — only renders when an interstate is selected.
            Shows NB/SB for north-south interstates (I-75, I-87, I-95)
            or EB/WB for east-west (I-10, I-40, I-80). Tapping the same
            again deselects (= both directions). Hidden if GPS isn't
            granted — direction filter needs the driver's coordinates
            to know which exits are 'ahead'. */}
        {selectedInterstate && userLoc && (
          <div style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '16px',
            justifyContent: 'center',
          }}>
            {(INTERSTATE_AXIS[selectedInterstate] === 'NS'
              ? [{ key: 'N' as const, label: 'Northbound' }, { key: 'S' as const, label: 'Southbound' }]
              : [{ key: 'E' as const, label: 'Eastbound'  }, { key: 'W' as const, label: 'Westbound'  }]
            ).map(dir => {
              const active = selectedDirection === dir.key
              return (
                <button
                  key={dir.key}
                  onClick={() => setSelectedDirection(active ? null : dir.key)}
                  style={{
                    flex: 1,
                    maxWidth: '180px',
                    background: active ? '#22c55e' : 'transparent',
                    /* Inactive label uses the theme text token: near-black in
                       Day mode as requested. Literal #000 would vanish against
                       the near-black Night background, which is the mode a
                       driver is actually in at 10pm. Border stays green so the
                       control still reads as the direction picker. */
                    color:      active ? '#fff'    : 'var(--white)',
                    border:     '1px solid #22c55e',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                    letterSpacing: '0.3px',
                  }}
                >
                  {dir.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Distance slider — sits under the green CLOSEST button. Center-
            point semantics: slider value = where the driver wants to stop,
            and we show a ±DISTANCE_WINDOW band around it. Sliding to 200
            jumps the list to hotels around the 200-mi mark, instead of
            capping a closest-first list. Drivers planning a 4-hour stop
            actually want this band, not 'all hotels up to 200 mi'.
            Hidden when GPS is denied (distances unknown without GPS). */}
        {userLoc && (
          <div style={{ marginBottom: '16px', padding: '0 4px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: '6px',
              fontSize: '12px',
              color: 'var(--fog)',
              letterSpacing: '0.3px',
            }}>
              <span>Plan Ahead Distance</span>
              <span style={{ color: '#FF6A00', fontWeight: 700, fontSize: '14px' }}>
                {targetDistance >= 1000
                  ? 'Anywhere'
                  : `Within ${targetDistance} mi`}
              </span>
            </div>
            <input
              type="range"
              min={25}
              max={1000}
              step={25}
              value={targetDistance}
              onChange={e => setTargetDistance(parseInt(e.target.value))}
              aria-label="Target distance"
              className="distance-slider"
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '10px',
              color: 'var(--fog)',
              opacity: 0.6,
              marginTop: '2px',
            }}>
              <span>25 mi</span>
              <span>1000+</span>
            </div>
          </div>
        )}

        {/* (More Filters dropdown was removed — page now defaults to Closest
            with no narrowing options. The Closest button above is the only
            distance control. We can bring filters back later if needed by
            restoring the panel + setShowFilters state.) */}

        {/* Result count + sort guidance. Two pieces of small fog-colored
            text on one row — count on the left, 'Closest shows first' on
            the right — so drivers know how many results they're seeing
            AND why they're in this order. The guidance text replaces the
            old CLOSEST button (which used to be a no-op since the only
            sort was already closest-first). */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--fog)',
          fontSize: '13px',
          marginBottom: '14px',
        }}>
          <span>
            {loading
              ? 'Loading...'
              : locStatus === 'asking'
                ? 'Getting your location...'
                : `${filtered.length} ${category === 'rv_park' ? 'RV park' : 'hotel'}${filtered.length !== 1 ? 's' : ''} found`}
          </span>
          {!loading && filtered.length > 0 && (
            <span style={{ fontStyle: 'italic', color: 'var(--mist)', fontSize: '12px' }}>
              📍 Closest shows first
            </span>
          )}
        </div>

        {filtered.map((h) => {
          const distLabel = h.distance !== null ? `${Math.round(h.distance as number)} mi away` : null
          // Display label for location.
          // - Hotels (or RV parks attached to an exit): "I-95 · MM 318 · City, ST"
          // - RV parks with distance-off-route data: "I-95 · 4 mi off route"
          //   so drivers can decide if the detour is worth it.
          const exitLabel = (() => {
            if (h.type === 'rv_park' && h.near_interstate?.name && h.distance_off_route_mi != null) {
              const mi = Number(h.distance_off_route_mi)
              return `${h.near_interstate.name} · ${mi < 1 ? '<1' : Math.round(mi)} mi off route`
            }
            if (!h.exits) return null
            // Base: "I-75 · MM 131 · Fort Myers, FL"
            const base = `${h.exits.interstates?.name || ''} · MM ${h.exits.mile_marker} · ${h.exits.city}, ${h.exits.state}`
            // Append off-exit distance when we computed it (helps a driver
            // decide whether to detour — 0.4 mi vs 8 mi is genuinely
            // different even at the same exit). Round to one decimal
            // under 1 mi, otherwise round to nearest integer.
            const off = h.distance_from_exit_mi != null ? Number(h.distance_from_exit_mi) : null
            if (off != null && off >= 0) {
              const offText = off < 0.2 ? 'at exit'
                : off < 1 ? `${off.toFixed(1)} mi off exit`
                : `${Math.round(off)} mi off exit`
              return `${base} · ${offText}`
            }
            return base
          })()
          return (
            <div key={h.id} style={{ background: 'var(--night2)', border: h.featured ? '1px solid rgba(245,166,35,0.4)' : '1px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                {h.featured && <span style={{ fontSize: '11px', background: 'rgba(245,166,35,0.15)', color: 'var(--amber)', padding: '3px 9px', borderRadius: '4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>★ Boosted</span>}
                {/* (Per-card category pill removed — drivers already chose
                    Hotels vs RV Parks via the big banner buttons at the
                    top, so this pill was redundant. Removing reduces
                    visual noise per card.) */}
                {/* Distance — the single most important piece of info on
                    the card now that filters are gone. Bumped up to 15px
                    bold white so it stands out from secondary text without
                    fighting the price for attention. */}
                {distLabel && (
                  <span style={{ fontSize: '15px', color: 'var(--white)', fontWeight: 800, letterSpacing: '0.2px' }}>
                    {distLabel}
                  </span>
                )}
                {/* Price intentionally removed from regular cards. Hotel
                    rates change daily and scraped price_min/price_max are
                    stale within hours of capture — showing them broke
                    trust with drivers and undercut the boost feature's
                    value. Drivers now call to get tonight's rate. Boosted
                    hotels get to display a rate (or "★ Featured") via the
                    pulsating banner below the card body, which is the
                    only place a price appears in the app. */}
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--white)', marginBottom: '4px' }}>{h.name}</h3>
              {/* RV parks: render the 'X mi off route' line prominently (15px,
                  bold green) since detour distance is the deciding factor for
                  RV drivers — they need to see it without staring at the card.
                  Hotels are AT exits so they don't have this concept; for them
                  we keep the small gray exit-label line below. */}
              {h.type === 'rv_park' && h.near_interstate?.name && h.distance_off_route_mi != null ? (
                <p style={{ fontSize: '15px', color: '#22c55e', fontWeight: 800, marginBottom: '4px', letterSpacing: '0.2px' }}>
                  {h.near_interstate.name} · {Number(h.distance_off_route_mi) < 1
                    ? '<1 mi off route'
                    : `${Math.round(Number(h.distance_off_route_mi))} mi off route`}
                </p>
              ) : (
                exitLabel && <p style={{ fontSize: '11px', color: 'var(--fog)', marginBottom: '4px' }}>{exitLabel}</p>
              )}
              <p style={{ fontSize: '12px', color: 'var(--fog)', marginBottom: '10px' }}>{composeAddress(h)}</p>
              {h.amenities && h.amenities.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                  {h.amenities.slice(0, 4).map((a) => (
                    <span key={a} style={{ background: 'var(--night3)', color: 'var(--mist)', fontSize: '11px', padding: '4px 9px', borderRadius: '5px' }}>{a}</span>
                  ))}
                </div>
              )}
              {/* Pulsating boost banner — renders whenever the hotelier is
                  currently boosted (featured = true). Content adapts to
                  whether they set a discount price:
                    - With price:   big $XX + crossed-out regular rate
                    - Without:      'Featured' + 'Call for tonight's rate'
                  Either way, eyes land on the banner above the Call button. */}
              {h.featured && (
                <div className="boost-pulse" style={{
                  marginBottom: '10px',
                  padding: '14px 14px',
                  borderRadius: '10px',
                  // Red gradient — sale/urgency color, contrasts with the amber
                  // brand throughout the rest of the card so the eye snaps to it.
                  background: 'linear-gradient(90deg, #dc2626 0%, #b91c1c 100%)',
                  color: '#fff',
                  fontFamily: 'Syne, sans-serif',
                  fontWeight: 700,
                  textAlign: 'center',
                  boxShadow: '0 0 0 0 rgba(220,38,38,0.65)',
                }}>
                  <span style={{ fontSize: '10px', letterSpacing: '1.5px', opacity: 0.9, display: 'block', marginBottom: '6px' }}>
                    🔥 LIMITED-TIME DEAL
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
                    {h.boost_price ? (
                      // Priced boost — show the dollar amount.
                      // No crossed-out 'normally $X' anymore: regular rates
                      // aren't displayed anywhere in the app, so there's no
                      // 'normal' price for the driver to discount from.
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                        <span style={{ fontSize: '28px', lineHeight: 1 }}>${h.boost_price}</span>
                        <span style={{ fontSize: '11px', fontWeight: 500, opacity: 0.85 }}>/ night</span>
                      </div>
                    ) : (
                      // Price-free boost — show "Featured" badge, no $ amount
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                        <span style={{ fontSize: '24px', lineHeight: 1, letterSpacing: '0.5px' }}>★ FEATURED</span>
                      </div>
                    )}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      color: 'var(--night)', fontFamily: 'DM Sans, sans-serif', fontWeight: 800,
                      fontSize: '22px', lineHeight: 1.1, textAlign: 'left',
                    }}>
                      <span style={{ fontSize: '28px', lineHeight: 1 }} aria-hidden="true">←</span>
                      <span>RoadSleep<br/>rate</span>
                    </div>
                  </div>
                </div>
              )}
              {/* Trust signal — two tiers, honest about source:
                  • verification_source='frontdesk' → bold green "✔ Front desk
                    confirmed" — a human called and confirmed the listing.
                    Premium trust signal, RoadSleep's gold standard.
                  • verification_source='google' → small slate "Listed on
                    Google · Operational" pill — Google's automated business
                    listing says the place is open. Useful but NOT the same as
                    a human-confirmed call, so visually softer.
                  • verified=true but no source → fall through to the front
                    desk badge so legacy data still works.
                  Only one renders at a time (front desk wins if both). Sits
                  above the action row so it modifies the perceived legitimacy
                  of the Call button. */}
              {h.verified && h.verification_source === 'frontdesk' && (
                <p style={{
                  fontSize: '13px',
                  color: '#22c55e',
                  marginBottom: '8px',
                  fontWeight: 500,
                  letterSpacing: '0.2px',
                }}>
                  ✔ Front desk confirmed
                </p>
              )}
              {h.verified && h.verification_source === 'google' && (
                <p style={{
                  fontSize: '12px',
                  color: '#94a3b8',
                  marginBottom: '8px',
                  fontWeight: 500,
                  letterSpacing: '0.2px',
                }}>
                  Listed on Google · Operational
                </p>
              )}
              {h.verified && !h.verification_source && (
                <p style={{
                  fontSize: '13px',
                  color: '#22c55e',
                  marginBottom: '8px',
                  fontWeight: 500,
                  letterSpacing: '0.2px',
                }}>
                  ✔ Front desk confirmed
                </p>
              )}
              {/* Action row — CALL is the primary action (~67% width, solid
                  orange, big bold), GO is secondary (~33% width, outlined
                  orange, lighter). Per spec: zero friction to act. Both
                  buttons are 56px tall for tired drivers; minimum touch
                  target on mobile. Go opens directions immediately — no
                  more confirmation modal. */}
              <div style={{ display: 'flex', gap: '10px' }}>
                {(() => {
                  // Currently-boosted hotels intercept Call to show the rate
                  // modal first. Driver sees the discounted price + code,
                  // taps Call inside the modal to actually dial. The modal
                  // is the "proof to bring to the front desk" — driver can
                  // screenshot it or take a photo of the code. Logging the
                  // call (with from_boost=true) happens at the modal's
                  // confirm step, not here, so we don't double-log.
                  const isBoosted = h.featured && h.boost_ends_at &&
                    new Date(h.boost_ends_at).getTime() > Date.now()
                  if (isBoosted) {
                    return (
                      <button
                        onClick={() => setBoostRateModal({ hotel: h, code: generateBoostCode() })}
                        aria-label={`Show boost rate for ${h.name}`}
                        style={{
                          flex: 2,
                          height: '56px',
                          background: '#FF6A00',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '12px',
                          padding: '0 16px',
                          fontSize: '18px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          fontFamily: 'inherit',
                        }}
                      >
                        <span style={{ fontSize: '20px', lineHeight: 1 }} aria-hidden="true">📞</span>
                        <span>Call</span>
                      </button>
                    )
                  }
                  return (
                    <a
                      href={`tel:${h.phone || ''}`}
                      onClick={() => logCall(h.id, false, h.distance ?? null)}
                      aria-label={`Call ${h.name}`}
                      style={{
                        flex: 2,
                        height: '56px',
                        background: '#FF6A00',
                        color: '#FFFFFF',
                        borderRadius: '12px',
                        padding: '0 16px',
                        fontSize: '18px',
                        fontWeight: 600,
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ fontSize: '20px', lineHeight: 1 }} aria-hidden="true">📞</span>
                      <span>Call</span>
                    </a>
                  )
                })()}
                <a
                  href={directionsUrl(h, userLoc)}
                  aria-label={`Directions to ${h.name}`}
                  style={{
                    flex: 1,                          // ~33% of row
                    height: '56px',
                    background: 'transparent',
                    color: '#FF6A00',
                    border: '1px solid #FF6A00',
                    borderRadius: '12px',
                    padding: '0 16px',
                    fontSize: '16px',
                    fontWeight: 500,
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                >
                  <span style={{ fontSize: '18px', lineHeight: 1 }} aria-hidden="true">➤</span>
                  <span>Go</span>
                </a>
              </div>
            </div>
          )
        })}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fog)', fontSize: '13px' }}>
            🛣️ No {category === 'rv_park' ? 'RV parks' : 'hotels'} found. Try expanding your distance filter or tap {category === 'rv_park' ? 'Hotels' : 'RV Parks'} above.
          </div>
        )}
      </div>

      {/* (Directions confirmation modal removed per spec — Go button now
          opens Maps directly. Edge case of accidental tap is handled by
          Safari's back arrow returning the driver to the listing.) */}

      {/* Boost-rate confirmation modal. Triggered when a driver taps Call
          on a currently-boosted hotel. Shows the discounted nightly rate
          plus a short confirmation code the driver presents at the front
          desk. The "Call now" button inside is what actually dials AND
          logs the call (with from_boost=true). Backdrop click or × closes
          without calling. The modal is the entire UX of the "proof you
          got the boost rate" feature — drivers can screenshot it, or
          just read the code off the screen at the desk. SMS-delivery
          is a later upgrade; for now the screen IS the receipt. */}
      {boostRateModal && (() => {
        const h = boostRateModal.hotel
        const code = boostRateModal.code
        return (
          <div
            onClick={() => setBoostRateModal(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.75)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--night)', borderRadius: '16px',
                border: '2px solid var(--amber)',
                maxWidth: '420px', width: '100%',
                padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
                <span style={{
                  fontSize: '11px', background: 'rgba(245,166,35,0.15)',
                  color: 'var(--amber)', padding: '4px 10px', borderRadius: '4px',
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>★ Boost Rate</span>
                <button
                  onClick={() => setBoostRateModal(null)}
                  aria-label="Close"
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--fog)',
                    fontSize: '24px', cursor: 'pointer', lineHeight: 1, padding: 0,
                    fontFamily: 'inherit',
                  }}
                >×</button>
              </div>
              <h2 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px', color: 'var(--white)' }}>
                {h.name}
              </h2>
              <p style={{ fontSize: '18px', color: 'var(--white)', marginBottom: '20px', fontWeight: 500 }}>
                {h.boost_price ? 'Your RoadSleep rate tonight' : 'RoadSleep featured listing'}
              </p>

              {/* The rate block. With a boost_price, the dollar amount is
                  the hero. Without one, we still need to give the driver
                  something concrete to land on, so the same slot shows
                  "Call for tonight's rate" — same visual weight, different
                  message. Drivers in either case proceed to the call. */}
              <div style={{
                background: 'var(--night2)', borderRadius: '12px',
                padding: '20px', marginBottom: '16px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '14px', color: 'var(--white)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px', fontWeight: 600 }}>
                  Tonight
                </div>
                {h.boost_price ? (
                  <div style={{ fontSize: '64px', fontWeight: 800, color: 'var(--amber)', lineHeight: 1 }}>
                    ${h.boost_price}
                  </div>
                ) : (
                  <div style={{
                    fontSize: '26px', fontWeight: 800, color: 'var(--amber)',
                    lineHeight: 1.2, padding: '8px 0',
                  }}>
                    Call for<br/>tonight&apos;s rate
                  </div>
                )}
              </div>

              {/* The code. Big, readable, copy-button-style. */}
              <div style={{
                background: 'var(--night2)', borderRadius: '12px',
                padding: '16px', marginBottom: '20px', textAlign: 'center',
                border: '1px dashed var(--border)',
              }}>
                <div style={{ fontSize: '16px', color: 'var(--white)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', fontWeight: 600 }}>
                  Confirmation
                </div>
                <div style={{
                  fontSize: '48px', fontWeight: 700, color: 'var(--white)',
                  letterSpacing: '0.15em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}>
                  {code}
                </div>
                {/* Action hint pinned directly under the code — drivers see
                    the instruction at the moment they see the thing they
                    need to capture. Larger and brighter than the old
                    secondary-text caption. */}
                <p style={{
                  fontSize: '17px', color: 'var(--white)', marginTop: '14px',
                  marginBottom: 0, lineHeight: 1.35, fontWeight: 500,
                }}>
                  📸 Screenshot this screen<br/>to show at check-in
                </p>
              </div>

              {/* Action: tap to call. Plain tel: link — no JS preventDefault.
                  On iOS, programmatic window.location='tel:...' navigation
                  triggers the 'Select an app to open this tel link' picker,
                  whereas a real user-clicked <a href="tel:..."> goes straight
                  to the dialer. So we keep the <a> doing what it's designed
                  to do and use onClick only for the side effects (logCall).
                  Arrival tracking is no longer attempted here — see the SMS
                  arrival-confirmation plan in TODO.md for the replacement. */}
              <a
                href={`tel:${h.phone || ''}`}
                onClick={async () => {
                  const initialDist = h.distance ?? null
                  // Log the boost call with timestamp + initial driver distance.
                  // This is the honest proof shown on the hotelier dashboard:
                  // "Driver called from I-87 · 10.4 mi away at 5:18 PM". Real,
                  // unfakeable, captured at the moment they chose this hotel.
                  await logCall(h.id, true, initialDist)
                  // Don't close immediately — let driver come back from
                  // the dialer and still see the code at the desk.
                }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '64px', background: '#FF6A00', color: '#FFFFFF',
                  borderRadius: '12px', textDecoration: 'none',
                  fontSize: '20px', fontWeight: 600, gap: '10px',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: '22px', lineHeight: 1 }} aria-hidden="true">📞</span>
                <span>Call {h.phone || 'front desk'}</span>
              </a>
            </div>
          </div>
        )
      })()}

      <SiteFooter />
    </main>
  )
}

export const dynamic = 'force-dynamic'
