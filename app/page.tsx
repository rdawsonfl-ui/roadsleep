'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Interstate } from '@/lib/supabase'
import Nav from '@/components/Nav'

const DIRS = ['N','S','E','W']

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
    <div style={{ background: '#0d0f14', minHeight: '100vh' }}>
      <Nav />

      {/* Hero */}
      <div style={{ background: 'linear-gradient(180deg, rgba(245,166,35,0.04) 0%, transparent 100%)' }}
           className="px-5 pt-10 pb-8 text-center">
        <div className="inline-block text-[10px] font-medium uppercase tracking-[0.15em] px-3 py-1 rounded-full mb-4"
             style={{ background: 'rgba(245,166,35,0.12)', color: '#f5a623', border: '1px solid rgba(245,166,35,0.25)' }}>
          Find Hotels by Mile Marker
        </div>
        <h1 className="font-display font-extrabold leading-[1.05] mb-2" style={{ fontSize: '38px', letterSpacing: '-1px', color: '#f0f2f7' }}>
          Sleep anywhere<br/>on the highway.
        </h1>
        <p className="text-sm" style={{ color: '#8a93a8' }}>
          Mom-and-pop motels, mile-marker search, tap to call.
        </p>
      </div>

      {/* Search card */}
      <div className="px-5 pb-10 max-w-md mx-auto">
        <form onSubmit={handleSearch}
              style={{ background: '#14171f', border: '1px solid rgba(255,255,255,0.07)' }}
              className="rounded-2xl overflow-hidden">
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-[0.12em] mb-1.5" style={{ color: '#8a93a8' }}>
                Interstate
              </label>
              <select
                value={form.interstate}
                onChange={e => setForm(f => ({ ...f, interstate: e.target.value }))}
                className="w-full rounded-lg px-3.5 py-3 text-sm"
                style={{ background: '#1c2030', color: '#f0f2f7', border: '1px solid rgba(255,255,255,0.07)' }}
                required
              >
                <option value="">Select interstate…</option>
                {interstates.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-medium uppercase tracking-[0.12em] mb-1.5" style={{ color: '#8a93a8' }}>
                Direction
              </label>
              <div className="grid grid-cols-4 gap-2">
                {DIRS.map(d => {
                  const active = form.direction === d
                  return (
                    <button key={d} type="button"
                      onClick={() => setForm(f => ({ ...f, direction: d }))}
                      className="py-3 rounded-lg text-sm font-bold font-display transition-all"
                      style={{
                        background: active ? '#f5a623' : '#1c2030',
                        color: active ? '#0d0f14' : '#8a93a8',
                        border: `1px solid ${active ? '#f5a623' : 'rgba(255,255,255,0.07)'}`,
                      }}>
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-medium uppercase tracking-[0.12em] mb-1.5" style={{ color: '#8a93a8' }}>
                Mile Marker
              </label>
              <input
                type="number" placeholder="e.g. 142"
                value={form.mile_marker}
                onChange={e => setForm(f => ({ ...f, mile_marker: e.target.value }))}
                className="w-full rounded-lg px-3.5 py-3 text-sm"
                style={{ background: '#1c2030', color: '#f0f2f7', border: '1px solid rgba(255,255,255,0.07)' }}
                min="0" required
              />
              <p className="text-[11px] mt-1.5" style={{ color: '#8a93a8' }}>Shows hotels within 10 miles</p>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-4 font-display font-bold text-base tracking-wide transition-all disabled:opacity-60"
            style={{ background: '#f5a623', color: '#0d0f14', letterSpacing: '0.02em' }}>
            {loading ? 'Searching…' : 'Find Hotels →'}
          </button>
        </form>

        {/* Feature pills */}
        <div className="grid grid-cols-3 gap-2 mt-5">
          {[
            { icon: '🛻', label: 'Truck parking' },
            { icon: '🐾', label: 'Pet friendly' },
            { icon: '🌙', label: '24hr check-in' },
          ].map(f => (
            <div key={f.label}
                 style={{ background: '#14171f', border: '1px solid rgba(255,255,255,0.07)' }}
                 className="rounded-xl p-3 text-center">
              <div className="text-lg mb-1">{f.icon}</div>
              <div className="text-[11px]" style={{ color: '#8a93a8' }}>{f.label}</div>
            </div>
          ))}
        </div>

        {/* Tagline */}
        <div className="mt-8 text-center">
          <div className="text-[11px] uppercase tracking-[0.15em] mb-2" style={{ color: '#8a93a8' }}>
            Built for the road
          </div>
          <div className="text-sm leading-relaxed" style={{ color: '#b8c0cc' }}>
            No commissions. No booking apps. Just phone numbers from the highway straight to the motel.
          </div>
        </div>
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'
