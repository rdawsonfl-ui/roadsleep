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
  const [maxPrice, setMaxPrice] = useState(200)
  const [distance, setDistance] = useState<'10' | '30' | '60' | 'closest'>('30')
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [locStatus, setLocStatus] = useState<'idle' | 'asking' | 'granted' | 'denied'>('idle')
  // Category toggle — All shows everything; Hotels/RV Parks restrict by type.
  // Default is 'all' so we don't hide anything by accident on first load.
  const [category, setCategory] = useState<'all' | 'hotel' | 'rv_park'>('all')

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
        .select('id,name,phone,address,latitude,longitude,price_min,price_max,amenities,featured,exit_id,boost_price,boost_ends_at,type,exits(lat,lng,city,state,mile_marker,interstates(name))')
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
      dist = milesBetween(userLoc.lat, userLoc.lng, Number(hLat), Number(hLng))
    }
    return { ...h, distance: dist }
  })

  let filtered = hotelsWithDistance.filter((h) => !h.price_min || h.price_min <= maxPrice)

  // Category gate — 'all' lets everything pass; otherwise restrict by type.
  // Treat null/undefined type as 'hotel' (DB default) so legacy rows aren't
  // accidentally hidden when the driver picks Hotels.
  if (category !== 'all') {
    filtered = filtered.filter((h) => (h.type || 'hotel') === category)
  }

  if (userLoc) {
    if (distance === '10') {
      filtered = filtered.filter((h) => h.distance !== null && (h.distance as number) <= 10)
    } else if (distance === '30') {
      filtered = filtered.filter((h) => h.distance !== null && (h.distance as number) <= 30)
    } else if (distance === '60') {
      filtered = filtered.filter((h) => h.distance !== null && (h.distance as number) <= 60)
    }
  }

  if (userLoc && distance === 'closest') {
    filtered.sort((a, b) => {
      if (a.distance === null) return 1
      if (b.distance === null) return -1
      return (a.distance as number) - (b.distance as number)
    })
  } else {
    filtered.sort((a, b) => {
      if (a.featured && !b.featured) return -1
      if (!a.featured && b.featured) return 1
      if (a.distance !== null && b.distance !== null) {
        return (a.distance as number) - (b.distance as number)
      }
      return 0
    })
  }

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '20px 16px 48px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '26px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '4px' }}>
          {category === 'rv_park' ? 'RV Parks' : category === 'hotel' ? 'Hotels' : 'Hotels & RV parks'} at your <span style={{ color: 'var(--amber)' }}>next exit</span>
        </h1>
        <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '20px' }}>
          {category === 'rv_park' ? 'RV parks along major interstates' : category === 'hotel' ? 'Hotels along major interstates' : 'Hotels and RV parks along major interstates'}
        </p>

        {locStatus === 'denied' && (
          <div style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid var(--amber)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: 'var(--mist)' }}>
            📍 Location blocked. Distance filtering disabled. <button onClick={() => window.location.reload()} style={{ background: 'none', border: 'none', color: 'var(--amber)', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>Enable GPS</button> to see nearest hotels.
          </div>
        )}

        {/* Category toggle — All / Hotels / RV Parks. Three equal-width
            pill buttons. Active state uses the same amber accent the rest
            of the page already uses for selection so it feels native. */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
          {([
            { key: 'all',     label: 'All' },
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
                  background: active ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                  color: active ? 'var(--amber)' : 'var(--fog)',
                  border: active ? '1px solid var(--amber)' : '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '10px 6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'Syne, sans-serif',
                  letterSpacing: '0.3px',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: 'var(--fog)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.7px', display: 'block', marginBottom: '6px' }}>Distance</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(['10','30','60','closest'] as const).map((d) => (
              <button key={d} onClick={() => setDistance(d)} style={{
                background: distance === d ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                color: distance === d ? 'var(--amber)' : 'var(--fog)',
                border: distance === d ? '1px solid var(--amber)' : '1px solid var(--border)',
                padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              }}>{d === 'closest' ? 'Closest' : `${d} mi`}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <div style={{ color: 'var(--fog)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '6px' }}>
            Max price: <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: '13px' }}>${maxPrice}</span>
          </div>
          <input type="range" min="50" max="300" value={maxPrice} onChange={(e) => setMaxPrice(parseInt(e.target.value))} style={{ width: '100%', accentColor: 'var(--amber)' }} />
        </div>

        <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '14px' }}>
          {loading
            ? 'Loading...'
            : locStatus === 'asking'
              ? 'Getting your location...'
              : `${filtered.length} ${category === 'rv_park' ? 'RV park' : category === 'hotel' ? 'hotel' : 'place'}${filtered.length !== 1 ? 's' : ''} found`}
        </p>

        {filtered.map((h) => {
          const price = h.price_min ? `$${h.price_min}${h.price_max ? `-$${h.price_max}` : ''}` : 'Call'
          const distLabel = h.distance !== null ? `${Math.round(h.distance as number)} mi away` : null
          const exitLabel = h.exits ? `${h.exits.interstates?.name || ''} · MM ${h.exits.mile_marker} · ${h.exits.city}, ${h.exits.state}` : null
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
                <a href={directionsUrl(h)} target="_blank" rel="noopener noreferrer" aria-label={`Get directions to ${h.name}`} style={{ flex: 1, background: '#16a34a', color: '#fff', padding: '13px 10px', borderRadius: '8px', fontSize: '17px', fontWeight: 900, textDecoration: 'none', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.02em' }}>
                  GO!
                </a>
              </div>
            </div>
          )
        })}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fog)', fontSize: '13px' }}>
            🛣️ No {category === 'rv_park' ? 'RV parks' : category === 'hotel' ? 'hotels' : 'places'} found. Try expanding your distance filter{category !== 'all' ? ' or switching to All' : ''}.
          </div>
        )}
      </div>
    </main>
  )
}

export const dynamic = 'force-dynamic'
