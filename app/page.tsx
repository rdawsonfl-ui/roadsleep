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
  availability_badge: string | null
  featured: boolean | null
}

function directionsUrl(h: Hotel): string {
  if (h.latitude && h.longitude) {
    return `https://www.google.com/maps/dir/?api=1&destination=${h.latitude},${h.longitude}`
  }
  if (h.address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.address)}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.name)}`
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

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('hotels')
        .select('id,name,phone,address,latitude,longitude,price_min,price_max,amenities,availability_badge,featured')
        .neq('availability_badge', 'full')
        .order('featured', { ascending: false })
        .limit(50)
      if (data) setHotels(data as Hotel[])
      setLoading(false)
    })()
  }, [])

  const filtered = hotels.filter((h) => !h.price_min || h.price_min <= maxPrice)

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '20px 16px 48px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '26px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '4px' }}>
          Hotels at your <span style={{ color: 'var(--amber)' }}>next exit</span>
        </h1>
        <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '20px' }}>Hotels along major interstates</p>

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
          {loading ? 'Loading...' : `${filtered.length} hotels found`}
        </p>

        {filtered.map((h) => {
          const price = h.price_min ? `$${h.price_min}${h.price_max ? `-$${h.price_max}` : ''}` : 'Call'
          return (
            <div key={h.id} style={{ background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                {h.featured && <span style={{ fontSize: '10px', background: 'rgba(245,166,35,0.15)', color: 'var(--amber)', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Featured</span>}
                {h.availability_badge === 'available' && <span style={{ fontSize: '10px', background: 'rgba(34,197,94,0.15)', color: 'var(--green)', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Available</span>}
                <span style={{ marginLeft: 'auto', color: 'var(--amber)', fontWeight: 800, fontSize: '17px', fontStyle: 'italic' }}>{price}</span>
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--white)', marginBottom: '4px' }}>{h.name}</h3>
              <p style={{ fontSize: '12px', color: 'var(--fog)', marginBottom: '10px' }}>{h.address || ''}</p>
              {h.amenities && h.amenities.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                  {h.amenities.slice(0, 4).map((a) => (
                    <span key={a} style={{ background: 'var(--night3)', color: 'var(--mist)', fontSize: '11px', padding: '4px 9px', borderRadius: '5px' }}>{a}</span>
                  ))}
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
            🛣️ No hotels found. Try expanding your distance filter.
          </div>
        )}
      </div>
    </main>
  )
}

export const dynamic = 'force-dynamic'
