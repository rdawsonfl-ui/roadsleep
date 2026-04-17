'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, type Hotel } from '@/lib/supabase'
import Nav from '@/components/Nav'

const AMENITY_ICONS: Record<string, string> = {
  truck_parking: '🛻', pets: '🐾', '24hr_checkin': '🌙', wifi: '📶', pool: '🏊',
}
const AMENITY_LABELS: Record<string, string> = {
  truck_parking: 'Truck parking', pets: 'Pets OK', '24hr_checkin': '24hr check-in', wifi: 'WiFi', pool: 'Pool',
}
const BADGE: Record<string, { dot: string; label: string; color: string }> = {
  available: { dot: '#3ecf8e', label: 'Likely Available', color: '#3ecf8e' },
  limited: { dot: '#f5a623', label: 'Maybe Full', color: '#f5a623' },
  full: { dot: '#ff6b6b', label: 'Often Full', color: '#ff6b6b' },
}

export default function HotelPage() {
  const { id } = useParams()
  const router = useRouter()
  const [hotel, setHotel] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('hotels').select('*, exits(*, interstates(*))').eq('id', id).single()
      .then(({ data }) => { setHotel(data); setLoading(false) })
  }, [id])

  if (loading) return (
    <div style={{ background: '#0d0f14', minHeight: '100vh' }}>
      <Nav />
      <div className="text-center py-20" style={{ color: '#8a93a8' }}>Loading…</div>
    </div>
  )

  if (!hotel) return (
    <div style={{ background: '#0d0f14', minHeight: '100vh' }}>
      <Nav />
      <div className="text-center py-20" style={{ color: '#8a93a8' }}>Hotel not found</div>
    </div>
  )

  const exit = hotel.exits
  const interstate = exit?.interstates
  const badge = BADGE[hotel.availability_badge] || BADGE.available

  return (
    <div style={{ background: '#0d0f14', minHeight: '100vh' }}>
      <Nav />
      <button onClick={() => router.back()}
        className="px-5 pt-4 text-xs" style={{ color: '#8a93a8' }}>
        ← Back to results
      </button>

      <main className="px-5 pb-16 pt-4 max-w-md mx-auto">
        <div style={{
          background: '#14171f',
          border: hotel.featured ? '1px solid rgba(245,166,35,0.35)' : '1px solid rgba(255,255,255,0.07)',
        }} className="rounded-2xl overflow-hidden">
          {hotel.featured && (
            <div className="px-4 py-2 text-[11px] font-bold font-display uppercase tracking-[0.15em]"
                 style={{ background: 'rgba(245,166,35,0.12)', color: '#f5a623' }}>
              ★ Featured Property
            </div>
          )}
          {hotel.photo_url ? (
            <img src={hotel.photo_url} alt={hotel.name} className="w-full h-48 object-cover"/>
          ) : (
            <div className="w-full h-32 flex items-center justify-center text-6xl"
                 style={{ background: '#1c2030' }}>🏨</div>
          )}

          <div className="p-5">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h1 className="font-display font-extrabold text-2xl leading-tight" style={{ color: '#f0f2f7' }}>
                {hotel.name}
              </h1>
              <div className="flex items-center gap-1.5 shrink-0 mt-1">
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: badge.dot }}/>
                <span className="text-[11px] font-medium" style={{ color: badge.color }}>
                  {badge.label}
                </span>
              </div>
            </div>

            {exit && (
              <p className="text-xs mb-5" style={{ color: '#8a93a8' }}>
                {interstate?.name} {exit.direction} · {exit.exit_label} · MM {exit.mile_marker} · {exit.city}, {exit.state}
              </p>
            )}

            {(hotel.price_min || hotel.price_max) && (
              <div className="mb-5 p-4 rounded-xl"
                   style={{ background: '#1c2030', border: '1px solid rgba(245,166,35,0.15)' }}>
                <div className="text-[10px] uppercase tracking-[0.15em] mb-1" style={{ color: '#8a93a8' }}>
                  Price Range
                </div>
                <div className="font-display font-extrabold text-3xl" style={{ color: '#f5a623' }}>
                  ${hotel.price_min} – ${hotel.price_max}
                  <span className="text-sm font-medium ml-1" style={{ color: '#8a93a8' }}>/ night</span>
                </div>
              </div>
            )}

            {hotel.address && (
              <div className="mb-4">
                <div className="text-[10px] uppercase tracking-[0.15em] mb-1" style={{ color: '#8a93a8' }}>Address</div>
                <div className="text-sm" style={{ color: '#f0f2f7' }}>{hotel.address}</div>
              </div>
            )}

            {hotel.amenities?.length > 0 && (
              <div className="mb-5">
                <div className="text-[10px] uppercase tracking-[0.15em] mb-2" style={{ color: '#8a93a8' }}>Amenities</div>
                <div className="grid grid-cols-2 gap-2">
                  {hotel.amenities.map((a: string) => (
                    <div key={a} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                         style={{ background: '#1c2030', color: '#b8c0cc' }}>
                      <span>{AMENITY_ICONS[a] || '✓'}</span>
                      {AMENITY_LABELS[a] || a}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hotel.phone && (
              <>
                <a href={`tel:${hotel.phone}`}
                  className="flex items-center justify-center w-full py-4 rounded-xl font-display font-bold text-lg transition-all active:scale-95 mb-2"
                  style={{ background: '#f5a623', color: '#0d0f14', letterSpacing: '0.02em' }}>
                  📞 Call Hotel
                </a>
                <p className="text-center text-xs" style={{ color: '#8a93a8' }}>{hotel.phone}</p>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export const dynamic = 'force-dynamic'
