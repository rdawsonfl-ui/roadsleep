'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, type Hotel } from '@/lib/supabase'

const AMENITY_ICONS: Record<string, string> = {
  truck_parking: '🚛', pets: '🐾', '24hr_checkin': '🌙', wifi: '📶', pool: '🏊',
}
const AMENITY_LABELS: Record<string, string> = {
  truck_parking: 'Truck Parking', pets: 'Pets OK', '24hr_checkin': '24hr Check-in', wifi: 'WiFi', pool: 'Pool',
}

export default function HotelPage() {
  const { id } = useParams()
  const router = useRouter()
  const [hotel, setHotel] = useState<Hotel | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('hotels').select('*, exits(*, interstates(*))').eq('id', id).single()
      .then(({ data }) => { setHotel(data); setLoading(false) })
  }, [id])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f5f0e8' }}>
      <div className="text-gray-400 text-center"><div className="text-4xl mb-3">🏨</div>Loading...</div>
    </div>
  )

  if (!hotel) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f5f0e8' }}>
      <div className="text-center"><div className="text-4xl mb-3">😕</div><p className="text-gray-600">Hotel not found</p></div>
    </div>
  )

  const exit = (hotel as any).exits
  const interstate = exit?.interstates

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f5f0e8' }}>
      <header style={{ background: '#1a1a1a' }} className="px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white transition-colors text-xl">←</button>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '22px', fontWeight: 800, color: 'white', letterSpacing: '0.05em' }}>
          ROAD<span style={{ color: '#f5c842' }}>SLEEP</span>
        </div>
      </header>
      <div className="road-stripe" />

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-5">
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {hotel.featured && (
            <div className="px-4 py-2 text-sm font-black" style={{ background: '#f5c842', color: '#1a1a1a', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}>
              ⭐ FEATURED PROPERTY
            </div>
          )}
          {hotel.photo_url ? (
            <img src={hotel.photo_url} alt={hotel.name} className="w-full h-48 object-cover"/>
          ) : (
            <div className="w-full h-32 flex items-center justify-center text-6xl" style={{ background: '#f3f4f6' }}>🏨</div>
          )}

          <div className="p-5">
            <h1 className="text-2xl font-black text-gray-900 mb-1" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {hotel.name}
            </h1>
            {exit && (
              <p className="text-sm text-gray-500 mb-4">
                {interstate?.name} · {exit.exit_label} · Mile {exit.mile_marker} · {exit.city}, {exit.state}
              </p>
            )}

            {(hotel.price_min || hotel.price_max) && (
              <div className="mb-4 p-3 rounded-xl" style={{ background: '#f5f0e8' }}>
                <div className="text-xs text-gray-500 mb-0.5">Price Range</div>
                <div className="text-3xl font-black" style={{ fontFamily: 'Barlow Condensed, sans-serif', color: '#2c6e49' }}>
                  ${hotel.price_min} – ${hotel.price_max}
                  <span className="text-base font-normal text-gray-400"> / night</span>
                </div>
              </div>
            )}

            {hotel.address && (
              <div className="mb-4">
                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">Address</div>
                <div className="text-sm text-gray-700">{hotel.address}</div>
              </div>
            )}

            {hotel.amenities?.length > 0 && (
              <div className="mb-5">
                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">Amenities</div>
                <div className="grid grid-cols-2 gap-2">
                  {hotel.amenities.map(a => (
                    <div key={a} className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="text-base">{AMENITY_ICONS[a] || '✓'}</span>
                      {AMENITY_LABELS[a] || a}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hotel.phone && (
              <a href={`tel:${hotel.phone}`}
                className="flex items-center justify-center w-full py-4 rounded-2xl text-white font-black text-2xl transition-all active:scale-95 shadow-lg mb-3"
                style={{ background: '#2c6e49', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}>
                📞 CALL HOTEL
              </a>
            )}

            {hotel.phone && (
              <p className="text-center text-xs text-gray-400">{hotel.phone}</p>
            )}
          </div>
        </div>
      </main>
      <div className="road-stripe" />
    </div>
  )
}

export const dynamic = 'force-dynamic'
