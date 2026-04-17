'use client'
import { useState, useEffect } from 'react'
import { supabase, type Hotel, type Interstate } from '@/lib/supabase'
import AdminGate from './AdminGate'

type Tab = 'hotels' | 'interstates' | 'hoteliers'

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

function AdminPageContent() {
  const [tab, setTab] = useState<Tab>('hotels')
  const [hotels, setHotels] = useState<any[]>([])
  const [interstates, setInterstates] = useState<Interstate[]>([])
  const [exits, setExits] = useState<any[]>([])
  const [hoteliers, setHoteliers] = useState<any[]>([])
  const [hotelierCalls, setHotelierCalls] = useState<Record<string, number>>({})
  const [form, setForm] = useState({ ...emptyHotel })
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [csvText, setCsvText] = useState('')
  const [newInterstate, setNewInterstate] = useState('')
  const [exitForm, setExitForm] = useState({ interstate_id: '', direction: 'N', exit_label: '', mile_marker: '', city: '', state: '', lat: '', lng: '' })

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: h }, { data: i }, { data: e }, { data: ht }, { data: cl }] = await Promise.all([
      supabase.from('hotels').select('*, exits(*, interstates(*))').order('created_at', { ascending: false }),
      supabase.from('interstates').select('*').order('name'),
      supabase.from('exits').select('*, interstates(name)').order('mile_marker'),
      supabase.from('hoteliers').select('*').order('created_at', { ascending: false }),
      supabase.from('call_logs').select('hotelier_id, called_at'),
    ])
    if (h) setHotels(h); if (i) setInterstates(i); if (e) setExits(e)
    if (ht) setHoteliers(ht)
    if (cl) {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const counts: Record<string, number> = {}
      for (const c of cl) {
        if (!c.hotelier_id) continue
        if (new Date(c.called_at) >= monthStart) {
          counts[c.hotelier_id] = (counts[c.hotelier_id] || 0) + 1
        }
      }
      setHotelierCalls(counts)
    }
  }

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  async function saveHotel() {
    if (!form.name || !form.exit_id) { flash('Name and exit are required'); return }
    setLoading(true)
    const payload = {
      name: form.name, phone: form.phone, address: form.address,
      price_min: form.price_min ? parseInt(form.price_min) : null,
      price_max: form.price_max ? parseInt(form.price_max) : null,
      amenities: form.amenities, availability_badge: form.availability_badge,
      featured: form.featured, photo_url: form.photo_url, exit_id: form.exit_id,
    }
    if (editId) {
      await supabase.from('hotels').update(payload).eq('id', editId)
      flash('Hotel updated ✓')
    } else {
      await supabase.from('hotels').insert(payload)
      flash('Hotel added ✓')
    }
    setForm({ ...emptyHotel }); setEditId(null); setLoading(false); loadAll()
  }

  async function deleteHotel(id: string) {
    if (!confirm('Delete this hotel?')) return
    await supabase.from('hotels').delete().eq('id', id); loadAll()
  }

  function editHotel(h: any) {
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
    flash(`${count} hotels imported ✓`); setCsvText(''); loadAll()
  }

  async function addInterstate() {
    if (!newInterstate.trim()) return
    await supabase.from('interstates').insert({ name: newInterstate.trim().toUpperCase() })
    setNewInterstate(''); flash('Interstate added ✓'); loadAll()
  }

  async function toggleInterstate(id: string, active: boolean) {
    await supabase.from('interstates').update({ is_active: !active }).eq('id', id); loadAll()
  }

  async function addExit() {
    if (!exitForm.interstate_id || !exitForm.mile_marker) { flash('Interstate and mile marker required'); return }
    await supabase.from('exits').insert({
      interstate_id: exitForm.interstate_id, direction: exitForm.direction,
      exit_label: exitForm.exit_label, mile_marker: parseFloat(exitForm.mile_marker),
      city: exitForm.city, state: exitForm.state,
      lat: exitForm.lat ? parseFloat(exitForm.lat) : null,
      lng: exitForm.lng ? parseFloat(exitForm.lng) : null,
    })
    setExitForm({ interstate_id: '', direction: 'N', exit_label: '', mile_marker: '', city: '', state: '', lat: '', lng: '' })
    flash('Exit added ✓'); loadAll()
  }

  async function toggleFeatured(id: string, val: boolean) {
    await supabase.from('hotels').update({ featured: !val }).eq('id', id); loadAll()
  }

  async function updateBadge(id: string, badge: string) {
    await supabase.from('hotels').update({ availability_badge: badge }).eq('id', id); loadAll()
  }

  const toggleAmenity = (key: string) => {
    setForm(f => ({ ...f, amenities: f.amenities.includes(key) ? f.amenities.filter(a => a !== key) : [...f.amenities, key] }))
  }

  const cardStyle = { background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '14px' }
  const btnGhost = { background: 'transparent', border: '1px solid var(--border)', color: 'var(--mist)',
    padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '24px 20px 48px' }}>
      {msg && (
        <div style={{
          position: 'fixed', top: '72px', right: '20px', zIndex: 50,
          background: 'var(--green)', color: 'var(--night)', padding: '10px 16px',
          borderRadius: '8px', fontSize: '13px', fontWeight: 600,
        }}>{msg}</div>
      )}

      <div style={{ maxWidth: '820px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontFamily: 'Syne, sans-serif', marginBottom: '4px', color: 'var(--white)' }}>
          Admin <span style={{ color: 'var(--amber)' }}>Panel</span>
        </h1>
        <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '24px' }}>Manage hotels, interstates, and exits</p>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid var(--border)' }}>
          {(['hotels', 'interstates', 'hoteliers'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'none', border: 'none',
              color: tab === t ? 'var(--amber)' : 'var(--fog)',
              borderBottom: tab === t ? '2px solid var(--amber)' : '2px solid transparent',
              padding: '10px 4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif', marginBottom: '-1px',
            }}>
              {t === 'hotels' ? '🏨 Hotels' : t === 'interstates' ? '🛣️ Interstates & Exits' : '👤 Hoteliers'}
            </button>
          ))}
        </div>

        {tab === 'hotels' && (
          <>
            {/* Add/Edit Hotel Form */}
            <div style={{ ...cardStyle, padding: '20px', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '16px', fontFamily: 'Syne, sans-serif', marginBottom: '16px', color: 'var(--white)' }}>
                {editId ? '✏️ Edit Hotel' : '+ Add Hotel'}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="dark-label">Hotel Name *</label>
                  <input className="dark-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Sleep Inn I-95"/>
                </div>
                <div>
                  <label className="dark-label">Phone</label>
                  <input className="dark-input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="555-123-4567"/>
                </div>
                <div>
                  <label className="dark-label">Exit *</label>
                  <select className="dark-input" value={form.exit_id} onChange={e => setForm(f => ({ ...f, exit_id: e.target.value }))}>
                    <option value="">Select exit...</option>
                    {exits.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.interstates?.name} {e.direction} · MM {e.mile_marker} · {e.city}, {e.state}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="dark-label">Address</label>
                  <input className="dark-input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Highway Dr, City, ST"/>
                </div>
                <div>
                  <label className="dark-label">Price Min ($/night)</label>
                  <input className="dark-input" type="number" value={form.price_min} onChange={e => setForm(f => ({ ...f, price_min: e.target.value }))} placeholder="59"/>
                </div>
                <div>
                  <label className="dark-label">Price Max ($/night)</label>
                  <input className="dark-input" type="number" value={form.price_max} onChange={e => setForm(f => ({ ...f, price_max: e.target.value }))} placeholder="89"/>
                </div>
                <div>
                  <label className="dark-label">Availability</label>
                  <select className="dark-input" value={form.availability_badge} onChange={e => setForm(f => ({ ...f, availability_badge: e.target.value }))}>
                    <option value="available">🟢 Likely Available</option>
                    <option value="limited">🟡 Maybe Full</option>
                    <option value="full">🔴 Often Full</option>
                  </select>
                </div>
                <div>
                  <label className="dark-label">Photo URL</label>
                  <input className="dark-input" value={form.photo_url} onChange={e => setForm(f => ({ ...f, photo_url: e.target.value }))} placeholder="https://..."/>
                </div>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label className="dark-label">Amenities</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {AMENITY_OPTIONS.map(a => {
                    const on = form.amenities.includes(a.key)
                    return (
                      <button key={a.key} type="button" onClick={() => toggleAmenity(a.key)} style={{
                        background: on ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                        color: on ? 'var(--amber)' : 'var(--fog)',
                        border: on ? '1px solid var(--amber)' : '1px solid var(--border)',
                        padding: '6px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer', fontWeight: 500,
                      }}>{a.label}</button>
                    )
                  })}
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: 'var(--mist)', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.featured} onChange={e => setForm(f => ({ ...f, featured: e.target.checked }))} style={{ accentColor: 'var(--amber)', width: '16px', height: '16px' }}/>
                ★ Featured listing
              </label>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={saveHotel} disabled={loading} className="btn-amber" style={{ flex: 1, padding: '12px', fontSize: '13px' }}>
                  {loading ? 'SAVING...' : editId ? 'UPDATE HOTEL' : 'ADD HOTEL'}
                </button>
                {editId && (
                  <button onClick={() => { setEditId(null); setForm({ ...emptyHotel }) }} style={{
                    background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--mist)',
                    padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
                  }}>Cancel</button>
                )}
              </div>
            </div>

            {/* CSV Import */}
            <details style={{ ...cardStyle, marginBottom: '16px' }}>
              <summary style={{ padding: '14px 20px', cursor: 'pointer', color: 'var(--mist)', fontSize: '13px', fontWeight: 500, listStyle: 'none' }}>
                📄 Bulk CSV Import
              </summary>
              <div style={{ padding: '0 20px 20px' }}>
                <p style={{ fontSize: '11px', color: 'var(--fog)', marginBottom: '8px' }}>
                  One per line: name, phone, address, exit_id, price_min, price_max
                </p>
                <textarea
                  value={csvText} onChange={e => setCsvText(e.target.value)}
                  className="dark-input" style={{ height: '100px', fontFamily: 'DM Mono, monospace', fontSize: '12px', marginBottom: '8px' }}
                  placeholder="Sleep Inn, 555-111-2222, 123 Hwy Dr, exit-uuid, 59, 89"/>
                <button onClick={importCSV} className="btn-amber" style={{ padding: '8px 14px', fontSize: '12px' }}>Import</button>
              </div>
            </details>

            {/* Hotels List */}
            <div style={cardStyle}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: '14px', fontFamily: 'Syne, sans-serif', color: 'var(--white)' }}>
                  All Hotels ({hotels.length})
                </h3>
              </div>
              {hotels.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fog)', fontSize: '13px' }}>No hotels yet</div>
              ) : (
                <div>
                  {hotels.map(h => {
                    const exit = h.exits
                    return (
                      <div key={h.id} style={{
                        padding: '14px 20px', borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'flex-start', gap: '12px',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--white)', fontSize: '13px' }}>{h.name}</span>
                            {h.featured && (
                              <span style={{
                                fontSize: '10px', background: 'rgba(245,166,35,0.15)', color: 'var(--amber)',
                                padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                              }}>★ Featured</span>
                            )}
                          </div>
                          {exit && (
                            <p style={{ fontSize: '11px', color: 'var(--fog)' }}>
                              {exit.interstates?.name} · MM {exit.mile_marker} · {exit.city}, {exit.state}
                            </p>
                          )}
                          <p style={{ fontSize: '11px', color: 'var(--mist)' }}>{h.phone}</p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                          <select value={h.availability_badge || 'available'} onChange={e => updateBadge(h.id, e.target.value)}
                            style={{ ...btnGhost, background: 'var(--night3)' }}>
                            <option value="available">🟢 Available</option>
                            <option value="limited">🟡 Limited</option>
                            <option value="full">🔴 Full</option>
                          </select>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button onClick={() => toggleFeatured(h.id, h.featured)} style={btnGhost}>
                              {h.featured ? '★ Unfeat' : '☆ Feat'}
                            </button>
                            <button onClick={() => editHotel(h)} style={{ ...btnGhost, color: 'var(--blue)' }}>Edit</button>
                            <button onClick={() => deleteHotel(h.id)} style={{ ...btnGhost, color: 'var(--red)' }}>Del</button>
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
            <div style={{ ...cardStyle, padding: '20px', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '16px', fontFamily: 'Syne, sans-serif', marginBottom: '12px', color: 'var(--white)' }}>+ Add Interstate</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="dark-input" value={newInterstate} onChange={e => setNewInterstate(e.target.value)}
                  placeholder="I-95" onKeyDown={e => e.key === 'Enter' && addInterstate()} style={{ flex: 1 }}/>
                <button onClick={addInterstate} className="btn-amber" style={{ padding: '10px 18px', fontSize: '13px' }}>Add</button>
              </div>
              <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {interstates.map(i => (
                  <button key={i.id} onClick={() => toggleInterstate(i.id, i.is_active)} style={{
                    padding: '6px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 600,
                    background: i.is_active ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                    color: i.is_active ? 'var(--amber)' : 'var(--fog)',
                    border: i.is_active ? '1px solid var(--amber)' : '1px solid var(--border)',
                    cursor: 'pointer',
                  }}>
                    {i.name} {i.is_active ? '✓' : '✗'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ ...cardStyle, padding: '20px', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '16px', fontFamily: 'Syne, sans-serif', marginBottom: '12px', color: 'var(--white)' }}>+ Add Exit</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                <div>
                  <label className="dark-label">Interstate *</label>
                  <select className="dark-input" value={exitForm.interstate_id} onChange={e => setExitForm(f => ({ ...f, interstate_id: e.target.value }))}>
                    <option value="">Select...</option>
                    {interstates.filter(i => i.is_active).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="dark-label">Direction *</label>
                  <select className="dark-input" value={exitForm.direction} onChange={e => setExitForm(f => ({ ...f, direction: e.target.value }))}>
                    {['N','S','E','W'].map(d => <option key={d} value={d}>{d}bound</option>)}
                  </select>
                </div>
                <div>
                  <label className="dark-label">Mile Marker *</label>
                  <input className="dark-input" type="number" value={exitForm.mile_marker} onChange={e => setExitForm(f => ({ ...f, mile_marker: e.target.value }))} placeholder="142"/>
                </div>
                <div>
                  <label className="dark-label">Exit Label</label>
                  <input className="dark-input" value={exitForm.exit_label} onChange={e => setExitForm(f => ({ ...f, exit_label: e.target.value }))} placeholder="Exit 142"/>
                </div>
                <div>
                  <label className="dark-label">City</label>
                  <input className="dark-input" value={exitForm.city} onChange={e => setExitForm(f => ({ ...f, city: e.target.value }))} placeholder="Gainesville"/>
                </div>
                <div>
                  <label className="dark-label">State</label>
                  <input className="dark-input" value={exitForm.state} onChange={e => setExitForm(f => ({ ...f, state: e.target.value }))} placeholder="FL"/>
                </div>
                <div>
                  <label className="dark-label">Latitude</label>
                  <input className="dark-input" type="number" step="0.000001" value={exitForm.lat} onChange={e => setExitForm(f => ({ ...f, lat: e.target.value }))} placeholder="29.2108"/>
                </div>
                <div>
                  <label className="dark-label">Longitude</label>
                  <input className="dark-input" type="number" step="0.000001" value={exitForm.lng} onChange={e => setExitForm(f => ({ ...f, lng: e.target.value }))} placeholder="-81.0228"/>
                </div>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--fog)', marginTop: '8px' }}>
                💡 Get lat/lng from Google Maps — right-click any spot → copy coordinates
              </p>
              <button onClick={addExit} className="btn-amber" style={{ marginTop: '14px', padding: '10px 18px', fontSize: '13px' }}>Add Exit</button>
            </div>

            <div style={cardStyle}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: '14px', fontFamily: 'Syne, sans-serif', color: 'var(--white)' }}>All Exits ({exits.length})</h3>
              </div>
              {exits.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fog)', fontSize: '13px' }}>No exits yet</div>
              ) : (
                <div>
                  {exits.map(e => (
                    <div key={e.id} style={{
                      padding: '12px 20px', borderBottom: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div style={{ fontSize: '13px' }}>
                        <span style={{ color: 'var(--white)', fontWeight: 600 }}>{e.interstates?.name} {e.direction}</span>
                        <span style={{ color: 'var(--fog)' }}> · MM {e.mile_marker}</span>
                        {e.exit_label && <span style={{ color: 'var(--fog)' }}> · {e.exit_label}</span>}
                        {e.city && <span style={{ color: 'var(--fog)' }}> · {e.city}, {e.state}</span>}
                      </div>
                      <button onClick={async () => { if (confirm('Delete exit?')) { await supabase.from('exits').delete().eq('id', e.id); loadAll() }}}
                        style={{ ...btnGhost, color: 'var(--red)' }}>Del</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'hoteliers' && (
          <>
            <div style={{ ...cardStyle, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '14px', fontFamily: 'Syne, sans-serif', color: 'var(--white)' }}>Hoteliers — Billing Overview ({hoteliers.length})</h3>
              </div>
              {hoteliers.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fog)', fontSize: '13px' }}>No hoteliers signed up yet</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: 'var(--night3)', fontSize: '10px', color: 'var(--fog)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                        <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500 }}>Name / Email</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 500 }}>Billing Type</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 500 }}>Rate</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 500 }}>Calls This Mo.</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 500 }}>Amount Owed</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 500 }}>Status</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 500 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hoteliers.map(h => {
                        const calls = hotelierCalls[h.id] || 0
                        const rate = h.rate || 5
                        const bType = h.billing_type || 'per_call'
                        const owed = bType === 'monthly' ? rate : calls * rate
                        const statusColor = h.billing_status === 'active' ? 'var(--green)' : h.billing_status === 'unpaid' ? 'var(--red)' : 'var(--fog)'
                        return (
                          <tr key={h.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '12px 14px' }}>
                              <div style={{ color: 'var(--white)', fontWeight: 600 }}>{h.name}</div>
                              <div style={{ color: 'var(--fog)', fontSize: '11px' }}>{h.email}</div>
                              {h.business_phone && <div style={{ color: 'var(--fog)', fontSize: '11px' }}>{h.business_phone}</div>}
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <select value={bType} onChange={async e => {
                                await supabase.from('hoteliers').update({ billing_type: e.target.value }).eq('id', h.id); loadAll()
                              }} style={{ background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--mist)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                                <option value="per_call">Per Call</option>
                                <option value="monthly">Monthly</option>
                              </select>
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                                <span style={{ color: 'var(--fog)', fontSize: '12px' }}>$</span>
                                <input type="number" defaultValue={rate} onBlur={async e => {
                                  await supabase.from('hoteliers').update({ rate: parseInt(e.target.value) || 5 }).eq('id', h.id); loadAll()
                                }} style={{ width: '52px', background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--white)', padding: '4px 6px', borderRadius: '6px', fontSize: '12px', textAlign: 'center' }} />
                                <span style={{ color: 'var(--fog)', fontSize: '11px' }}>{bType === 'per_call' ? '/call' : '/mo'}</span>
                              </div>
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'center', color: 'var(--white)', fontWeight: 600 }}>{calls}</td>
                            <td style={{ padding: '12px 14px', textAlign: 'center', color: 'var(--amber)', fontWeight: 700, fontSize: '15px' }}>${owed.toLocaleString()}</td>
                            <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <select value={h.billing_status || 'active'} onChange={async e => {
                                await supabase.from('hoteliers').update({ billing_status: e.target.value }).eq('id', h.id); loadAll()
                              }} style={{ background: 'var(--night3)', border: `1px solid ${statusColor}`, color: statusColor, padding: '4px 8px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
                                <option value="active">Active</option>
                                <option value="paused">Paused</option>
                                <option value="unpaid">Unpaid</option>
                              </select>
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <button onClick={async () => { if (confirm(`Delete ${h.name}?`)) { await supabase.from('hoteliers').delete().eq('id', h.id); loadAll() }}}
                                style={{ ...btnGhost, color: 'var(--red)' }}>Del</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export default function AdminPage() {
  return <AdminGate><AdminPageContent /></AdminGate>
}

export const dynamic = 'force-dynamic'
