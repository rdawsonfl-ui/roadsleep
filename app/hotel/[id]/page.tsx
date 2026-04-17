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
      .then(({ data }) => { setHotel(data as any); setLoading(false) })
  }, [id])

  if (loading) return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--fog)', textAlign: 'center' }}>
        <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏨</div>Loading...
      </div>
    </main>
  )
  if (!hotel) return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--fog)', textAlign: 'center' }}>
        <div style={{ fontSize: '36px', marginBottom: '10px' }}>😕</div>Hotel not found
      </div>
    </main>
  )

  const exit = (hotel as any).exits
  const interstate = exit?.interstates

  const trackCall = () => {
    // Fire-and-forget — logs call for billing purposes
    supabase.from('call_logs').insert({
      hotel_id: hotel.id,
      hotelier_id: (hotel as any).hotelier_id || null,
    }).then(() => {})
  }

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '24px 20px 48px' }}>
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <button onClick={() => router.back()} style={{
          background: 'var(--night2)', border: '1px solid var(--border)', color: 'var(--fog)',
          width: '34px', height: '34px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', marginBottom: '16px',
        }}>←</button>

        <div style={{
          background: 'var(--night2)',
          border: hotel.featured ? '1px solid rgba(245,166,35,0.4)' : '1px solid var(--border)',
          borderRadius: '16px',
          overflow: 'hidden',
        }}>
          {hotel.featured && (
            <div style={{
              background: 'linear-gradient(90deg, var(--amber) 0%, var(--amber2) 100%)',
              color: 'var(--night)', padding: '6px 20px', fontSize: '11px', fontWeight: 700,
              fontFamily: 'Syne, sans-serif', letterSpacing: '1.5px',
            }}>★ FEATURED PROPERTY</div>
          )}
          {hotel.photo_url ? (
            <img src={hotel.photo_url} alt={hotel.name} style={{ width: '100%', height: '220px', objectFit: 'cover' }}/>
          ) : (
            <div style={{ width: '100%', height: '120px', background: 'var(--night3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '56px' }}>🏨</div>
          )}

          <div style={{ padding: '24px' }}>
            <h1 style={{ fontSize: '26px', color: 'var(--white)', fontFamily: 'Syne, sans-serif', marginBottom: '6px', letterSpacing: '-0.5px' }}>
              {hotel.name}
            </h1>
            {exit && (
              <p style={{ fontSize: '13px', color: 'var(--fog)', marginBottom: '20px' }}>
                {interstate?.name} · {exit.exit_label} · Mile {exit.mile_marker} · {exit.city}, {exit.state}
              </p>
            )}

            {(hotel.price_min || hotel.price_max) && (
              <div style={{
                background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)',
                borderRadius: '12px', padding: '14px 16px', marginBottom: '20px',
              }}>
                <div style={{ fontSize: '11px', color: 'var(--fog)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>Price Range</div>
                <div style={{ fontSize: '32px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: 'var(--amber)' }}>
                  ${hotel.price_min} – ${hotel.price_max}
                  <span style={{ fontSize: '14px', color: 'var(--fog)', fontWeight: 400 }}> / night</span>
                </div>
              </div>
            )}

            {hotel.address && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', color: 'var(--fog)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Address</div>
                <div style={{ fontSize: '14px', color: 'var(--mist)' }}>{hotel.address}</div>
              </div>
            )}

            {hotel.amenities?.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '11px', color: 'var(--fog)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '10px' }}>Amenities</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {hotel.amenities.map((a: string) => (
                    <div key={a} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--mist)', fontSize: '14px' }}>
                      <span style={{ fontSize: '18px' }}>{AMENITY_ICONS[a] || '✓'}</span>
                      {AMENITY_LABELS[a] || a}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hotel.phone && (
              <>
                <a href={`tel:${hotel.phone}`} onClick={trackCall} className="btn-amber" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '100%', padding: '16px', fontSize: '18px', letterSpacing: '1px',
                  textDecoration: 'none', marginBottom: '10px',
                }}>
                  📞 CALL HOTEL
                </a>
                <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--fog)' }}>{hotel.phone}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

export const dynamic = 'force-dynamic'
