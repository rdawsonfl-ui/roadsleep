'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Interstate } from '@/lib/supabase'

const DIRECTIONS = ['N', 'S', 'E', 'W']

export default function Home() {
  const router = useRouter()
  const [interstates, setInterstates] = useState<Interstate[]>([])
  const [form, setForm] = useState({ interstate: '', direction: '', mile_marker: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('interstates').select('*').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setInterstates(data) })
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.interstate || !form.direction || !form.mile_marker) return
    setLoading(true)
    router.push(`/search?interstate=${form.interstate}&direction=${form.direction}&mile=${form.mile_marker}`)
  }

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)' }}>
      {/* Hero */}
      <section style={{
        padding: '56px 20px 40px',
        textAlign: 'center',
        background: 'linear-gradient(180deg, rgba(245,166,35,0.05) 0%, transparent 100%)',
      }}>
        <span className="hero-tag">FIND HOTELS BY MILE MARKER</span>
        <h1 style={{
          fontSize: '42px',
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: '-1.5px',
          marginTop: '20px',
          marginBottom: '14px',
          color: 'var(--white)',
        }}>
          Sleep <span style={{ color: 'var(--amber)' }}>easy</span><br/>on the road.
        </h1>
        <p style={{ color: 'var(--fog)', fontSize: '15px', maxWidth: '360px', margin: '0 auto', lineHeight: 1.5 }}>
          Affordable, independent hotels — by interstate and mile marker. No booking fees. Just call.
        </p>
      </section>

      {/* Search Card */}
      <section style={{ padding: '0 20px 48px' }}>
        <div style={{
          maxWidth: '440px',
          margin: '0 auto',
          background: 'var(--night2)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '24px',
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
              <label className="dark-label">Direction</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {DIRECTIONS.map(d => {
                  const active = form.direction === d
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, direction: d }))}
                      style={{
                        padding: '12px 0',
                        borderRadius: '8px',
                        border: active ? '1px solid var(--amber)' : '1px solid var(--border)',
                        background: active ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                        color: active ? 'var(--amber)' : 'var(--mist)',
                        fontWeight: 600,
                        fontFamily: 'Syne, sans-serif',
                        fontSize: '15px',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >{d}</button>
                  )
                })}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label className="dark-label">Mile Marker</label>
              <input
                type="number"
                placeholder="e.g. 142"
                value={form.mile_marker}
                onChange={e => setForm(f => ({ ...f, mile_marker: e.target.value }))}
                className="dark-input"
                min="0"
                required
              />
              <p style={{ fontSize: '11px', color: 'var(--steel)', marginTop: '6px' }}>
                Shows hotels within 10 miles of your marker
              </p>
            </div>

            <button type="submit" disabled={loading} className="btn-amber" style={{ width: '100%', padding: '14px', fontSize: '15px', letterSpacing: '1px' }}>
              {loading ? 'SEARCHING...' : 'FIND HOTELS →'}
            </button>
          </form>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '0 20px 48px', maxWidth: '440px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {[
            ['🚛', 'Truck Parking'],
            ['🐾', 'Pet Friendly'],
            ['🌙', '24hr Check-in'],
          ].map(([icon, label]) => (
            <div key={label} style={{
              background: 'var(--night2)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '14px 10px',
              textAlign: 'center',
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
