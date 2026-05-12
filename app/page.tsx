'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import SiteFooter from '@/app/components/SiteFooter'
import { getDrivingDistances } from '@/lib/mapbox'

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
  exits?: { lat: number | null; lng: number | null; city: string | null; state: string | null; mile_marker: number | null; interstates?: { name: string | null } | null } | null
  distance: number | null
}

/** Build a single-line address from the structured fields, falling back
 *  to the legacy 'address' column. Used for both card display and the
 *  directions URL. Skips empty parts gracefully so we don't end up with
 *  ugly leading commas or double-spaces. */
function composeAddress(h: Hotel): string {
  const parts = [
    h.street_address?.trim(),
    h.city?.trim(),
    [h.state?.trim(), h.zip?.trim()].filter(Boolean).join(' ').trim(),
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

async function logCall(hotelId: string) {
  try {
    await supabase.from('call_logs').insert({
      hotel_id: hotelId,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    })
  } catch (e) {
    console.error('call log failed', e)
  }
}

export default function HomePage() {
  const [hotels, setHotels] = useState<Hotel[]>([])
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
  // Empty/unseeded corridors (I-4, I-5, I-20, I-30, I-85) have no entries
  // because their exits aren't yet in the DB — handled correctly by the
  // filter (those corridors have no listings to show anyway).
  type Intersection = { lat: number; lng: number; nearCity: string }
  const INTERSTATE_INTERSECTIONS: Record<string, Record<string, Intersection>> = {
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
    if (interstateUserTouched) return
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
      const baseSelect = 'id,name,phone,address,street_address,city,state,zip,latitude,longitude,price_min,price_max,amenities,featured,exit_id,boost_price,boost_ends_at,verified,type,distance_off_route_mi,near_interstate:near_interstate_id(name),exits(lat,lng,city,state,mile_marker,interstates(name))'
      const buildQuery = (start: number, end: number) => {
        let q = supabase
          .from('hotels')
          .select(baseSelect)
          .eq('type', category)
          .not('name', 'is', null)
          .neq('name', '')
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
      const mm = h.exits?.mile_marker
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
      const mm = h.exits?.mile_marker
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
  const NEARBY_INTERSTATE_RADIUS_MI =
    targetDistance >= 1000 ? Number.POSITIVE_INFINITY : Math.max(targetDistance, 200)
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

  // What we actually render in the pill row. Three layers, in priority order:
  //   1. showAllInterstates ON, GPS off, or no nearby matches -> ALL corridors
  //   2. selectedInterstate set + intersection map known -> intersection set
  //      (the route-aware filter — selected corridor + corridors that cross
  //       it within slider range ahead)
  //   3. otherwise -> nearby distance set (existing behavior — corridors
  //      with any listing within slider range)
  let visibleInterstates: string[]
  if (showAllInterstates || !userLoc || (nearbyInterstateSet.size === 0 && !intersectionInterstateSet)) {
    visibleInterstates = INTERSTATES
  } else if (intersectionInterstateSet) {
    visibleInterstates = INTERSTATES.filter(name => intersectionInterstateSet.has(name))
  } else {
    visibleInterstates = INTERSTATES.filter(name => nearbyInterstateSet.has(name))
  }
  // Safety: if the driver has an interstate selected that the pill filter
  // would otherwise hide (e.g. they picked I-5 then GPS resolved them in
  // Florida), keep that pill visible so they can still deselect it.
  if (selectedInterstate && !visibleInterstates.includes(selectedInterstate) && INTERSTATES.includes(selectedInterstate)) {
    visibleInterstates = [...visibleInterstates, selectedInterstate].sort()
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

    filtered = filtered.filter((h) => {
      const lat = h.latitude ?? h.exits?.lat
      const lng = h.longitude ?? h.exits?.lng
      const hMM = h.exits?.mile_marker
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
        // mmAxisSign tells us which cardinal MM grows toward (within the
        // corridor's axis). If MM grows toward the same cardinal the driver
        // is going, ahead = higher MM. Otherwise ahead = lower MM.
        const mmGrowsWithDriver = (driverGoesPositive && mmAxisSign === 1)
                                || (!driverGoesPositive && mmAxisSign === -1)
        const signed = mmGrowsWithDriver
          ? Number(hMM) - userMM
          : userMM - Number(hMM)
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

  // Sort cascade. Always closest-first.
  //   1. Boosted listings first (paid placement — preserved across all states)
  //   2. Distance ascending — closest hotel to the driver rises to top.
  //   3. Listings with no distance data sink to the end.
  //
  // (Previously the sort was "distance-from-slider-target" — slider at 500
  // put hotels around 500 mi at the top. That confused drivers who expected
  // a normal closest-first list. Slider is now pure max-cap; ranking is
  // pure closest-first.)
  filtered.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1

    // Use real distance when available, else mile marker as a deterministic
    // fallback so 'closest' is still meaningful when GPS is denied.
    const aDist = a.distance ?? a.exits?.mile_marker ?? Number.POSITIVE_INFINITY
    const bDist = b.distance ?? b.exits?.mile_marker ?? Number.POSITIVE_INFINITY

    if (aDist === bDist) return 0
    return Number(aDist) - Number(bDist)
  })

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '20px 16px 48px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        {/* Title + subtitle adapt to the active category. Hotels typically
            sit AT exits (their whole business model is catching tired drivers
            exiting the highway), so 'next exit' is accurate for hotels. RV
            parks sit OFF the highway, often 5–20 mi out, so 'next exit' is
            misleading for them — instead we say 'ahead on your route' since
            we surface them sorted by closeness to the driver's route. */}
        <h1 style={{ fontSize: '26px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '4px' }}>
          {category === 'rv_park' ? (
            <>RV Parks <span style={{ color: 'var(--amber)' }}>ahead on your route</span></>
          ) : (
            <>Hotels at your <span style={{ color: 'var(--amber)' }}>next exit</span></>
          )}
        </h1>
        <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '20px' }}>
          {category === 'rv_park'
            ? 'RV parks within driving distance of your interstate'
            : 'Hotels along major interstates'}
        </p>

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
                  if (active) {
                    setSelectedInterstate(null)
                    setSelectedDirection(null)
                  } else {
                    setSelectedInterstate(iname)
                    setSelectedDirection(null)  // reset direction on switch
                  }
                }}
                style={{
                  background: active ? 'var(--amber)' : 'rgba(255,255,255,0.04)',
                  color:      active ? '#ffffff'     : 'var(--mist)',
                  border:     '1px solid ' + (active ? 'var(--amber)' : 'rgba(255,255,255,0.25)'),
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
                    color:      active ? '#fff'    : '#22c55e',
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
          const price = h.price_min ? `$${h.price_min}${h.price_max ? `-$${h.price_max}` : ''}` : 'Call'
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
            return h.exits ? `${h.exits.interstates?.name || ''} · MM ${h.exits.mile_marker} · ${h.exits.city}, ${h.exits.state}` : null
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
                {/* Hide the inline price when boosted - it'll show in the big pulsating banner instead */}
                {!(h.featured && h.boost_price) && (
                  <span style={{ marginLeft: 'auto', color: 'var(--amber)', fontWeight: 800, fontSize: '17px', fontStyle: 'italic' }}>{price}</span>
                )}
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
              {/* Pulsating discount banner — only renders when hotelier has an active boost
                  AND has set a discount price. Big discount price + regular rate strike-through.
                  Sits directly above the Call button to drive eyes to the price → CTA pair. */}
              {h.featured && h.boost_price && (
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
                  {/* Price stays centered/hero. Pitch sits to the right of the price block,
                      3× the size of the original 11px message, dark navy on red, with a
                      left arrow tying it back to the price. */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      <span style={{ fontSize: '28px', lineHeight: 1 }}>${h.boost_price}</span>
                      {h.price_min && h.price_min > h.boost_price && (
                        <span style={{ fontSize: '14px', textDecoration: 'line-through', opacity: 0.75, fontWeight: 600 }}>
                          ${h.price_min}
                        </span>
                      )}
                      <span style={{ fontSize: '11px', fontWeight: 500, opacity: 0.85 }}>/ night</span>
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      color: 'var(--night)', fontFamily: 'DM Sans, sans-serif', fontWeight: 800,
                      fontSize: '18px', lineHeight: 1.1, textAlign: 'left',
                    }}>
                      <span style={{ fontSize: '24px', lineHeight: 1 }} aria-hidden="true">←</span>
                      <span>Say "boost"<br/>for this price</span>
                    </div>
                  </div>
                </div>
              )}
              {/* Trust signal — small green confirmation that the front desk
                  has been called and verified. Only renders when verified=true.
                  Sits directly above the action row so it directly modifies
                  the perceived legitimacy of the Call button. NOT bold per
                  spec; small text, secondary visual weight. */}
              {h.verified && (
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
                <a
                  href={`tel:${h.phone || ''}`}
                  onClick={() => logCall(h.id)}
                  aria-label={`Call ${h.name}`}
                  style={{
                    flex: 2,                          // ~67% of row
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
      <SiteFooter />
    </main>
  )
}

export const dynamic = 'force-dynamic'
