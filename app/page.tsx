'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Interstate } from '@/lib/supabase'

const DIRECTIONS = ['N', 'S', 'E', 'W']
const DISTANCES = [
  { value: 10, label: '10 mi' },
  { value: 30, label: '30 mi' },
  { value: 60, label: '60 mi' },
  { value: 90, label: '90 mi' },
  { value: 9999, label: 'No limit' },
]


export default function Home() {
  const router = useRouter()
  const [interstates, setInterstates] = useState<Interstate[]>([])
  const [form, setForm] = useState({ interstate: '', direction: '', distance: 30 })
  const [loading, setLoading] = useState(false)
  const [locStatus, setLocStatus] = useState<'idle' | 'getting' | 'got' | 'error'>('idle')
  const [coords, setCoords] = useState<{ lat: number; lng: number; source: 'gps' | 'manual' } | null>(null)
  const [locError, setLocError] = useState('')
  useEffect(() => {
    supabase.from('interstates').select('*').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setInterstates(data) })
  }, [])

  useEffect(() => { requestLocation() }, [])

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocStatus('error'); setLocError('Geolocation not supported on this device')
      return
    }
    setLocStatus('getting')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' })
        setLocStatus('got')
      },
      err => {
        setLocStatus('error')
        setLocError(err.code === 1 ? 'Location blocked' : 'Couldn\'t get location')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }


  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.interstate || !form.direction) return
    if (!coords) { setLocError('Pick a starting location first'); return }
    setLoading(true)
    router.push(`/search?interstate=${form.interstate}&direction=${form.direction}&distance=${form.distance}&lat=${coords.lat}&lng=${coords.lng}`)
  }

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)' }}>
      {/* Hero */}
      <section style={{
        padding: '48px 20px 32px', textAlign: 'center',
        background: 'linear-gradient(180deg, rgba(245,166,35,0.05) 0%, transparent 100%)',
      }}>
        <span className="hero-tag">HOTELS AHEAD OF YOU</span>
        <h1 style={{
          fontSize: '40px', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-1.5px',
          marginTop: '20px', marginBottom: '14px', color: 'var(--white)',
        }}>
          Sleep <span style={{ color: 'var(--amber)' }}>easy</span><br/>on the road.
        </h1>
        <p style={{ color: 'var(--fog)', fontSize: '15px', maxWidth: '340px', margin: '0 auto', lineHeight: 1.5 }}>
          Affordable, independent hotels — down the road from where you are right now.
        </p>
      </section>

      {/* Location banner */}
      <section style={{ padding: '0 20px 12px' }}>
        <div style={{ maxWidth: '440px', margin: '0 auto' }}>
          {locStatus === 'getting' && (
            <div style={{
              background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '10px',
              padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px',
              fontSize: '12px', color: 'var(--mist)',
            }}>
              <span style={{ fontSize: '14px' }}>📍</span>
              Getting your location...
            </div>
          )}
          {locStatus === 'got' && coords && (
            <div style={{
              background: 'rgba(62,207,142,0.08)', border: '1px solid rgba(62,207,142,0.25)',
              borderRadius: '10px', padding: '10px 14px', display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: '10px', fontSize: '12px', color: 'var(--green)',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>✓</span>
                {coords.source === 'gps' 
                  ? <>GPS locked · {coords.lat.toFixed(2)}°, {coords.lng.toFixed(2)}°</>
                  : <>Location set</>
                }
              </span>
              <button type="button" onClick={() => { setCoords(null); setLocStatus('idle'); requestLocation() }}
                style={{ background: 'none', border: 'none', color: 'var(--fog)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}>
                change
              </button>
            </div>
          )}
          {locStatus === 'error' && !coords && (
            <div style={{
              background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.25)',
              borderRadius: '10px', padding: '10px 14px', fontSize: '12px', color: 'var(--amber)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
            }}>
              <span>📍 {locError} — please enable GPS</span>
              <button type="button" onClick={requestLocation} style={{
                background: 'var(--amber)', color: 'var(--night)', border: 'none',
                padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              }}>Retry GPS</button>
            </div>
          )}
        </div>
      </section>


      {/* Search Card */}
      <section style={{ padding: '0 20px 40px' }}>
        <div style={{
          maxWidth: '440px', margin: '0 auto', background: 'var(--night2)',
          border: '1px solid var(--border)', borderRadius: '16px', padding: '24px',
        }}>
          <form onSubmit={handleSearch}>
            <div style={{ marginBottom: '16px' }}>
              <label className="dark-label">Interstate</label>
              <select
                className="dark-input"
                value={form.interstate}
                onChange={e => setForm(f => ({ ...f, interstate: e.target.value }))}
                required
              >
                <option value="">Select interstate...</option>
                {interstates.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label className="dark-label">Direction Traveling</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {DIRECTIONS.map(d => {
                  const active = form.direction === d
                  return (
                    <button
                      key={d} type="button"
                      onClick={() => setForm(f => ({ ...f, direction: d }))}
                      style={{
                        padding: '12px 0', borderRadius: '8px',
                        border: active ? '1px solid var(--amber)' : '1px solid var(--border)',
                        background: active ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                        color: active ? 'var(--amber)' : 'var(--mist)',
                        fontWeight: 600, fontFamily: 'Syne, sans-serif',
                        fontSize: '15px', cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >{d}</button>
                  )
                })}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label className="dark-label">How far ahead?</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                {DISTANCES.map(d => {
                  const active = form.distance === d.value
                  return (
                    <button
                      key={d.value} type="button"
                      onClick={() => setForm(f => ({ ...f, distance: d.value }))}
                      style={{
                        padding: '10px 0', borderRadius: '8px',
                        border: active ? '1px solid var(--amber)' : '1px solid var(--border)',
                        background: active ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                        color: active ? 'var(--amber)' : 'var(--mist)',
                        fontWeight: 600, fontFamily: 'DM Sans, sans-serif',
                        fontSize: '12px', cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                      }}
                    >{d.label}</button>
                  )
                })}
              </div>
            </div>

            <button type="submit" disabled={loading || !coords} className="btn-amber" style={{ width: '100%', padding: '14px', fontSize: '15px', letterSpacing: '1px' }}>
              {loading ? 'SEARCHING...' : 'FIND HOTELS →'}
            </button>
          </form>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '0 20px 48px', maxWidth: '440px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {[['🚛', 'Truck Parking'], ['🐾', 'Pet Friendly'], ['🌙', '24hr Check-in']].map(([icon, label]) => (
            <div key={label} style={{
              background: 'var(--night2)', border: '1px solid var(--border)',
              borderRadius: '10px', padding: '14px 10px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '20px', marginBottom: '4px' }}>{icon}</div>
              <div style={{ fontSize: '11px', color: 'var(--mist)', fontWeight: 500 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

export const dynamic = 'force-dynamic'
