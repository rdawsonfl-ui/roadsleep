'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type Interstate } from '@/lib/supabase'
import HighwayView from './HighwayView'

const AMENITY_ICONS: Record<string, string> = {
  truck_parking: '🚛', pets: '🐾', '24hr_checkin': '🌙', wifi: '📶', pool: '🏊',
}
const AMENITY_LABELS: Record<string, string> = {
  truck_parking: 'Truck Parking', pets: 'Pets OK', '24hr_checkin': '24hr Check-in', wifi: 'WiFi', pool: 'Pool',
}
const FILTERS = ['truck_parking', 'pets', '24hr_checkin']

// Estimated road miles between two lat/lng points.
//
// We compute the great-circle (haversine) distance and then multiply by a
// circuity factor of 1.25 — the standard rule-of-thumb in trucking/logistics
// for converting straight-line ("crow flies") miles into approximate road
// miles. Real driving distances on the US interstate system run roughly
// 20–25% longer than great-circle, because roads bend around terrain,
// avoid cities, and follow established routes.
//
// This is a temporary best-effort estimate. For launch we will swap this
// out for a real routing API (Mapbox / Google Distance Matrix) which gives
// turn-by-turn-accurate distances and drive times. Until then, the badge
// is labeled "(approx)" so drivers are not misled into thinking it is
// GPS-precise.
const CIRCUITY_FACTOR = 1.25
function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959 // earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  const greatCircle = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return greatCircle * CIRCUITY_FACTOR
}

// Is the exit "ahead of" the user based on direction of travel?
function isAhead(userLat: number, userLng: number, exitLat: number, exitLng: number, direction: string): boolean {
  switch (direction) {
    case 'N': return exitLat > userLat
    case 'S': return exitLat < userLat
    case 'E': return exitLng > userLng
    case 'W': return exitLng < userLng
    default: return true
  }
}

