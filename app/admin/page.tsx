'use client'
import { useState, useEffect } from 'react'
import { supabase, type Hotel, type Interstate } from '@/lib/supabase'
import Nav from '@/components/Nav'

type Tab = 'hotels' | 'roads'

const AMENITIES = [
  { key: 'truck_parking', label: '🛻 Truck parking' },
  { key: 'pets', label: '🐾 Pets OK' },
  { key: '24hr_checkin', label: '🌙 24hr' },
  { key: 'wifi', label: '📶 WiFi' },
  { key: 'pool', label: '🏊 Pool' },
]

const empty = {
  name: '', phone: '', address: '', price_min: '', price_max: '',
  amenities: [] as string[], availability_badge: 'available', featured: false,
  photo_url: '', exit_id: ''
}

const ip = "w-full rounded-lg px-3 py-2.5 text-sm"
const ipStyle = { background: '#1c2030', color: '#f0f2f7', border: '1px solid rgba(255,255,255,0.07)' }
const lbl = "block text-[10px] font-medium uppercase tracking-[0.12em] mb-1.5"
const lblStyle = { color: '#8a93a8' }

export default function Admin() {
  const [tab, setTab] = useState<Tab>('hotels')
  const [hotels, setHotels] = useState<any[]>([])
  const [interstates, setInterstates] = useState<Interstate[]>([])
  const [exits, setExits] = useState<any[]>([])
  const [form, setForm] = useState({ ...empty })
  const [editId, setEditId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [csv, setCsv] = useState('')
  const [newI, setNewI] = useState('')
  const [exitForm, setExitForm] = useState({ interstate_id: '', direction: 'N', exit_label: '', mile_marker: '', city: '', state: '' })

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [h, i, e] = await Promise.all([
      supabase.from('hotels').select('*, exits(*, interstates(*))').order('created_at', { ascending: false }),
      supabase.from('interstates').select('*').order('name'),
      supabase.from('exits').select('*, interstates(name)').order('mile_marker'),
    ])
    if (h.data) setHotels(h.data)
    if (i.data) setInterstates(i.data)
    if (e.data) setExits(e.data)
  }

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  async function saveHotel() {
    if (!form.name || !form.exit_id) return flash('Name + exit required')
    const payload = {
      name: form.name, phone: form.phone, address: form.address,
      price_min: form.price_min ? parseInt(form.price_min) : null,
      price_max: form.price_max ? parseInt(form.price_max) : null,
      amenities: form.amenities,
      availability_badge: form.availability_badge,
      featured: form.featured,
      photo_url: form.photo_url,
      exit_id: form.exit_id,
    }
    if (editId) {
      await supabase.from('hotels').update(payload).eq('id', editId)
      flash('Updated')
    } else {
      await supabase.from('hotels').insert(payload)
      flash('Added')
    }
    setForm({ ...empty })
    setEditId(null)
    loadAll()
  }

  async function delHotel(id: string) {
    if (!confirm('Delete this hotel?')) return
    await supabase.from('hotels').delete().eq('id', id)
    loadAll()
  }

  function edit(h: any) {
    setEditId(h.id)
    setForm({
      name: h.name, phone: h.phone || '', address: h.address || '',
      price_min: h.price_min?.toString() || '', price_max: h.price_max?.toString() || '',
      amenities: h.amenities || [], availability_badge: h.availability_badge || 'available',
      featured: h.featured || false, photo_url: h.photo_url || '', exit_id: h.exit_id,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function importCsv() {
    const lines = csv.trim().split('\n').filter(l => l.trim())
    let n = 0
    for (const line of lines) {
      const [name, phone, address, exit_id, price_min, price_max] = line.split(',').map(s => s.trim())
      if (!name || !exit_id) continue
      await supabase.from('hotels').insert({
        name, phone, address, exit_id,
        price_min: price_min ? parseInt(price_min) : null,
        price_max: price_max ? parseInt(price_max) : null,
        availability_badge: 'available',
      })
      n++
    }
    flash(`${n} imported`)
    setCsv('')
    loadAll()
  }

  async function addI() {
    if (!newI.trim()) return
    await supabase.from('interstates').insert({ name: newI.trim().toUpperCase() })
    setNewI(''); flash('Added'); loadAll()
  }

  async function toggleI(id: string, active: boolean) {
    await supabase.from('interstates').update({ is_active: !active }).eq('id', id); loadAll()
  }

  async function addExit() {
    if (!exitForm.interstate_id || !exitForm.mile_marker) return flash('Interstate + mile required')
    await supabase.from('exits').insert({
      interstate_id: exitForm.interstate_id,
      direction: exitForm.direction,
      exit_label: exitForm.exit_label,
      mile_marker: parseFloat(exitForm.mile_marker),
      city: exitForm.city,
      state: exitForm.state,
    })
    setExitForm({ interstate_id: '', direction: 'N', exit_label: '', mile_marker: '', city: '', state: '' })
    flash('Exit added'); loadAll()
  }

  async function toggleFeatured(id: string, val: boolean) {
    await supabase.from('hotels').update({ featured: !val }).eq('id', id); loadAll()
  }

  async function updBadge(id: string, b: string) {
    await supabase.from('hotels').update({ availability_badge: b }).eq('id', id); loadAll()
  }

  const toggleA = (k: string) =>
    setForm(f => ({ ...f, amenities: f.amenities.includes(k) ? f.amenities.filter(a => a !== k) : [...f.amenities, k] }))

  return (
    <div style={{ background: '#0d0f14', minHeight: '100vh' }}>
      <Nav />

      {msg && (
        <div className="fixed top-20 right-5 z-50 px-4 py-2 rounded-lg text-sm font-medium"
             style={{ background: '#f5a623', color: '#0d0f14' }}>
          {msg}
        </div>
      )}

      <div className="max-w-3xl mx-auto px-5 py-6">
        <div className="mb-5">
          <div className="inline-block text-[10px] font-medium uppercase tracking-[0.15em] px-3 py-1 rounded-full mb-3"
               style={{ background: 'rgba(245,166,35,0.12)', color: '#f5a623', border: '1px solid rgba(245,166,35,0.25)' }}>
            Hotelier Portal
          </div>
          <h1 className="font-display font-extrabold text-3xl" style={{ color: '#f0f2f7' }}>
            Manage your listings
          </h1>
        </div>

        <div className="flex gap-2 mb-6">
          {(['hotels','roads'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-5 py-2 rounded-lg text-sm font-display font-bold transition-all capitalize"
              style={{
                background: tab === t ? '#f5a623' : '#14171f',
                color: tab === t ? '#0d0f14' : '#8a93a8',
                border: `1px solid ${tab === t ? '#f5a623' : 'rgba(255,255,255,0.07)'}`,
              }}>
              {t === 'hotels' ? '🏨 Hotels' : '🛣️ Interstates & Exits'}
            </button>
          ))}
        </div>

        {tab === 'hotels' && (
          <>
            <div style={{ background: '#14171f', border: '1px solid rgba(255,255,255,0.07)' }}
                 className="rounded-xl p-5 mb-4">
              <h2 className="font-display font-bold text-lg mb-4" style={{ color: '#f0f2f7' }}>
                {editId ? 'Edit Hotel' : '+ Add Hotel'}
              </h2>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="col-span-2">
                  <label className={lbl} style={lblStyle}>Hotel Name *</label>
                  <input className={ip} style={ipStyle} value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Sleep Inn I-95"/>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>Phone</label>
                  <input className={ip} style={ipStyle} value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="555-123-4567"/>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>Exit *</label>
                  <select className={ip} style={ipStyle} value={form.exit_id}
                    onChange={e => setForm(f => ({ ...f, exit_id: e.target.value }))}>
                    <option value="">Select exit…</option>
                    {exits.map(x => (
                      <option key={x.id} value={x.id}>
                        {x.interstates?.name} {x.direction} · MM {x.mile_marker} · {x.city}, {x.state}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={lbl} style={lblStyle}>Address</label>
                  <input className={ip} style={ipStyle} value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Hwy Dr, City, ST"/>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>Price Min</label>
                  <input className={ip} style={ipStyle} type="number" value={form.price_min}
                    onChange={e => setForm(f => ({ ...f, price_min: e.target.value }))} placeholder="59"/>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>Price Max</label>
                  <input className={ip} style={ipStyle} type="number" value={form.price_max}
                    onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))} placeholder="89"/>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>Availability</label>
                  <select className={ip} style={ipStyle} value={form.availability_badge}
                    onChange={e => setForm(f => ({ ...f, availability_badge: e.target.value }))}>
                    <option value="available">🟢 Likely Available</option>
                    <option value="limited">🟡 Maybe Full</option>
                    <option value="full">🔴 Often Full</option>
                  </select>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>Photo URL</label>
                  <input className={ip} style={ipStyle} value={form.photo_url}
                    onChange={e => setForm(f => ({ ...f, photo_url: e.target.value }))} placeholder="https://…"/>
                </div>
              </div>

              <div className="mb-4">
                <label className={lbl} style={lblStyle}>Amenities</label>
                <div className="flex flex-wrap gap-2">
                  {AMENITIES.map(a => {
                    const on = form.amenities.includes(a.key)
                    return (
                      <button key={a.key} type="button" onClick={() => toggleA(a.key)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                        style={{
                          background: on ? 'rgba(245,166,35,0.15)' : '#1c2030',
                          color: on ? '#f5a623' : '#8a93a8',
                          border: `1px solid ${on ? 'rgba(245,166,35,0.35)' : 'rgba(255,255,255,0.07)'}`,
                        }}>
                        {a.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer" style={{ color: '#b8c0cc' }}>
                <input type="checkbox" checked={form.featured}
                  onChange={e => setForm(f => ({ ...f, featured: e.target.checked }))}
                  className="w-4 h-4 accent-amber-500"/>
                ★ Featured listing
              </label>

              <div className="flex gap-2">
                <button onClick={saveHotel}
                  className="flex-1 py-3 rounded-lg font-display font-bold text-base transition-all"
                  style={{ background: '#f5a623', color: '#0d0f14' }}>
                  {editId ? 'Update Hotel' : 'Add Hotel'}
                </button>
                {editId && (
                  <button onClick={() => { setEditId(null); setForm({ ...empty }) }}
                    className="px-4 py-3 rounded-lg font-medium text-sm"
                    style={{ background: '#1c2030', color: '#8a93a8' }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <details style={{ background: '#14171f', border: '1px solid rgba(255,255,255,0.07)' }}
                     className="rounded-xl mb-4 overflow-hidden">
              <summary className="px-5 py-4 cursor-pointer text-sm font-medium" style={{ color: '#8a93a8' }}>
                📄 Bulk CSV Import
              </summary>
              <div className="px-5 pb-5">
                <p className="text-[11px] mb-2" style={{ color: '#8a93a8' }}>
                  Format: name, phone, address, exit_id, price_min, price_max
                </p>
                <textarea
                  className="w-full rounded-lg p-3 text-xs font-mono h-24 mb-2"
                  style={ipStyle}
                  value={csv} onChange={e => setCsv(e.target.value)}
                  placeholder="Sleep Inn, 555-111-2222, 123 Hwy, exit-uuid, 59, 89"/>
                <button onClick={importCsv}
                  className="px-4 py-2 rounded-lg text-sm font-bold font-display"
                  style={{ background: '#f5a623', color: '#0d0f14' }}>
                  Import
                </button>
              </div>
            </details>

            <div style={{ background: '#14171f', border: '1px solid rgba(255,255,255,0.07)' }}
                 className="rounded-xl overflow-hidden">
              <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <h3 className="font-display font-bold text-sm" style={{ color: '#f0f2f7' }}>
                  All Hotels ({hotels.length})
                </h3>
              </div>
              {hotels.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: '#8a93a8' }}>No hotels yet</div>
              ) : (
                <div>
                  {hotels.map(h => {
                    const x = h.exits
                    return (
                      <div key={h.id} className="px-5 py-4 flex items-start gap-3"
                           style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-display font-bold text-sm" style={{ color: '#f0f2f7' }}>{h.name}</span>
                            {h.featured && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                                    style={{ background: 'rgba(245,166,35,0.15)', color: '#f5a623' }}>
                                ★ Featured
                              </span>
                            )}
                          </div>
                          {x && (
                            <p className="text-[11px] mt-0.5" style={{ color: '#8a93a8' }}>
                              {x.interstates?.name} · MM {x.mile_marker} · {x.city}, {x.state}
                            </p>
                          )}
                          <p className="text-[11px]" style={{ color: '#b8c0cc' }}>{h.phone}</p>
                        </div>
                        <div className="flex flex-col gap-1.5 items-end shrink-0">
                          <select value={h.availability_badge || 'available'}
                            onChange={e => updBadge(h.id, e.target.value)}
                            className="text-[11px] rounded px-2 py-1"
                            style={{ background: '#1c2030', color: '#f0f2f7', border: '1px solid rgba(255,255,255,0.07)' }}>
                            <option value="available">🟢 Avail</option>
                            <option value="limited">🟡 Limit</option>
                            <option value="full">🔴 Full</option>
                          </select>
                          <div className="flex gap-1.5">
                            <button onClick={() => toggleFeatured(h.id, h.featured)}
                              className="text-[11px] px-2 py-1 rounded"
                              style={{ background: '#1c2030', color: '#f5a623', border: '1px solid rgba(245,166,35,0.25)' }}>
                              {h.featured ? '★' : '☆'}
                            </button>
                            <button onClick={() => edit(h)}
                              className="text-[11px] px-2 py-1 rounded"
                              style={{ background: '#1c2030', color: '#4fa3e0', border: '1px solid rgba(79,163,224,0.25)' }}>
                              Edit
                            </button>
                            <button onClick={() => delHotel(h.id)}
                              className="text-[11px] px-2 py-1 rounded"
                              style={{ background: '#1c2030', color: '#ff6b6b', border: '1px solid rgba(255,107,107,0.25)' }}>
                              Del
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'roads' && (
          <>
            <div style={{ background: '#14171f', border: '1px solid rgba(255,255,255,0.07)' }}
                 className="rounded-xl p-5 mb-4">
              <h2 className="font-display font-bold text-lg mb-3" style={{ color: '#f0f2f7' }}>+ Add Interstate</h2>
              <div className="flex gap-2 mb-4">
                <input className={`${ip} flex-1`} style={ipStyle} value={newI}
                  onChange={e => setNewI(e.target.value)}
                  placeholder="I-95" onKeyDown={e => e.key === 'Enter' && addI()}/>
                <button onClick={addI}
                  className="px-4 rounded-lg font-bold text-sm font-display"
                  style={{ background: '#f5a623', color: '#0d0f14' }}>Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {interstates.map(i => (
                  <button key={i.id} onClick={() => toggleI(i.id, i.is_active)}
                    className="px-3 py-1.5 rounded-full text-xs font-bold font-display transition-all"
                    style={{
                      background: i.is_active ? 'rgba(245,166,35,0.15)' : '#1c2030',
                      color: i.is_active ? '#f5a623' : '#8a93a8',
                      border: `1px solid ${i.is_active ? 'rgba(245,166,35,0.35)' : 'rgba(255,255,255,0.07)'}`,
                    }}>
                    {i.name} {i.is_active ? '✓' : '✗'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: '#14171f', border: '1px solid rgba(255,255,255,0.07)' }}
                 className="rounded-xl p-5 mb-4">
              <h2 className="font-display font-bold text-lg mb-3" style={{ color: '#f0f2f7' }}>+ Add Exit</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl} style={lblStyle}>Interstate *</label>
                  <select className={ip} style={ipStyle} value={exitForm.interstate_id}
                    onChange={e => setExitForm(f => ({ ...f, interstate_id: e.target.value }))}>
                    <option value="">Select…</option>
                    {interstates.filter(i => i.is_active).map(i =>
                      <option key={i.id} value={i.id}>{i.name}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>Direction *</label>
                  <select className={ip} style={ipStyle} value={exitForm.direction}
                    onChange={e => setExitForm(f => ({ ...f, direction: e.target.value }))}>
                    {['N','S','E','W'].map(d => <option key={d} value={d}>{d}bound</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>Mile Marker *</label>
                  <input className={ip} style={ipStyle} type="number" value={exitForm.mile_marker}
                    onChange={e => setExitForm(f => ({ ...f, mile_marker: e.target.value }))} placeholder="142"/>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>Exit Label</label>
                  <input className={ip} style={ipStyle} value={exitForm.exit_label}
                    onChange={e => setExitForm(f => ({ ...f, exit_label: e.target.value }))} placeholder="Exit 142"/>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>City</label>
                  <input className={ip} style={ipStyle} value={exitForm.city}
                    onChange={e => setExitForm(f => ({ ...f, city: e.target.value }))} placeholder="Smithfield"/>
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>State</label>
                  <input className={ip} style={ipStyle} value={exitForm.state}
                    onChange={e => setExitForm(f => ({ ...f, state: e.target.value }))} placeholder="NC"/>
                </div>
              </div>
              <button onClick={addExit}
                className="mt-4 px-5 py-2.5 rounded-lg font-display font-bold text-sm"
                style={{ background: '#f5a623', color: '#0d0f14' }}>
                Add Exit
              </button>
            </div>

            <div style={{ background: '#14171f', border: '1px solid rgba(255,255,255,0.07)' }}
                 className="rounded-xl overflow-hidden">
              <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <h3 className="font-display font-bold text-sm" style={{ color: '#f0f2f7' }}>
                  All Exits ({exits.length})
                </h3>
              </div>
              {exits.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: '#8a93a8' }}>No exits yet</div>
              ) : (
                <div>
                  {exits.map(e => (
                    <div key={e.id} className="px-5 py-3 flex items-center justify-between"
                         style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div>
                        <span className="font-display font-bold text-sm" style={{ color: '#f0f2f7' }}>
                          {e.interstates?.name} {e.direction}
                        </span>
                        <span className="text-xs ml-2" style={{ color: '#8a93a8' }}>
                          MM {e.mile_marker}{e.exit_label ? ` · ${e.exit_label}` : ''}
                          {e.city ? ` · ${e.city}, ${e.state}` : ''}
                        </span>
                      </div>
                      <button onClick={async () => {
                        if (confirm('Delete exit?')) { await supabase.from('exits').delete().eq('id', e.id); loadAll() }
                      }}
                        className="text-[11px] px-2 py-1 rounded"
                        style={{ background: '#1c2030', color: '#ff6b6b', border: '1px solid rgba(255,107,107,0.25)' }}>
                        Del
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'
