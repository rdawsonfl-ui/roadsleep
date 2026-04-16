'use client'
import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, type Hotel, type Interstate } from '@/lib/supabase'
import { Suspense } from 'react'

const AMENITY_ICONS: Record<string, string> = {
  truck_parking: '🚛',
  pets: '🐾',
  '24hr_checkin': '🌙',
  wifi: '📶',
  pool: '🏊',
}
const AMENITY_LABELS: Record<string, string> = {
  truck_parking: 'Truck Parking',
  pets: 'Pets OK',
  '24hr_checkin': '24hr Check-in',
  wifi: 'WiFi',
  pool: 'Pool',
}

const BADGE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  available: { bg: '#dcfce7', color: '#166534', label: 'Available' },
  limited: { bg: '#fef9c3', color: '#854d0e', label: 'Limited' },
  full: { bg: '#fee2e2', color: '#991b1b', label: 'Full' },
}

const FILTERS = ['truck_parking', 'pets', '24hr_checkin']

function SearchResults() {
  const params = useSearchParams()
  const router = useRouter()
  const interstateId = params.get('interstate')
  const direction = params.get('direction')
  const mile = parseFloat(params.get('mile') || '0')

  const [hotels, setHotels] = useState<Hotel[]>([])
  const [interstate, setInterstate] = useState<Interstate | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeFilters, setActiveFilters] = useState<string[]>([])

  useEffect(() => {
    if (!interstateId || !direction || !mile) return

    async function load() {
      setLoading(true)
      // Get interstate name
      const { data: iData } = await supabase.from('interstates').select('*').eq('id', interstateId).single()
      if (iData) setInterstate(iData)

      // Find exits within 10 miles
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

      // Attach exit data and sort by distance
      const enriched = (hotelData || []).map(h => {
        const exit = exits.find(e => e.id === h.exit_id)
        return { ...h, _distance: exit ? Math.abs(exit.mile_marker - mile) : 99 }
      }).sort((a, b) => a.featured === b.featured ? a._distance - b._distance : (b.featured ? 1 : -1))

      setHotels(enriched)
      setLoading(false)
    }
    load()
  }, [interstateId, direction, mile])

  const filtered = hotels.filter(h =>
    activeFilters.length === 0 || activeFilters.every(f => h.amenities?.includes(f))
  )

  const toggleFilter = (f: string) => {
    setActiveFilters(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f5f0e8' }}>
      {/* Header */}
      <header style={{ background: '#1a1a1a' }} className="px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.push('/')} className="text-gray-400 hover:text-white transition-colors text-xl">←</button>
        <div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '22px', fontWeight: 800, color: 'white', letterSpacing: '0.05em' }}>
            ROAD<span style={{ color: '#f5c842' }}>SLEEP</span>
          </div>
          {interstate && (
            <div className="text-xs text-gray-400">{interstate.name} · {direction}bound · Mile {mile}</div>
          )}
        </div>
      </header>
      <div className="road-stripe" />

      {/* Filters */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 flex gap-2 overflow-x-auto">
        {FILTERS.map(f => (
          <button key={f} onClick={() => toggleFilter(f)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
            style={{
              background: activeFilters.includes(f) ? '#2c6e49' : '#f3f4f6',
              color: activeFilters.includes(f) ? 'white' : '#6b7280'
            }}>
            {AMENITY_ICONS[f]} {AMENITY_LABELS[f]}
          </button>
        ))}
        {activeFilters.length > 0 && (
          <button onClick={() => setActiveFilters([])} className="px-3 py-1.5 rounded-full text-xs font-semibold text-red-500 bg-red-50 whitespace-nowrap">
            Clear
          </button>
        )}
      </div>

      <main className="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
        {loading ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🛣️</div>
            <div>Searching nearby hotels...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">😴</div>
            <div className="font-semibold text-gray-700 mb-1">No hotels found</div>
            <div className="text-sm text-gray-400">Try adjusting your mile marker or removing filters</div>
            <button onClick={() => router.push('/')} className="mt-4 px-5 py-2 rounded-xl text-white text-sm font-semibold" style={{ background: '#2c6e49' }}>
              New Search
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">{filtered.length} hotel{filtered.length !== 1 ? 's' : ''} near mile {mile}</p>
            <div className="space-y-3">
              {filtered.map(hotel => {
                const badge = BADGE_STYLES[hotel.availability_badge] || BADGE_STYLES.available
                const exit = (hotel as any).exits
                const distance = exit ? Math.abs(exit.mile_marker - mile).toFixed(1) : null
                return (
                  <div key={hotel.id}
                    onClick={() => router.push(`/hotel/${hotel.id}`)}
                    className="bg-white rounded-2xl shadow-sm overflow-hidden cursor-pointer active:scale-98 transition-transform">
                    {hotel.featured && (
                      <div className="px-4 py-1.5 text-xs font-bold" style={{ background: '#f5c842', color: '#1a1a1a', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.05em' }}>
                        ⭐ FEATURED
                      </div>
                    )}
                    {hotel.photo_url && (
                      <img src={hotel.photo_url} alt={hotel.name} className="w-full h-32 object-cover"/>
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <h3 className="font-bold text-gray-900 text-base leading-tight">{hotel.name}</h3>
                          {exit && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {exit.exit_label} · {exit.city}, {exit.state}
                              {distance && ` · ${distance} mi away`}
                            </p>
                          )}
                        </div>
                        <span className="text-xs font-semibold px-2 py-1 rounded-full shrink-0" style={{ background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                      </div>

                      {(hotel.price_min || hotel.price_max) && (
                        <p className="text-lg font-black text-gray-900 mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                          ${hotel.price_min}–${hotel.price_max}<span className="text-xs font-normal text-gray-400">/night</span>
                        </p>
                      )}

                      {hotel.amenities?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {hotel.amenities.map(a => (
                            <span key={a} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {AMENITY_ICONS[a]} {AMENITY_LABELS[a] || a}
                            </span>
                          ))}
                        </div>
                      )}

                      {hotel.phone && (
                        <a href={`tel:${hotel.phone}`}
                          onClick={e => e.stopPropagation()}
                          className="flex items-center justify-center w-full py-3 rounded-xl text-white font-black text-lg transition-all active:scale-95"
                          style={{ background: '#2c6e49', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.05em' }}>
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
      </main>
      <div className="road-stripe" />
    </div>
  )
}

export default function SearchPage() {
  return <Suspense><SearchResults /></Suspense>
}

export const dynamic = 'force-dynamic'
