'use client'
import { useState, useEffect } from 'react'
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

function directionsUrl(h: Hotel): string {
  const lat = h.latitude ?? h.exits?.lat
  const lng = h.longitude ?? h.exits?.lng
  if (lat && lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  }
  const addr = composeAddress(h)
  if (addr) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`
  }
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

  // Auto-select the corridor the driver is closest to, so they don't have
  // to figure out that the pills are interactive. Runs once when hotels +
  // GPS first become available together. Picks the interstate that owns
  // the single closest listing — almost always the road the driver is on.
  //
  // Subtlety: we deliberately key only on whether selectedInterstate is
  // null, not on userLoc movement. Otherwise driving between corridors
  // would flip the selection mid-trip — confusing if the driver is
  // already looking at a list. Once auto-set (or once the driver taps a
  // pill), we leave it alone for the session. Driver can clear & re-open
  // for a new auto-pick if they take a new route.
  useEffect(() => {
    if (interstateUserTouched) return
    if (selectedInterstate) return  // already auto-set this session
    if (!userLoc || hotels.length === 0) return
    let bestIname: string | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const h of hotels) {
      const lat = h.latitude ?? h.exits?.lat
      const lng = h.longitude ?? h.exits?.lng
      const iname = h.exits?.interstates?.name || h.near_interstate?.name
      if (lat == null || lng == null || !iname) continue
      const d = milesBetween(userLoc.lat, userLoc.lng, Number(lat), Number(lng))
      if (d < bestDist) {
        bestDist = d
        bestIname = iname
      }
    }
    if (bestIname) {
      setSelectedInterstate(bestIname)
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
      let q = supabase
        .from('hotels')
        .select('id,name,phone,address,street_address,city,state,zip,latitude,longitude,price_min,price_max,amenities,featured,exit_id,boost_price,boost_ends_at,verified,type,distance_off_route_mi,near_interstate:near_interstate_id(name),exits(lat,lng,city,state,mile_marker,interstates(name))')
        .eq('type', category)
        .not('name', 'is', null)
        .neq('name', '')
        .limit(1000)
      if (!showAll) {
        q = q.eq('verified', true)
      }
      const { data } = await q
      if (data) {
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

  let filtered = [...hotelsWithDistance]

  // GPS-based corridor filter — figure out which interstates have at least
  // one exit/listing within 200 mi of the driver. Drives the pill row below
  // so a Florida driver doesn't see I-5 or I-80, and a Seattle driver
  // doesn't see I-95. Falls back to all corridors when:
  //   - GPS denied (no userLoc to compare against)
  //   - showAllInterstates toggled on (driver tapped 'Show all')
  //   - Zero matches (driver is far from every corridor — rather show all
  //     than show nothing, e.g. trip-planning from a non-corridor city)
  // 200 mi is roughly a 3-hour drive at highway speed — captures the
  // 'where am I going next' planning horizon, not just the road I'm on.
  // Started at 75 mi but Cape Coral driver couldn't see I-10 (which is a
  // realistic same-day destination from there).
  const NEARBY_INTERSTATE_RADIUS_MI = 200
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
  // What we actually render in the pill row. If 'Show all' is on, GPS is
  // unavailable, or nothing's nearby, render every active interstate.
  let visibleInterstates: string[] =
    showAllInterstates || !userLoc || nearbyInterstateSet.size === 0
      ? INTERSTATES
      : INTERSTATES.filter(name => nearbyInterstateSet.has(name))
  // Safety: if the driver has an interstate selected that the GPS filter
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

  // Direction filter — only meaningful when GPS is available AND an
  // interstate is selected. NS interstate uses lat (Northbound = exit
  // lat > driver lat), EW uses lng (Eastbound = exit lng > driver lng).
  // Listings without coordinates are dropped when the filter is engaged
  // — better than guessing where they sit relative to the driver.
  if (selectedInterstate && selectedDirection && userLoc) {
    const axis = INTERSTATE_AXIS[selectedInterstate]
    filtered = filtered.filter((h) => {
      const lat = h.latitude ?? h.exits?.lat
      const lng = h.longitude ?? h.exits?.lng
      if (lat == null || lng == null) return false
      if (axis === 'NS') {
        return selectedDirection === 'N'
          ? Number(lat) >= userLoc.lat   // ahead going north
          : Number(lat) <= userLoc.lat   // ahead going south
      } else {
        return selectedDirection === 'E'
          ? Number(lng) >= userLoc.lng   // ahead going east
          : Number(lng) <= userLoc.lng   // ahead going west
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

  // Sort cascade. ALWAYS the same order regardless of distance preset:
  //   1. Boosted listings first (paid placement — preserved across all states)
  //   2. Distance — ascending FROM THE SLIDER TARGET. As driver slides
  //      from 100 to 500 mi, the hotel closest to 500 mi rises to the top.
  //      'Anywhere' (slider at max) reverts to plain closest-first because
  //      no target makes sense with no filter.
  //   3. Listings with no distance data sink to the end.
  filtered.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1

    // Use real distance when available, else mile marker as a deterministic
    // fallback so 'closest' is still meaningful when GPS is denied.
    const aDist = a.distance ?? a.exits?.mile_marker ?? Number.POSITIVE_INFINITY
    const bDist = b.distance ?? b.exits?.mile_marker ?? Number.POSITIVE_INFINITY

    // When slider is set ('Within X mi'), sort by absolute distance FROM
    // that target — closest-to-target rises to top. So slider at 500 puts
    // hotels around 500 mi at the top of the list, not 0 mi hotels.
    // When slider is 'Anywhere' (>= 1000), pure closest-first sort.
    if (targetDistance < 1000) {
      const aDelta = Math.abs(Number(aDist) - targetDistance)
      const bDelta = Math.abs(Number(bDist) - targetDistance)
      if (aDelta === bDelta) return 0
      return aDelta - bDelta
    }

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
              style={{
                width: '100%',
                accentColor: '#FF6A00',
                cursor: 'pointer',
              }}
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
              {targetDistance >= 1000
                ? '📍 Closest shows first'
                : `📍 Near ${targetDistance} mi shows first`}
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
                      <span>Say "RoadSleep"<br/>for this price</span>
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
                  href={directionsUrl(h)}
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
