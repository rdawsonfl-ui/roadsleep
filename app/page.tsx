'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

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

function directionsUrl(h: Hotel): string {
  const lat = h.latitude ?? h.exits?.lat
  const lng = h.longitude ?? h.exits?.lng
  if (lat && lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  }
  if (h.address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.address)}`
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
  // see results immediately without picking a distance — tap More Filters
  // to narrow if they want.
  const [distance, setDistance] = useState<'10' | '30' | '60' | '120' | 'closest'>('closest')
  // Whether the More Filters panel is expanded. Collapsed by default —
  // most drivers just want the closest option and shouldn't see clutter.
  const [showFilters, setShowFilters] = useState(false)
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [locStatus, setLocStatus] = useState<'idle' | 'asking' | 'granted' | 'denied'>('idle')
  // Two-state category toggle. We deliberately don't offer 'All' — drivers
  // who want hotels and RV parks together would just be confused by mixing
  // them, and most travelers know which they need before opening the app.
  // Default = Hotels because supply is heavier (188 vs 37) and the majority
  // of road travelers want hotels. RV users will tap the other button.
  const [category, setCategory] = useState<'hotel' | 'rv_park'>('hotel')
  // When the driver taps GO! we don't navigate immediately — we show a small
  // confirmation modal first so they can back out if they change their mind.
  // Holds the hotel they're considering. null = no modal showing.
  const [directionsTarget, setDirectionsTarget] = useState<Hotel | null>(null)

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
    ;(async () => {
      // Lazy boost-expiry: any boost whose end-time has passed flips back to
      // featured=false before we read hotels. Idempotent, no cron needed.
      try { await Promise.resolve(supabase.rpc('expire_finished_boosts')) } catch { /* noop */ }
      const { data } = await supabase
        .from('hotels')
        .select('id,name,phone,address,latitude,longitude,price_min,price_max,amenities,featured,exit_id,boost_price,boost_ends_at,type,distance_off_route_mi,near_interstate:near_interstate_id(name),exits(lat,lng,city,state,mile_marker,interstates(name))')
        .eq('verified', true)
        .limit(200)
      if (data) {
        const withNullDist: Hotel[] = (data as any[]).map((h) => ({ ...h, distance: null }))
        setHotels(withNullDist)
      }
      setLoading(false)
    })()
  }, [])

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

        {/* More Filters — collapsed by default. Default behavior is 'closest'
            (sort by distance, no cap), which is what most drivers want. Tap
            this to reveal distance caps and price filter for refinement. */}
        <div style={{ marginBottom: '16px' }}>
          <button
            onClick={() => setShowFilters(s => !s)}
            style={{
              width: '100%',
              background: showFilters ? '#dc2626' : 'transparent',
              color:      showFilters ? '#ffffff' : '#dc2626',
              border: '2px solid #dc2626',
              borderRadius: '10px',
              padding: '11px 14px',
              fontSize: '14px',
              fontWeight: 800,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              letterSpacing: '0.3px',
              transition: 'all 0.15s',
            }}
          >
            <span>
              ⚙️ More Filters
              {/* If the user has narrowed away from defaults, show a small badge
                  so they remember they're filtered. */}
              {distance !== 'closest' && (
                <span style={{
                  marginLeft: '8px',
                  background: showFilters ? '#ffffff' : '#dc2626',
                  color:      showFilters ? '#dc2626' : '#ffffff',
                  padding: '1px 7px', borderRadius: '10px', fontSize: '10px', fontWeight: 700,
                }}>
                  on
                </span>
              )}
            </span>
            <span style={{ fontSize: '11px' }}>{showFilters ? '▲' : '▼'}</span>
          </button>

          {showFilters && (
            <div style={{
              marginTop: '10px', padding: '14px',
              background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '10px',
            }}>
              {/* Distance options */}
              <label style={{ color: 'var(--fog)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.7px', display: 'block', marginBottom: '8px' }}>
                Distance
              </label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {(['closest','10','30','60','120'] as const).map((d) => (
                  <button key={d} onClick={() => setDistance(d)} style={{
                    background: distance === d ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                    color: distance === d ? 'var(--amber)' : 'var(--fog)',
                    border: distance === d ? '1px solid var(--amber)' : '1px solid var(--border)',
                    padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  }}>{d === 'closest' ? 'Any (closest first)' : `${d} mi`}</button>
                ))}
              </div>

              {/* Reset row — quick way back to defaults if a driver got narrowed
                  into a corner with zero results. */}
              {distance !== 'closest' && (
                <button
                  onClick={() => setDistance('closest')}
                  style={{
                    marginTop: '4px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--red)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>

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
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                {h.featured && <span style={{ fontSize: '10px', background: 'rgba(245,166,35,0.15)', color: 'var(--amber)', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>★ Boosted</span>}
                {/* Category pill — small inline. RV Park gets a green tint so the
                    eye picks it out at a glance when scanning a mixed list. */}
                <span style={{
                  fontSize: '10px',
                  background: h.type === 'rv_park' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)',
                  color: h.type === 'rv_park' ? '#22c55e' : 'var(--fog)',
                  padding: '2px 8px', borderRadius: '4px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  border: `1px solid ${h.type === 'rv_park' ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                }}>
                  {h.type === 'rv_park' ? '🚐 RV Park' : '🏨 Hotel'}
                </span>
                {distLabel && <span style={{ fontSize: '11px', color: 'var(--mist)', fontWeight: 600 }}>{distLabel}</span>}
                {/* Hide the inline price when boosted - it'll show in the big pulsating banner instead */}
                {!(h.featured && h.boost_price) && (
                  <span style={{ marginLeft: 'auto', color: 'var(--amber)', fontWeight: 800, fontSize: '17px', fontStyle: 'italic' }}>{price}</span>
                )}
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--white)', marginBottom: '4px' }}>{h.name}</h3>
              {exitLabel && <p style={{ fontSize: '11px', color: 'var(--fog)', marginBottom: '4px' }}>{exitLabel}</p>}
              <p style={{ fontSize: '12px', color: 'var(--fog)', marginBottom: '10px' }}>{h.address || ''}</p>
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
              <div style={{ display: 'flex', gap: '8px' }}>
                <a href={`tel:${h.phone || ''}`} onClick={() => logCall(h.id)} style={{ flex: 2.2, background: 'var(--amber)', color: '#000', padding: '13px 10px', borderRadius: '8px', fontSize: '14px', fontWeight: 700, textDecoration: 'none', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  ☎ Call Front Desk
                </a>
                {/* GO! opens a confirmation modal first so drivers can back
                    out cleanly. Tapping a regular link sends them to Google
                    Maps and they have no easy 'wait, never mind' option once
                    they leave Safari. The modal puts the brakes on. */}
                <button onClick={() => setDirectionsTarget(h)} aria-label={`Get directions to ${h.name}`} style={{ flex: 1, background: '#16a34a', color: '#fff', padding: '13px 10px', borderRadius: '8px', fontSize: '17px', fontWeight: 900, border: 'none', cursor: 'pointer', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.02em', fontFamily: 'inherit' }}>
                  GO!
                </button>
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

      {/* Directions confirmation modal — shows when driver taps GO! Gives
          them a clear chance to back out before leaving the app for Google
          Maps. The big green Open button confirms; the gray Cancel keeps
          them in roadsleep with results intact. Backdrop tap also cancels. */}
      {directionsTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="directions-title"
          onClick={() => setDirectionsTarget(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
          }}
        >
          {/* Stop click-through on the modal panel itself so taps inside don't dismiss */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--night2)',
              border: '1px solid var(--border)',
              borderRadius: '14px',
              padding: '20px',
              maxWidth: '420px',
              width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }}
          >
            <h2 id="directions-title" style={{
              fontFamily: 'Syne, sans-serif', fontSize: '18px', fontWeight: 700,
              color: 'var(--white)', marginBottom: '6px',
            }}>
              📍 Get directions?
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--mist)', marginBottom: '4px' }}>
              {directionsTarget.name}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--fog)', marginBottom: '20px' }}>
              This will open Google Maps. Tap Cancel to stay on RoadSleep.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setDirectionsTarget(null)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: 'var(--fog)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <a
                href={directionsUrl(directionsTarget)}
                onClick={() => setDirectionsTarget(null)}
                style={{
                  flex: 1.4,
                  background: '#16a34a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '14px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontFamily: 'inherit',
                  letterSpacing: '0.02em',
                }}
              >
                Open Directions
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export const dynamic = 'force-dynamic'
