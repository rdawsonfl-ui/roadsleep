'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type Hotel, type Interstate } from '@/lib/supabase'
import Nav from '@/components/Nav'

const AMENITY_ICONS: Record<string, string> = {
  truck_parking: '🛻', pets: '🐾', '24hr_checkin': '🌙', wifi: '📶', pool: '🏊',
}
const AMENITY_LABELS: Record<string, string> = {
  truck_parking: 'Truck parking', pets: 'Pets OK', '24hr_checkin': '24hr', wifi: 'WiFi', pool: 'Pool',
}

const BADGE: Record<string, { dot: string; label: string; color: string }> = {
  available: { dot: '#3ecf8e', label: 'Likely Available', color: '#3ecf8e' },
  limited: { dot: '#f5a623', label: 'Maybe Full', color: '#f5a623' },
  full: { dot: '#ff6b6b', label: 'Often Full', color: '#ff6b6b' },
}

const FILTERS = ['truck_parking','pets','24hr_checkin']

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

      if (!exits?.length) { setHotels([]); setLoading(false); return }
      const exitIds = exits.map(e => e.id)
      const { data: hotelData } = await supabase
        .from('hotels')
        .select('*, exits(*, interstates(*))')
        .in('exit_id', exitIds)
        .order('featured', { ascending: false })

      const enriched = (hotelData || []).map(h => {
        const exit = exits.find(e => e.id === h.exit_id)
        return { ...h, _distance: exit ? Math.abs(exit.mile_marker - mile) : 99 }
      }).sort((a, b) =>
        a.featured === b.featured ? a._distance - b._distance : (b.featured ? 1 : -1)
      )

      setHotels(enriched)
      setLoading(false)
    }
    load()
  }, [interstateId, direction, mile])

  const filtered = hotels.filter(h =>
    activeFilters.length === 0 || activeFilters.every(f => h.amenities?.includes(f))
  )

  const toggle = (f: string) =>
    setActiveFilters(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])

  return (
    <div style={{ background: '#0d0f14', minHeight: '100vh' }}>
      <Nav />

      {/* Search context strip */}
      <div style={{ background: '#14171f', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
           className="px-5 py-3">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em]" style={{ color: '#8a93a8' }}>Searching</div>
            <div className="font-display text-base font-bold mt-0.5" style={{ color: '#f0f2f7' }}>
              {interstate?.name || '…'} <span style={{ color: '#f5a623' }}>{direction}</span> · MM {mile}
            </div>
          </div>
          <button onClick={() => router.push('/')}
            className="text-xs font-medium px-3 py-1.5 rounded-md"
            style={{ color: '#f5a623', background: 'rgba(245,166,35,0.1)' }}>
            Change
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-5 py-3 max-w-md mx-auto">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {FILTERS.map(f => {
            const on = activeFilters.includes(f)
            return (
              <button key={f} onClick={() => toggle(f)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all"
                style={{
                  background: on ? 'rgba(245,166,35,0.15)' : '#14171f',
                  color: on ? '#f5a623' : '#8a93a8',
                  border: `1px solid ${on ? 'rgba(245,166,35,0.35)' : 'rgba(255,255,255,0.07)'}`,
                }}>
                <span>{AMENITY_ICONS[f]}</span> {AMENITY_LABELS[f]}
              </button>
            )
          })}
          {activeFilters.length > 0 && (
            <button onClick={() => setActiveFilters([])}
              className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap"
              style={{ color: '#ff6b6b', background: 'rgba(255,107,107,0.1)' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      <main className="px-5 pb-12 max-w-md mx-auto">
        {loading ? (
          <div className="text-center py-20" style={{ color: '#8a93a8' }}>
            <div className="text-3xl mb-3">🛣️</div>
            <div className="text-sm">Searching the road ahead…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-3xl mb-3">😴</div>
            <div className="font-display font-bold mb-1" style={{ color: '#f0f2f7' }}>No hotels found</div>
            <div className="text-xs mb-5" style={{ color: '#8a93a8' }}>Try a different mile or clear filters</div>
            <button onClick={() => router.push('/')}
              className="px-5 py-2.5 rounded-lg text-sm font-bold font-display"
              style={{ background: '#f5a623', color: '#0d0f14' }}>
              New Search
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: '#8a93a8' }}>
              {filtered.length} hotel{filtered.length !== 1 ? 's' : ''} near mile {mile}
            </p>
            <div className="space-y-3">
              {filtered.map(hotel => {
                const badge = BADGE[hotel.availability_badge] || BADGE.available
                const exit = hotel.exits
                const distance = exit ? Math.abs(exit.mile_marker - mile).toFixed(1) : null
                return (
                  <div key={hotel.id}
                    onClick={() => router.push(`/hotel/${hotel.id}`)}
                    style={{
                      background: '#14171f',
                      border: hotel.featured ? '1px solid rgba(245,166,35,0.35)' : '1px solid rgba(255,255,255,0.07)',
                    }}
                    className="rounded-xl overflow-hidden cursor-pointer active:scale-[0.98] transition-transform">

                    {hotel.featured && (
                      <div className="px-3.5 py-1.5 text-[10px] font-bold font-display uppercase tracking-[0.15em]"
                           style={{ background: 'rgba(245,166,35,0.12)', color: '#f5a623' }}>
                        ★ Featured
                      </div>
                    )}

                    {hotel.photo_url && (
                      <img src={hotel.photo_url} alt={hotel.name} className="w-full h-28 object-cover"/>
                    )}

                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-display font-bold text-base leading-tight" style={{ color: '#f0f2f7' }}>
                            {hotel.name}
                          </h3>
                          {exit && (
                            <p className="text-[11px] mt-0.5" style={{ color: '#8a93a8' }}>
                              {exit.exit_label} · {exit.city}, {exit.state}
                              {distance && ` · ${distance} mi away`}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: badge.dot }}/>
                          <span className="text-[10px] font-medium" style={{ color: badge.color }}>
                            {badge.label}
                          </span>
                        </div>
                      </div>

                      {(hotel.price_min || hotel.price_max) && (
                        <div className="mb-2">
                          <span className="font-display font-bold text-lg" style={{ color: '#f5a623' }}>
                            ${hotel.price_min}–${hotel.price_max}
                          </span>
                          <span className="text-xs ml-1" style={{ color: '#8a93a8' }}>/ night</span>
                        </div>
                      )}

                      {hotel.amenities?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {hotel.amenities.map((a: string) => (
                            <span key={a} className="text-[10px] px-2 py-0.5 rounded-full"
                                  style={{ background: '#1c2030', color: '#b8c0cc' }}>
                              {AMENITY_ICONS[a]} {AMENITY_LABELS[a] || a}
                            </span>
                          ))}
                        </div>
                      )}

                      {hotel.phone && (
                        <a href={`tel:${hotel.phone}`}
                          onClick={e => e.stopPropagation()}
                          className="flex items-center justify-center w-full py-3 rounded-lg font-display font-bold text-sm transition-all active:scale-95"
                          style={{ background: '#f5a623', color: '#0d0f14', letterSpacing: '0.02em' }}>
                          📞 Call {hotel.phone}
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default function SearchPage() {
  return <Suspense><SearchResults /></Suspense>
}

export const dynamic = 'force-dynamic'
