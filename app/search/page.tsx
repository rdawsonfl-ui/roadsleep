'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type Hotel, type Interstate } from '@/lib/supabase'

const AMENITY_ICONS: Record<string, string> = {
  truck_parking: '🚛', pets: '🐾', '24hr_checkin': '🌙', wifi: '📶', pool: '🏊',
}
const AMENITY_LABELS: Record<string, string> = {
  truck_parking: 'Truck Parking', pets: 'Pets OK', '24hr_checkin': '24hr Check-in', wifi: 'WiFi', pool: 'Pool',
}
const BADGE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  available: { bg: 'rgba(62,207,142,0.15)', color: '#3ecf8e', label: '🟢 Likely Available' },
  limited: { bg: 'rgba(245,166,35,0.15)', color: '#f5a623', label: '🟡 Maybe Full' },
  full: { bg: 'rgba(255,107,107,0.15)', color: '#ff6b6b', label: '🔴 Often Full' },
}
const FILTERS = ['truck_parking', 'pets', '24hr_checkin']

function SearchResults() {
  const params = useSearchParams()
  const router = useRouter()
  const interstateId = params.get('interstate')
  const direction = params.get('direction')
  const mile = parseFloat(params.get('mile') || '0')

  const [hotels, setHotels] = useState<any[]>([])
  const [interstate, setInterstate] = useState<Interstate | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeFilters, setActiveFilters] = useState<string[]>([])

  useEffect(() => {
    if (!interstateId || !direction || !mile) return
    async function load() {
      setLoading(true)
      const { data: iData } = await supabase.from('interstates').select('*').eq('id', interstateId).single()
      if (iData) setInterstate(iData)

      const { data: exits } = await supabase
        .from('exits')
        .select('id, mile_marker, exit_label, city, state')
        .eq('interstate_id', interstateId)
        .eq('direction', direction)
        .gte('mile_marker', mile - 10)
        .lte('mile_marker', mile + 10)

      if (!exits || exits.length === 0) { setHotels([]); setLoading(false); return }
      const exitIds = exits.map(e => e.id)
      const { data: hotelData } = await supabase
        .from('hotels')
        .select('*, exits(*, interstates(*))')
        .in('exit_id', exitIds)
        .order('featured', { ascending: false })

      const enriched = (hotelData || []).map(h => {
        const exit = exits.find(e => e.id === h.exit_id)
        return { ...h, _distance: exit ? Math.abs(exit.mile_marker - mile) : 99 }
      }).sort((a, b) => a.featured === b.featured ? a._distance - b._distance : (b.featured ? 1 : -1))
      setHotels(enriched)
      setLoading(false)
    }
    load()
  }, [interstateId, direction, mile])

  const filtered = hotels.filter(h => activeFilters.length === 0 || activeFilters.every(f => h.amenities?.includes(f)))
  const toggle = (f: string) => setActiveFilters(p => p.includes(f) ? p.filter(x => x !== f) : [...p, f])

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '24px 20px 48px' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        {/* Header info */}
        <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => router.push('/')} style={{
            background: 'var(--night2)', border: '1px solid var(--border)', color: 'var(--fog)',
            width: '34px', height: '34px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px'
          }}>←</button>
          <div>
            <h2 style={{ fontSize: '18px', color: 'var(--white)', fontFamily: 'Syne, sans-serif' }}>
              {interstate?.name} · <span style={{ color: 'var(--amber)' }}>{direction}bound</span>
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--fog)' }}>Mile marker {mile} · ±10 mi</p>
          </div>
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
            Searching nearby hotels...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', background: 'var(--night2)', borderRadius: '16px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '36px', marginBottom: '10px' }}>😴</div>
            <div style={{ fontWeight: 600, color: 'var(--mist)', marginBottom: '6px' }}>No hotels found</div>
            <div style={{ fontSize: '13px', color: 'var(--fog)', marginBottom: '16px' }}>Try adjusting your mile marker or filters</div>
            <button onClick={() => router.push('/')} className="btn-amber" style={{ padding: '10px 20px', fontSize: '13px' }}>
              NEW SEARCH
            </button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: '13px', color: 'var(--fog)', marginBottom: '12px' }}>
              {filtered.length} hotel{filtered.length !== 1 ? 's' : ''} near mile {mile}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filtered.map(hotel => {
                const badge = BADGE_STYLES[hotel.availability_badge] || BADGE_STYLES.available
                const exit = hotel.exits
                const distance = exit ? Math.abs(exit.mile_marker - mile).toFixed(1) : null
                return (
                  <div key={hotel.id}
                    onClick={() => router.push(`/hotel/${hotel.id}`)}
                    style={{
                      background: 'var(--night2)',
                      border: hotel.featured ? '1px solid rgba(245,166,35,0.4)' : '1px solid var(--border)',
                      borderRadius: '14px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'transform 0.12s',
                    }}>
                    {hotel.featured && (
                      <div style={{
                        background: 'linear-gradient(90deg, var(--amber) 0%, var(--amber2) 100%)',
                        color: 'var(--night)',
                        padding: '4px 14px',
                        fontSize: '10px',
                        fontWeight: 700,
                        fontFamily: 'Syne, sans-serif',
                        letterSpacing: '1px',
                      }}>★ FEATURED</div>
                    )}
                    {hotel.photo_url && (
                      <img src={hotel.photo_url} alt={hotel.name} style={{ width: '100%', height: '140px', objectFit: 'cover' }}/>
                    )}
                    <div style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <h3 style={{ fontSize: '16px', color: 'var(--white)', fontFamily: 'Syne, sans-serif', marginBottom: '4px' }}>
                            {hotel.name}
                          </h3>
                          {exit && (
                            <p style={{ fontSize: '11px', color: 'var(--fog)' }}>
                              {exit.exit_label} · {exit.city}, {exit.state}{distance && ` · ${distance} mi`}
                            </p>
                          )}
                        </div>
                        <span style={{
                          fontSize: '10px', fontWeight: 600, padding: '4px 8px', borderRadius: '12px',
                          background: badge.bg, color: badge.color, whiteSpace: 'nowrap',
                        }}>{badge.label}</span>
                      </div>

                      {(hotel.price_min || hotel.price_max) && (
                        <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: 'var(--amber)', marginBottom: '10px' }}>
                          ${hotel.price_min}–${hotel.price_max}
                          <span style={{ fontSize: '11px', color: 'var(--fog)', fontWeight: 400, marginLeft: '4px' }}>/ night</span>
                        </div>
                      )}

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

                      {hotel.phone && (
                        <a href={`tel:${hotel.phone}`}
                          onClick={e => e.stopPropagation()}
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