function SearchResults() {
  const params = useSearchParams()
  const router = useRouter()
  const interstateId = params.get('interstate')
  const direction = params.get('direction') || 'N'
  const distance = parseFloat(params.get('distance') || '30')
  const userLat = parseFloat(params.get('lat') || '0')
  const userLng = parseFloat(params.get('lng') || '0')
  // True only when we have a real GPS fix from the homepage. We use this to
  // decide whether _distance values represent real miles or just mile-markers
  // — so the UI can label them correctly instead of saying "141 MI AHEAD"
  // when 141 is actually the highway mile marker, not the driver's distance.
  const hasGPS = userLat !== 0 && userLng !== 0

  const [hotels, setHotels] = useState<any[]>([])
  const [interstate, setInterstate] = useState<Interstate | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeFilters, setActiveFilters] = useState<string[]>([])
  // Two-state category toggle (no 'All') — matches homepage behavior.
  // Default = Hotels because that's where most supply is.
  const [category, setCategory] = useState<'hotel' | 'rv_park'>('hotel')

  useEffect(() => {
    if (!interstateId) return
    async function load() {
      setLoading(true)
      // Lazy boost-expiry: any boost whose end-time has passed flips back to
      // non-boosted before we read hotels. Cheap, idempotent, no cron needed.
      // Fire-and-forget — wrap in a real Promise so we can swallow errors safely.
      try { await Promise.resolve(supabase.rpc('expire_finished_boosts')) } catch { /* noop */ }
      const { data: iData } = await supabase.from('interstates').select('*').eq('id', interstateId).single()
      if (iData) setInterstate(iData)

      // Get ALL exits on this interstate in the chosen direction
      const { data: exits } = await supabase
        .from('exits')
        .select('id, mile_marker, exit_label, city, state, lat, lng')
        .eq('interstate_id', interstateId)
        .eq('direction', direction)

      if (!exits || exits.length === 0) { setHotels([]); setLoading(false); return }

      // GPS available: filter ahead within distance. No GPS: show all sorted by mile marker
      const aheadExits = hasGPS
        ? exits
            .filter(e => e.lat && e.lng)
            .map(e => ({
              ...e,
              _distance: milesBetween(userLat, userLng, Number(e.lat), Number(e.lng)),
              _ahead: isAhead(userLat, userLng, Number(e.lat), Number(e.lng), direction),
            }))
            .filter(e => e._ahead && e._distance <= distance)
            .sort((a, b) => a._distance - b._distance)
        : exits
            .map(e => ({ ...e, _distance: Number(e.mile_marker) }))
            .sort((a, b) => direction === 'S' ? b._distance - a._distance : a._distance - b._distance)

      if (aheadExits.length === 0) { setHotels([]); setLoading(false); return }

      const exitIds = aheadExits.map(e => e.id)
      // Drivers only see verified hotels. Unverified entries are still visible to admins
      // and hoteliers in their dashboards so they can be confirmed and turned on.
      // Always exclude hotels flagged as hidden (e.g. Google CLOSED_PERMANENTLY).
      const { data: hotelData } = await supabase
        .from('hotels')
        .select('*, exits(*, interstates(*))')
        .in('exit_id', exitIds)
        .eq('hidden', false)

      const enriched = (hotelData || []).map(h => {
        const exit = aheadExits.find(e => e.id === h.exit_id)
        return { ...h, _distance: exit ? exit._distance : 99 }
      }).sort((a, b) => {
        // Sort priority cascade:
        //   1. Boosted hotels first (paid placement)
        //   2. Admin-set priority (high → medium → low → unset)
        //      Used when multiple hotels sit at similar distance — driver
        //      sees the ones we know are friendly + trucker-friendly first.
        //   3. Distance (closer first)
        if (a.featured !== b.featured) return b.featured ? 1 : -1
        const pRank = (p: string | null | undefined) =>
          p === 'high' ? 0 : p === 'medium' ? 1 : p === 'low' ? 3 : 2
        const ap = pRank(a.priority), bp = pRank(b.priority)
        if (ap !== bp) return ap - bp
        return a._distance - b._distance
      })
      setHotels(enriched)
      setLoading(false)
    }
    load()
  }, [interstateId, direction, distance, userLat, userLng])

  const filtered = hotels.filter(h => {
    // Category gate first — keep only rows whose `type` matches. Existing
    // rows without a type set are treated as 'hotel' (defensive — DB default
    // is 'hotel' so this only matters for legacy data inserted pre-migration).
    const t = h.type || 'hotel'
    if (t !== category) return false
    // Then the existing amenity filter.
    return activeFilters.length === 0 || activeFilters.every(f => h.amenities?.includes(f))
  })

  const trackCall = (hotelId: string) => {
    supabase.from('call_logs').insert({
      hotel_id: hotelId,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
      referrer: typeof document !== 'undefined' ? document.referrer.slice(0, 200) : null,
    }).then(() => {})
  }
  const toggle = (f: string) => setActiveFilters(p => p.includes(f) ? p.filter(x => x !== f) : [...p, f])

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '24px 20px 48px' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => router.push('/')} style={{
            background: 'var(--night2)', border: '1px solid var(--border)', color: 'var(--fog)',
            width: '34px', height: '34px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px'
          }}>←</button>
          <div>
            <h2 style={{ fontSize: '18px', color: 'var(--white)', fontFamily: 'Syne, sans-serif' }}>
              {interstate?.name} · <span style={{ color: 'var(--amber)' }}>{direction}bound</span>
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--fog)' }}>
              Next {distance >= 9999 ? 'any distance' : `${distance} miles`} ahead
            </p>
          </div>
        </div>

        {/* Category toggle — Hotels / RV Parks. Two big thumb-size buttons,
            no 'All' option. Active = filled amber, inactive = outlined.
            Matches the homepage toggle so behavior is consistent. */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
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
                  padding: '14px 12px',
                  fontSize: '15px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  fontFamily: 'Syne, sans-serif',
                  letterSpacing: '0.3px',
                  transition: 'all 0.15s',
                  minHeight: '50px',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', overflowX: 'auto', paddingBottom: '4px' }}>
          {FILTERS.map(f => {
            const active = activeFilters.includes(f)
            return (
              <button key={f} onClick={() => toggle(f)} style={{
                background: active ? 'rgba(245,166,35,0.15)' : 'var(--night2)',
                color: active ? 'var(--amber)' : 'var(--fog)',
                border: active ? '1px solid var(--amber)' : '1px solid var(--border)',
                borderRadius: '20px', padding: '6px 14px', fontSize: '12px', fontWeight: 500,
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
              }}>
                {AMENITY_ICONS[f]} {AMENITY_LABELS[f]}
              </button>
            )
          })}
          {activeFilters.length > 0 && (
            <button onClick={() => setActiveFilters([])} style={{
              background: 'transparent', border: 'none', color: 'var(--red)', fontSize: '12px', cursor: 'pointer',
            }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--fog)' }}>
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>🛣️</div>
            Scanning the road ahead...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', background: 'var(--night2)', borderRadius: '16px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '36px', marginBottom: '10px' }}>😴</div>
            <div style={{ fontWeight: 600, color: 'var(--mist)', marginBottom: '6px' }}>No hotels ahead</div>
            <div style={{ fontSize: '13px', color: 'var(--fog)', marginBottom: '16px', padding: '0 20px' }}>
              Try expanding your distance, changing direction, or another interstate.
            </div>
            <button onClick={() => router.push('/')} className="btn-amber" style={{ padding: '10px 20px', fontSize: '13px' }}>
              NEW SEARCH
            </button>
          </div>
        ) : (
          <>
            <HighwayView
              hotels={filtered.map(h => ({ id: h.id, name: h.name, distance: h._distance, featured: h.featured }))}
              maxDistance={distance}
              direction={direction}
              onPinClick={(id) => router.push(`/hotel/${id}`)}
            />
            <p style={{ fontSize: '13px', color: 'var(--fog)', marginBottom: '12px' }}>
              {filtered.length} {category === 'rv_park' ? 'RV park' : 'hotel'}{filtered.length !== 1 ? 's' : ''} ahead · {hasGPS ? 'sorted by distance' : 'sorted by mile marker · enable location for distance'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filtered.map(hotel => {
                const exit = hotel.exits
                return (
                  <div key={hotel.id}
                    onClick={() => router.push(`/hotel/${hotel.id}`)}
                    style={{
                      background: 'var(--night2)',
                      border: hotel.featured ? '1px solid rgba(245,166,35,0.4)' : '1px solid var(--border)',
                      borderRadius: '14px', overflow: 'hidden', cursor: 'pointer',
                    }}>
                    {hotel.featured && (
                      <div style={{
                        background: 'linear-gradient(90deg, var(--amber) 0%, var(--amber2) 100%)',
                        color: 'var(--night)', padding: '4px 14px', fontSize: '10px',
                        fontWeight: 700, fontFamily: 'Syne, sans-serif', letterSpacing: '1px',
                      }}>★ BOOSTED</div>
                    )}
                    {hotel.photo_url && (
                      <img src={hotel.photo_url} alt={hotel.name} style={{ width: '100%', height: '140px', objectFit: 'cover' }}/>
                    )}
                    <div style={{ padding: '16px' }}>
                      {/* Distance + category badges row — both small inline
                          pills, distance on the left (location-y blue), category
                          on the right (neutral). RV park is a slightly different
                          shade so the eye picks it out at a glance. */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <div style={{
                          display: 'inline-block', background: 'rgba(74,158,222,0.15)', color: 'var(--blue)',
                          padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                          fontFamily: 'Syne, sans-serif', letterSpacing: '0.5px',
                        }}>
                          {hasGPS
                            ? `📍 ~${Math.round(hotel._distance)} MI (approx)`
                            : `📍 MM ${Math.round(hotel._distance)}`}
                        </div>
                        <div style={{
                          display: 'inline-block',
                          background: hotel.type === 'rv_park' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)',
                          color: hotel.type === 'rv_park' ? '#22c55e' : 'var(--fog)',
                          border: `1px solid ${hotel.type === 'rv_park' ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                          padding: '2px 9px', borderRadius: '12px', fontSize: '10px', fontWeight: 700,
                          fontFamily: 'Syne, sans-serif', letterSpacing: '0.5px', textTransform: 'uppercase',
                        }}>
                          {hotel.type === 'rv_park' ? '🚐 RV Park' : '🏨 Hotel'}
                        </div>
                      </div>

                      <div style={{ marginBottom: '8px' }}>
                        <h3 style={{ fontSize: '16px', color: 'var(--white)', fontFamily: 'Syne, sans-serif', marginBottom: '4px' }}>
                          {hotel.name}
                        </h3>
                        {/* Location line: for RV parks we show "X mi off route" since
                            they typically aren't pinned to a specific exit. For hotels
                            we keep the existing exit-label display. */}
                        {hotel.type === 'rv_park' && hotel.distance_off_route_mi != null ? (
                          <p style={{ fontSize: '11px', color: 'var(--fog)' }}>
                            {Number(hotel.distance_off_route_mi) < 1
                              ? '<1 mi off route'
                              : `${Math.round(Number(hotel.distance_off_route_mi))} mi off route`}
                          </p>
                        ) : exit ? (
                          <p style={{ fontSize: '11px', color: 'var(--fog)' }}>
                            {exit.exit_label} · {exit.city}, {exit.state}
                          </p>
                        ) : null}
                      </div>

                      {/* Regular listings never show a price. Stale rate data
                          (price_min/price_max scraped weeks/months ago) broke
                          trust and undercut the boost feature. Drivers call
                          for tonight's rate. Boost is the only price signal. */}

                      {hotel.amenities?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
                          {hotel.amenities.map((a: string) => (
                            <span key={a} style={{
                              fontSize: '10px', color: 'var(--mist)', background: 'var(--night3)',
                              padding: '3px 8px', borderRadius: '10px', border: '1px solid var(--border)',
                            }}>
                              {AMENITY_ICONS[a]} {AMENITY_LABELS[a] || a}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Boost banner — renders for any currently-boosted hotel.
                          Content adapts to whether boost_price is set:
                            - With price:  big $XX + crossed-out regular rate
                            - Without:     '★ FEATURED' label, no $ amount
                          Either way the banner pulses to draw eyes to the
                          Call button below. */}
                      {hotel.featured && (
                        <div className="boost-pulse" style={{
                          marginBottom: '10px',
                          padding: '14px 14px',
                          borderRadius: '10px',
                          // Red gradient — sale/urgency color, contrasts with amber brand
                          background: 'linear-gradient(90deg, #dc2626 0%, #b91c1c 100%)',
                          color: '#fff',
                          fontFamily: 'Syne, sans-serif',
                          fontWeight: 700,
                          textAlign: 'center',
                          boxShadow: '0 0 0 0 rgba(220,38,38,0.65)',
                        }}>
                          <span style={{
                            fontSize: '10px', letterSpacing: '1.5px', opacity: 0.9,
                            display: 'block', marginBottom: '6px',
                          }}>
                            🔥 LIMITED-TIME DEAL
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
                            {hotel.boost_price ? (
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                                <span style={{ fontSize: '28px', lineHeight: 1 }}>
                                  ${hotel.boost_price}
                                </span>
                                <span style={{ fontSize: '11px', fontWeight: 500, opacity: 0.85 }}>/ night</span>
                              </div>
                            ) : (
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

                      {hotel.phone && (
                        <a href={`tel:${hotel.phone}`}
                          onClick={(e) => { e.stopPropagation(); trackCall(hotel.id) }}
                          className="btn-amber"
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '100%', padding: '12px', fontSize: '14px', letterSpacing: '0.5px',
                            textDecoration: 'none',
                          }}>
                          📞 CALL HOTEL
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export default function SearchPage() {
  return <Suspense><SearchResults /></Suspense>
}

export const dynamic = 'force-dynamic'
