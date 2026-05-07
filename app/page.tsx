'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import SiteFooter from '@/app/components/SiteFooter'

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
  // the 150-250 mi band. Default 1000 = max value = 'Anywhere' (no filter).
  // Renamed from maxDistance to make the semantics clear in code.
  const [targetDistance, setTargetDistance] = useState<number>(1000)
  // ±50 mi window around the target. Wide enough that drivers see real
  // options at every slider position; narrow enough that the band feels
  // intentional. Drivers planning a 4-hr stop care about a stretch, not
  // a single milepost.
  const DISTANCE_WINDOW = 50

  // Interstate filter — when set, only listings on this interstate show.
  // Default null = no filter (current behavior, all corridors mixed).
  // Driver picks one to scope their search to a specific corridor.
  const [selectedInterstate, setSelectedInterstate] = useState<string | null>(null)
  // Direction filter — only meaningful after an interstate is selected.
  // 'N'/'S' for north-south interstates, 'E'/'W' for east-west. We use
  // GPS lat (for NS) or lng (for EW) to figure out which exits are
  // 'ahead' of the driver and hide the rest. Null = both directions.
  const [selectedDirection, setSelectedDirection] = useState<'N'|'S'|'E'|'W'|null>(null)

  // Orientation map for our 6 corridors. Determines whether the direction
  // row shows NB/SB or EB/WB buttons. North-south = compares lat to
  // driver's lat. East-west = compares lng to driver's lng.
  const INTERSTATE_AXIS: Record<string, 'NS' | 'EW'> = {
    'I-10': 'EW',
    'I-40': 'EW',
    'I-80': 'EW',
    'I-75': 'NS',
    'I-87': 'NS',
    'I-95': 'NS',
  }
  const INTERSTATES = ['I-10', 'I-40', 'I-75', 'I-80', 'I-87', 'I-95']
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [locStatus, setLocStatus] = useState<'idle' | 'asking' | 'granted' | 'denied'>('idle')
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
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocStatus('granted')
      },
      () => setLocStatus('denied'),
      { timeout: 10000, maximumAge: 300000 }
    )
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

  const hotelsWithDistance: Hotel[] = hotels.map((h) => {
    const hLat = h.latitude ?? h.exits?.lat
    const hLng = h.longitude ?? h.exits?.lng
    let dist: number | null = null
    if (userLoc && hLat && hLng) {
      // Apply the 1.25 circuity factor here too, so homepage distances
      // match the /search page and roughly approximate driving miles
      // instead of straight-line ('as the crow flies') miles.
      dist = milesBetween(userLoc.lat, userLoc.lng, Number(hLat), Number(hLng)) * 1.25
    }
    return { ...h, distance: dist }
  })

  let filtered = [...hotelsWithDistance]

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
    // Slider window. 1000+ effectively means 'no filter' (Anywhere) so we
    // skip when the driver leaves it at max. Otherwise we show hotels in
    // a ±DISTANCE_WINDOW band around the target — sliding to 200 surfaces
    // hotels around the 200-mile mark instead of capping at 200. This is
    // what a driver planning a stop in 4 hours actually wants.
    if (targetDistance < 1000) {
      const lo = Math.max(0, targetDistance - DISTANCE_WINDOW)
      const hi = targetDistance + DISTANCE_WINDOW
      filtered = filtered.filter((h) => {
        if (h.distance === null) return false
        const d = h.distance as number
        return d >= lo && d <= hi
      })
    }
  }

  // Sort cascade. ALWAYS the same order regardless of distance preset:
  //   1. Boosted listings first (paid placement — preserved across all states)
  //   2. Distance — ascending. With GPS this is real miles. Without GPS we
  //      fall back to mile marker so the list isn't a random mess.
  //   3. Listings with no distance data sink to the end.
  // Old code special-cased 'closest' and stripped the boost-first behavior;
  // that contradicted the rest of the app's Boost->Priority->Distance cascade.
  // Now Closest is just the default sort, applied always.
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
            { key: 'hotel',   label: '🏨 Hotels' },
            { key: 'rv_park', label: '🚐 RV Parks' },
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
                  fontSize: '16px',
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

        {/* Closest button — small, centered, sits between the big category
            toggle and the More Filters dropdown. Filled when active (default
            state), outlined when user has narrowed to a specific distance.
            Tapping it always resets distance to 'closest'. Width is roughly
            half the category buttons, lined up under them.
            When GPS is denied we still show this button (since 'closest' is
            still the default sort) but we hint that the sort is by mile
            marker rather than real distance — honest with the driver. */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
          <button
            onClick={() => setDistance('closest')}
            title={userLoc
              ? 'Sort by closest first (real distance from your location)'
              : 'Sort by mile marker (GPS not available)'}
            style={{
              width: '48%',
              background: distance === 'closest' ? '#22c55e' : 'transparent',
              color:      distance === 'closest' ? '#ffffff' : '#22c55e',
              border: '2px solid #22c55e',
              borderRadius: '10px',
              padding: '10px 12px',
              fontSize: '14px',
              fontWeight: 900,
              cursor: 'pointer',
              fontFamily: 'Syne, sans-serif',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              minHeight: '40px',
              transition: 'all 0.15s',
            }}
          >
            📍 Closest
          </button>
        </div>

        {/* Interstate filter row. Single-select. Tapping the same one
            again deselects (and clears direction). All buttons same
            style — small outlined pills. Selected one fills with amber.
            Sits above the direction row + slider so the flow reads
            top-down: pick route → pick direction → pick distance. */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          marginBottom: selectedInterstate ? '8px' : '16px',
          justifyContent: 'center',
        }}>
          {INTERSTATES.map(iname => {
            const active = selectedInterstate === iname
            return (
              <button
                key={iname}
                onClick={() => {
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
                  color:      active ? '#000'        : 'var(--mist)',
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
              <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: '14px' }}>
                {targetDistance >= 1000
                  ? 'Anywhere'
                  : `${targetDistance} mi ahead`}
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
                accentColor: 'var(--amber)',
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

        <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '14px' }}>
          {loading
            ? 'Loading...'
            : locStatus === 'asking'
              ? 'Getting your location...'
              : `${filtered.length} ${category === 'rv_park' ? 'RV park' : 'hotel'}${filtered.length !== 1 ? 's' : ''} found`}
        </p>

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
                {/* Category pill — sized up so drivers can read the
                    Hotel/RV Park label at a glance without leaning in. */}
                <span style={{
                  fontSize: '13px',
                  background: h.type === 'rv_park' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)',
                  color: h.type === 'rv_park' ? '#22c55e' : 'var(--mist)',
                  padding: '4px 10px', borderRadius: '6px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  border: `1px solid ${h.type === 'rv_park' ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                }}>
                  {h.type === 'rv_park' ? '🚐 RV Park' : '🏨 Hotel'}
                </span>
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
