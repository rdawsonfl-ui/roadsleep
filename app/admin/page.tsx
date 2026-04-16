'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase, type Hotel, type Interstate } from '@/lib/supabase'

type Tab = 'hotels' | 'interstates'

const AMENITY_OPTIONS = [
  { key: 'truck_parking', label: '🚛 Truck Parking' },
  { key: 'pets', label: '🐾 Pets OK' },
  { key: '24hr_checkin', label: '🌙 24hr Check-in' },
  { key: 'wifi', label: '📶 WiFi' },
  { key: 'pool', label: '🏊 Pool' },
]

const emptyHotel = {
  name: '', phone: '', address: '', price_min: '', price_max: '',
  amenities: [] as string[], availability_badge: 'available', featured: false,
  photo_url: '', exit_id: ''
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('hotels')
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [interstates, setInterstates] = useState<Interstate[]>([])
  const [exits, setExits] = useState<any[]>([])
  const [form, setForm] = useState({ ...emptyHotel })
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [csvText, setCsvText] = useState('')
  const [newInterstate, setNewInterstate] = useState('')
  const [exitForm, setExitForm] = useState({ interstate_id: '', direction: 'N', exit_label: '', mile_marker: '', city: '', state: '' })
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: h }, { data: i }, { data: e }] = await Promise.all([
      supabase.from('hotels').select('*, exits(*, interstates(*))').order('created_at', { ascending: false }),
      supabase.from('interstates').select('*').order('name'),
      supabase.from('exits').select('*, interstates(name)').order('mile_marker'),
    ])
    if (h) setHotels(h)
    if (i) setInterstates(i)
    if (e) setExits(e)
  }

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  async function saveHotel() {
    if (!form.name || !form.exit_id) { flash('Name and exit are required'); return }
    setLoading(true)
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
      flash('Hotel updated ✓')
    } else {
      await supabase.from('hotels').insert(payload)
      flash('Hotel added ✓')
    }
    setForm({ ...emptyHotel })
    setEditId(null)
    setLoading(false)
    loadAll()
  }

  async function deleteHotel(id: string) {
    if (!confirm('Delete this hotel?')) return
    await supabase.from('hotels').delete().eq('id', id)
    loadAll()
  }

  function editHotel(h: Hotel) {
    setEditId(h.id)
    setForm({
      name: h.name, phone: h.phone || '', address: h.address || '',
      price_min: h.price_min?.toString() || '', price_max: h.price_max?.toString() || '',
      amenities: h.amenities || [], availability_badge: h.availability_badge || 'available',
      featured: h.featured || false, photo_url: h.photo_url || '', exit_id: h.exit_id,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function importCSV() {
    const lines = csvText.trim().split('\n').filter(l => l.trim())
    let count = 0
    for (const line of lines) {
      const [name, phone, address, exit_id, price_min, price_max] = line.split(',').map(s => s.trim())
      if (!name || !exit_id) continue
      await supabase.from('hotels').insert({
        name, phone, address, exit_id,
        price_min: price_min ? parseInt(price_min) : null,
        price_max: price_max ? parseInt(price_max) : null,
        availability_badge: 'available',
      })
      count++
    }
    flash(`${count} hotels imported ✓`)
    setCsvText('')
    loadAll()
  }

  async function addInterstate() {
    if (!newInterstate.trim()) return
    await supabase.from('interstates').insert({ name: newInterstate.trim().toUpperCase() })
    setNewInterstate('')
    flash('Interstate added ✓')
    loadAll()
  }

  async function toggleInterstate(id: string, active: boolean) {
    await supabase.from('interstates').update({ is_active: !active }).eq('id', id)
    loadAll()
  }

  async function addExit() {
    if (!exitForm.interstate_id || !exitForm.mile_marker) { flash('Interstate and mile marker required'); return }
    await supabase.from('exits').insert({
      interstate_id: exitForm.interstate_id,
      direction: exitForm.direction,
      exit_label: exitForm.exit_label,
      mile_marker: parseFloat(exitForm.mile_marker),
      city: exitForm.city,
      state: exitForm.state,
    })
    setExitForm({ interstate_id: '', direction: 'N', exit_label: '', mile_marker: '', city: '', state: '' })
    flash('Exit added ✓')
    loadAll()
  }

  async function toggleFeatured(id: string, val: boolean) {
    await supabase.from('hotels').update({ featured: !val }).eq('id', id)
    loadAll()
  }

  async function updateBadge(id: string, badge: string) {
    await supabase.from('hotels').update({ availability_badge: badge }).eq('id', id)
    loadAll()
  }

  const toggleAmenity = (key: string) => {
    setForm(f => ({
      ...f,
      amenities: f.amenities.includes(key) ? f.amenities.filter(a => a !== key) : [...f.amenities, key]
    }))
  }

  return (
    <div className="min-h-screen" style={{ background: '#f5f0e8' }}>
      <header style={{ background: '#1a1a1a' }} className="px-4 py-4 flex items-center justify-between">
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '24px', fontWeight: 800, color: 'white', letterSpacing: '0.05em' }}>
          ROAD<span style={{ color: '#f5c842' }}>SLEEP</span>
          <span className="text-sm font-normal text-gray-400 ml-2">Admin</span>
        </div>
        <a href="/" className="text-xs text-gray-400 hover:text-white">← App</a>
      </header>
      <div className="road-stripe" />

      {msg && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-lg">
          {msg}
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(['hotels', 'interstates'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-5 py-2 rounded-xl text-sm font-bold capitalize transition-all"
              style={{
                background: tab === t ? '#2c6e49' : '#fff',
                color: tab === t ? 'white' : '#6b7280',
                fontFamily: 'Barlow Condensed, sans-serif',
                fontSize: '16px',
                letterSpacing: '0.03em'
              }}>
              {t === 'hotels' ? '🏨 Hotels' : '🛣️ Interstates & Exits'}
            </button>
          ))}
        </div>

        {tab === 'hotels' && (
          <>
            {/* Add/Edit Hotel Form */}
            <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
              <h2 className="font-black text-lg mb-4" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                {editId ? '✏️ Edit Hotel' : '+ Add Hotel'}
              </h2>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="col-span-2">
                  <label className="label">Hotel Name *</label>
                  <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Sleep Inn I-95"/>
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="555-123-4567"/>
                </div>
                <div>
                  <label className="label">Exit *</label>
                  <select className="input" value={form.exit_id} onChange={e => setForm(f => ({ ...f, exit_id: e.target.value }))}>
                    <option value="">Select exit...</option>
                    {exits.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.interstates?.name} {e.direction} · MM {e.mile_marker} · {e.exit_label} · {e.city}, {e.state}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="label">Address</label>
                  <input className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Highway Dr, City, ST"/>
                </div>
                <div>
                  <label className="label">Price Min ($/night)</label>
                  <input className="input" type="number" value={form.price_min} onChange={e => setForm(f => ({ ...f, price_min: e.target.value }))} placeholder="59"/>
                </div>
                <div>
                  <label className="label">Price Max ($/night)</label>
                  <input className="input" type="number" value={form.price_max} onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))} placeholder="89"/>
                </div>
                <div>
                  <label className="label">Availability</label>
                  <select className="input" value={form.availability_badge} onChange={e => setForm(f => ({ ...f, availability_badge: e.target.value }))}>
                    <option value="available">Available</option>
                    <option value="limited">Limited</option>
                    <option value="full">Full</option>
                  </select>
                </div>
                <div>
                  <label className="label">Photo URL</label>
                  <input className="input" value={form.photo_url} onChange={e => setForm(f => ({ ...f, photo_url: e.target.value }))} placeholder="https://..."/>
                </div>
              </div>

              <div className="mb-3">
                <label className="label">Amenities</label>
                <div className="flex flex-wrap gap-2">
                  {AMENITY_OPTIONS.map(a => (
                    <button key={a.key} type="button" onClick={() => toggleAmenity(a.key)}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                      style={{
                        background: form.amenities.includes(a.key) ? '#2c6e49' : '#f3f4f6',
                        color: form.amenities.includes(a.key) ? 'white' : '#6b7280'
                      }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-600 mb-4 cursor-pointer">
                <input type="checkbox" checked={form.featured} onChange={e => setForm(f => ({ ...f, featured: e.target.checked }))} className="w-4 h-4 accent-green-700"/>
                Featured listing
              </label>

              <div className="flex gap-2">
                <button onClick={saveHotel} disabled={loading}
                  className="flex-1 py-3 rounded-xl text-white font-black text-lg disabled:opacity-60 transition-all"
                  style={{ background: '#2c6e49', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.05em' }}>
                  {loading ? 'SAVING...' : editId ? 'UPDATE HOTEL' : 'ADD HOTEL'}
                </button>
                {editId && (
                  <button onClick={() => { setEditId(null); setForm({ ...emptyHotel }) }}
                    className="px-4 py-3 rounded-xl text-gray-600 font-semibold text-sm bg-gray-100 hover:bg-gray-200 transition-all">
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* CSV Import */}
            <details className="bg-white rounded-2xl shadow-sm overflow-hidden mb-5">
              <summary className="px-5 py-4 cursor-pointer text-sm font-semibold text-gray-600 list-none flex items-center gap-2">
                📄 Bulk CSV Import
              </summary>
              <div className="px-5 pb-5">
                <p className="text-xs text-gray-400 mb-2">One per line: name, phone, address, exit_id, price_min, price_max</p>
                <textarea
                  className="w-full border border-gray-200 rounded-xl p-3 text-xs font-mono bg-gray-50 h-24 mb-2 focus:outline-none"
                  value={csvText} onChange={e => setCsvText(e.target.value)}
                  placeholder="Sleep Inn, 555-111-2222, 123 Hwy Dr, exit-uuid, 59, 89"/>
                <button onClick={importCSV} className="px-4 py-2 rounded-xl text-white text-sm font-bold" style={{ background: '#2c6e49' }}>
                  Import
                </button>
              </div>
            </details>

            {/* Hotels List */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="font-black text-base" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                  All Hotels ({hotels.length})
                </h3>
              </div>
              {hotels.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No hotels yet</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {hotels.map(h => {
                    const exit = (h as any).exits
                    return (
                      <div key={h.id} className="px-5 py-4 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-900">{h.name}</span>
                            {h.featured && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-semibold">⭐ Featured</span>}
                          </div>
                          {exit && <p className="text-xs text-gray-400">{exit.interstates?.name} · MM {exit.mile_marker} · {exit.city}, {exit.state}</p>}
                          <p className="text-xs text-gray-500">{h.phone}</p>
                        </div>
                        <div className="flex flex-col gap-1.5 items-end shrink-0">
                          <select
                            value={h.availability_badge || 'available'}
                            onChange={e => updateBadge(h.id, e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-gray-50">
                            <option value="available">Available</option>
                            <option value="limited">Limited</option>
                            <option value="full">Full</option>
                          </select>
                          <div className="flex gap-1.5">
                            <button onClick={() => toggleFeatured(h.id, h.featured)}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                              {h.featured ? '★ Unfeature' : '☆ Feature'}
                            </button>
                            <button onClick={() => editHotel(h)}
                              className="text-xs px-2 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50">
                              Edit
                            </button>
                            <button onClick={() => deleteHotel(h.id)}
                              className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">
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

        {tab === 'interstates' && (
          <>
            {/* Add Interstate */}
            <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
              <h2 className="font-black text-lg mb-3" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>+ Add Interstate</h2>
              <div className="flex gap-2">
                <input className="input flex-1" value={newInterstate}
                  onChange={e => setNewInterstate(e.target.value)}
                  placeholder="I-95" onKeyDown={e => e.key === 'Enter' && addInterstate()}/>
                <button onClick={addInterstate} className="px-4 py-2.5 rounded-xl text-white font-bold text-sm" style={{ background: '#2c6e49' }}>Add</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {interstates.map(i => (
                  <button key={i.id} onClick={() => toggleInterstate(i.id, i.is_active)}
                    className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                    style={{
                      background: i.is_active ? '#2c6e49' : '#f3f4f6',
                      color: i.is_active ? 'white' : '#9ca3af'
                    }}>
                    {i.name} {i.is_active ? '✓' : '✗'}
                  </button>
                ))}
              </div>
            </div>

            {/* Add Exit */}
            <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
              <h2 className="font-black text-lg mb-3" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>+ Add Exit</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Interstate *</label>
                  <select className="input" value={exitForm.interstate_id} onChange={e => setExitForm(f => ({ ...f, interstate_id: e.target.value }))}>
                    <option value="">Select...</option>
                    {interstates.filter(i => i.is_active).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Direction *</label>
                  <select className="input" value={exitForm.direction} onChange={e => setExitForm(f => ({ ...f, direction: e.target.value }))}>
                    {['N','S','E','W'].map(d => <option key={d} value={d}>{d}bound</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Mile Marker *</label>
                  <input className="input" type="number" value={exitForm.mile_marker} onChange={e => setExitForm(f => ({ ...f, mile_marker: e.target.value }))} placeholder="142"/>
                </div>
                <div>
                  <label className="label">Exit Label</label>
                  <input className="input" value={exitForm.exit_label} onChange={e => setExitForm(f => ({ ...f, exit_label: e.target.value }))} placeholder="Exit 142"/>
                </div>
                <div>
                  <label className="label">City</label>
                  <input className="input" value={exitForm.city} onChange={e => setExitForm(f => ({ ...f, city: e.target.value }))} placeholder="Gainesville"/>
                </div>
                <div>
                  <label className="label">State</label>
                  <input className="input" value={exitForm.state} onChange={e => setExitForm(f => ({ ...f, state: e.target.value }))} placeholder="FL"/>
                </div>
              </div>
              <button onClick={addExit} className="mt-3 px-5 py-2.5 rounded-xl text-white font-bold text-sm" style={{ background: '#2c6e49' }}>
                Add Exit
              </button>
            </div>

            {/* Exits list */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="font-black text-base" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>All Exits ({exits.length})</h3>
              </div>
              {exits.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No exits yet</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {exits.map(e => (
                    <div key={e.id} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-sm">{e.interstates?.name} {e.direction}</span>
                        <span className="text-gray-400 text-sm"> · MM {e.mile_marker}</span>
                        {e.exit_label && <span className="text-gray-400 text-sm"> · {e.exit_label}</span>}
                        {e.city && <span className="text-gray-400 text-sm"> · {e.city}, {e.state}</span>}
                      </div>
                      <button onClick={async () => { if (confirm('Delete exit?')) { await supabase.from('exits').delete().eq('id', e.id); loadAll() }}}
                        className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">
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

      <style jsx global>{`
        .label { display: block; font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
        .input { width: 100%; border: 1px solid #e5e7eb; border-radius: 10px; padding: 9px 12px; font-size: 14px; background: #f9fafb; outline: none; transition: border-color 0.15s; }
        .input:focus { border-color: #2c6e49; background: white; }
      `}</style>
    </div>
  )
}

export const dynamic = 'force-dynamic'
