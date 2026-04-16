'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Interstate } from '@/lib/supabase'

const DIRECTIONS = [
  { code: 'N', label: 'Northbound' },
  { code: 'S', label: 'Southbound' },
  { code: 'E', label: 'Eastbound' },
  { code: 'W', label: 'Westbound' },
]

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
    <div className="min-h-screen flex flex-col" style={{ background: '#f5f0e8' }}>
      <header style={{ background: '#1a1a1a' }} className="px-6 py-4 flex items-center justify-between">
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '28px', fontWeight: 800, color: 'white', letterSpacing: '0.05em' }}>
          ROAD<span style={{ color: '#f5c842' }}>SLEEP</span>
        </div>
        <a href="/admin" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Admin ›</a>
      </header>
      <div className="road-stripe" />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <svg viewBox="0 0 320 72" className="w-full max-w-xs mx-auto mb-5">
              <rect width="320" height="72" fill="#555" rx="6"/>
              {[0,1,2,3,4,5,6].map(i => (
                <rect key={i} x={i*48+4} y="32" width="32" height="8" rx="2" fill="#f5c842" opacity="0.85"/>
              ))}
              <rect x="118" y="14" width="84" height="32" rx="4" fill="#2c6e49"/>
              <rect x="118" y="22" width="26" height="24" rx="3" fill="#1a4a30"/>
              <circle cx="133" cy="50" r="7" fill="#1a1a1a"/><circle cx="133" cy="50" r="3" fill="#555"/>
              <circle cx="188" cy="50" r="7" fill="#1a1a1a"/><circle cx="188" cy="50" r="3" fill="#555"/>
            </svg>
            <h1 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '38px', fontWeight: 800, lineHeight: 1.1 }} className="text-gray-900 mb-2">
              FIND YOUR NEXT STOP
            </h1>
            <p className="text-gray-500 text-sm">Hotels by mile marker · No booking · Just call</p>
          </div>

          <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Interstate</label>
                <select
                  value={form.interstate}
                  onChange={e => setForm(f => ({ ...f, interstate: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 bg-gray-50"
                  
                  required
                >
                  <option value="">Select interstate...</option>
                  {interstates.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Direction</label>
                <div className="grid grid-cols-4 gap-2">
                  {DIRECTIONS.map(d => (
                    <button key={d.code} type="button"
                      onClick={() => setForm(f => ({ ...f, direction: d.code }))}
                      className="py-3 rounded-xl text-sm font-bold transition-all"
                      style={{
                        background: form.direction === d.code ? '#2c6e49' : '#f3f4f6',
                        color: form.direction === d.code ? 'white' : '#6b7280',
                        fontFamily: 'Barlow Condensed, sans-serif',
                        fontSize: '16px',
                        letterSpacing: '0.05em'
                      }}
                    >{d.code}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Mile Marker</label>
                <input
                  type="number" placeholder="e.g. 142"
                  value={form.mile_marker}
                  onChange={e => setForm(f => ({ ...f, mile_marker: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none bg-gray-50"
                  min="0" required
                />
                <p className="text-xs text-gray-400 mt-1.5">Shows hotels within 10 miles</p>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-4 text-white font-black text-xl transition-all disabled:opacity-60"
              style={{ background: '#2c6e49', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}>
              {loading ? 'SEARCHING...' : '🛣️  FIND HOTELS'}
            </button>
          </form>

          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            {[['🚛','Truck Parking'],['🐾','Pet Friendly'],['🌙','24hr Check-in']].map(([icon, label]) => (
              <div key={label} className="bg-white rounded-xl p-3 shadow-sm">
                <div className="text-xl mb-1">{icon}</div>
                <div className="text-xs text-gray-500 font-medium">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <div className="road-stripe" />
      <footer style={{ background: '#1a1a1a' }} className="text-center py-3">
        <span style={{ color: '#555', fontSize: '12px' }}>RoadSleep © {new Date().getFullYear()} · Highway Hotels by Mile Marker</span>
      </footer>
    </div>
  )
}

export const dynamic = 'force-dynamic'
