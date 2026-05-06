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
  name: '', phone: '', address: '',
  // Structured address — preferred over the legacy single 'address' field.
  // 'address' stays around as a fallback so old data still renders.
  street_address: '', city: '', state: '', zip: '',
  price_min: '', price_max: '',
  amenities: [] as string[], featured: false,
  photo_url: '', exit_id: '',
  // Category — 'hotel' (default) or 'rv_park'. Driver page filters on this.
  type: 'hotel' as 'hotel' | 'rv_park',
}

function AdminPageContent() {
  const [tab, setTab] = useState<Tab>('hotels')
  const [hotels, setHotels] = useState<any[]>([])
  const [interstates, setInterstates] = useState<Interstate[]>([])
  const [exits, setExits] = useState<any[]>([])
  const [hoteliers, setHoteliers] = useState<any[]>([])
  const [hotelierCalls, setHotelierCalls] = useState<Record<string, number>>({})
  // Per-hotel call counts attributed to the hotel's boost window. Computed
  // client-side from call_logs.called_at vs. hotels.boost_started_at /
  // boost_ends_at — no schema changes needed because both timestamps already
  // exist on the hotels row when the hotelier turns boost on.
  //   duringCurrent: calls inside the CURRENTLY LIVE boost (only meaningful
  //                  while boost_ends_at is in the future).
  //   lastBoost:     calls inside the MOST RECENT boost window — useful as a
  //                  recap right after a boost ends, so admin can see what
  //                  the campaign produced.
  const [boostCalls, setBoostCalls] = useState<Record<string, { duringCurrent: number; lastBoost: number }>>({})
  // Per-hotel ALL-TIME total call counts, regardless of boost status or
  // whether the hotel has a hotelier account. Used so admin can see at a
  // glance how much call volume each property is pulling from the app.
  // Pairs with boostCalls so admin can compare organic vs boost-attributed.
  const [hotelCallTotals, setHotelCallTotals] = useState<Record<string, number>>({})
  const [form, setForm] = useState({ ...emptyHotel })
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [csvText, setCsvText] = useState('')
  const [newInterstate, setNewInterstate] = useState('')
  const [exitForm, setExitForm] = useState({ interstate_id: '', direction: 'N', exit_label: '', mile_marker: '', city: '', state: '', lat: '', lng: '' })
  // Listings filter — same 2-button toggle as the driver page (no 'All').
  // Default to Hotels because that's where most of the inventory is and most
  // of the verification work happens.
  const [adminCategory, setAdminCategory] = useState<'hotel' | 'rv_park'>('hotel')

  // Testing-mode toggle. When ON, drivers see ALL listings (verified +
  // unverified). When OFF (production), only verified=true show. The green
  // '✔ Front desk confirmed' badge stays bound to verified=true regardless,
  // so the badge keeps its meaning even while testing.
  const [testingMode, setTestingMode] = useState<boolean>(false)
  const [testingModeLoaded, setTestingModeLoaded] = useState<boolean>(false)

  useEffect(() => { loadAll() }, [])

  // Load the testing-mode setting on mount.
  useEffect(() => {
    let cancelled = false
    supabase.from('settings').select('value').eq('key', 'show_unverified_to_drivers').single()
      .then(({ data }) => {
        if (cancelled) return
        setTestingMode(data?.value === 'true')
        setTestingModeLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  // Flip the toggle and persist immediately. Optimistic UI — flip the local
  // state right away, save in background. If save fails we'd want to revert,
  // but for an admin-only page the failure mode is acceptable.
  async function toggleTestingMode(next: boolean) {
    setTestingMode(next)
    await supabase.from('settings')
      .upsert({ key: 'show_unverified_to_drivers', value: next ? 'true' : 'false' }, { onConflict: 'key' })
  }

  async function loadAll() {
    const [{ data: h }, { data: i }, { data: e }, { data: ht }, { data: cl }] = await Promise.all([
      supabase.from('hotels').select('*, exits(*, interstates(*))'),
      supabase.from('interstates').select('*').order('name'),
      supabase.from('exits').select('*, interstates(name)').order('mile_marker'),
      supabase.from('hoteliers').select('*').order('created_at', { ascending: false }),
      // Pull hotel_id + called_at too so we can compute boost-window calls
      // per hotel below. hotelier_id stays so the Hoteliers tab works.
      supabase.from('call_logs').select('hotel_id, hotelier_id, called_at'),
    ])
    if (h) {
      // Sort geographically: interstate name → state → mile marker (ascending)
      // This way the admin list reads like driving the corridor north-to-south.
      const sorted = [...h].sort((a, b) => {
        const intA = a.exits?.interstates?.name || 'zzz'
        const intB = b.exits?.interstates?.name || 'zzz'
        if (intA !== intB) return intA.localeCompare(intB)
        const stA = a.exits?.state || a.state || 'ZZ'
        const stB = b.exits?.state || b.state || 'ZZ'
        if (stA !== stB) return stA.localeCompare(stB)
        const mmA = parseFloat(a.exits?.mile_marker ?? '99999')
        const mmB = parseFloat(b.exits?.mile_marker ?? '99999')
        return mmA - mmB
      })
      setHotels(sorted)
    }
    if (i) setInterstates(i); if (e) setExits(e)
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

      // Boost-attributed call counts.
      // For each hotel that has (or had) a boost window, count call_logs
      // rows whose called_at falls between boost_started_at and
      // boost_ends_at. This is the Option-2 approach: zero schema changes,
      // pure timestamp join. Caveat: if a hotelier toggles boost on/off
      // multiple times we only see the MOST RECENT window — fine for now;
      // a boost_periods history table is the upgrade path if/when needed.
      const bc: Record<string, { duringCurrent: number; lastBoost: number }> = {}
      // All-time totals — bumped once per call_log row regardless of boost.
      const totals: Record<string, number> = {}
      for (const c of cl) {
        if (c.hotel_id) totals[c.hotel_id] = (totals[c.hotel_id] || 0) + 1
      }
      setHotelCallTotals(totals)
      if (h) {
        for (const hotel of h) {
          if (!hotel.boost_started_at || !hotel.boost_ends_at) continue
          const start = new Date(hotel.boost_started_at).getTime()
          const end = new Date(hotel.boost_ends_at).getTime()
          const live = end > now.getTime()
          let count = 0
          for (const c of cl) {
            if (c.hotel_id !== hotel.id) continue
            const t = new Date(c.called_at).getTime()
            if (t >= start && t <= end) count++
          }
          bc[hotel.id] = {
            duringCurrent: live ? count : 0,
            lastBoost: count,
          }
        }
      }
      setBoostCalls(bc)
    }
  }

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  // saveHotel persists the form. When `alsoVerify` is true, we also stamp the
  // record as verified + last_verified_at in the SAME write — used by the
  // "Save & Verify" button so admin can review hotel info on a big screen,
  // tweak fields as they go, and confirm with one click when satisfied.
  async function saveHotel(alsoVerify: boolean = false) {
    if (!form.name || !form.exit_id) { flash('Name and exit are required'); return }
    setLoading(true)
    // Compose the legacy 'address' field from the structured pieces so any
    // code path still reading from it gets the freshly typed data. Format:
    //   "street, city, state zip" — skip empty pieces gracefully.
    const composedAddress = [
      form.street_address?.trim(),
      form.city?.trim(),
      [form.state?.trim(), form.zip?.trim()].filter(Boolean).join(' ').trim(),
    ].filter(Boolean).join(', ')

    const payload: any = {
      name: form.name, phone: form.phone,
      // Both the legacy and new fields get saved.
      address: composedAddress || form.address,
      street_address: form.street_address || null,
      city:           form.city           || null,
      state:          form.state          || null,
      zip:            form.zip            || null,
      price_min: form.price_min ? parseInt(form.price_min) : null,
      price_max: form.price_max ? parseInt(form.price_max) : null,
      amenities: form.amenities,
      featured: form.featured, photo_url: form.photo_url, exit_id: form.exit_id,
      type: form.type || 'hotel',
    }
    if (alsoVerify) {
      payload.verified = true
      payload.last_verified_at = new Date().toISOString()
    }
    if (editId) {
      await supabase.from('hotels').update(payload).eq('id', editId)
      flash(alsoVerify ? 'Hotel updated & verified ✓' : 'Hotel updated ✓')
    } else {
      await supabase.from('hotels').insert(payload)
      flash(alsoVerify ? 'Hotel added & verified ✓' : 'Hotel added ✓')
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
      street_address: h.street_address || '',
      city:           h.city || '',
      state:          h.state || '',
      zip:            h.zip || '',
      price_min: h.price_min?.toString() || '', price_max: h.price_max?.toString() || '',
      amenities: h.amenities || [],
      featured: h.featured || false, photo_url: h.photo_url || '', exit_id: h.exit_id,
      type: (h.type === 'rv_park' ? 'rv_park' : 'hotel') as 'hotel' | 'rv_park',
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

  // Phone-verification toggle. Sets verified true + stamps last_verified_at when
  // confirming, or clears the verified flag if you need to flag a stale record.
  async function toggleVerified(id: string, val: boolean) {
    const next = !val
    await supabase.from('hotels').update({
      verified: next,
      last_verified_at: next ? new Date().toISOString() : null,
    }).eq('id', id)
    loadAll()
  }

  // Set the admin-only triage priority captured during the phone verification
  // call. Click the same priority again to clear it (toggle off).
  async function setPriority(id: string, current: string | null, next: 'high'|'medium'|'low') {
    const newVal = current === next ? null : next
    await supabase.from('hotels').update({ priority: newVal }).eq('id', id)
    loadAll()
  }

  // Save free-form admin notes from the verification call. Debounced via
  // local state in the row component; this just persists whatever was typed.
  async function saveNotes(id: string, notes: string) {
    await supabase.from('hotels').update({ admin_notes: notes }).eq('id', id)
    // Don't loadAll() — would steal focus from the textarea while typing.
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
        <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '16px' }}>Manage hotels, interstates, and exits</p>

        {/* App-wide call totals — sums of every call_log row, then the
            subset attributed to a boost window. Sits up top so admin sees
            global volume the moment the page loads, before drilling into
            any specific hotel. The third number (organic) is a derived
            convenience: total minus boost. */}
        {(() => {
          const totalAll = Object.values(hotelCallTotals).reduce((s, n) => s + n, 0)
          const totalBoost = Object.values(boostCalls).reduce((s, b) => s + b.lastBoost, 0)
          const organic = Math.max(0, totalAll - totalBoost)
          const stat = (label: string, val: number, color: string, hint: string) => (
            <div style={{
              flex: 1, minWidth: '140px',
              background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '12px',
              padding: '12px 16px',
            }}>
              <div style={{ fontSize: '10px', color: 'var(--fog)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '4px' }}>{label}</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color, fontFamily: 'Syne, sans-serif' }}>{val.toLocaleString()}</div>
              <div style={{ fontSize: '10px', color: 'var(--fog)', marginTop: '2px' }}>{hint}</div>
            </div>
          )
          return (
            <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
              {stat('Total Calls', totalAll, '#63b3ed', 'all-time, every hotel')}
              {stat('Boost Calls', totalBoost, 'var(--amber)', 'within boost windows')}
              {stat('Organic Calls', organic, '#22c55e', 'outside boost windows')}
            </div>
          )
        })()}

        {/* Testing-mode toggle. When ON, drivers see all listings (verified
            + unverified). Useful while inventory is built but verification
            grind hasn't happened yet. The verified badge still only shows
            on truly verified listings — toggle just controls visibility. */}
        {testingModeLoaded && (
          <div style={{
            background: testingMode ? 'rgba(245, 166, 35, 0.10)' : 'transparent',
            border: '1px solid ' + (testingMode ? 'var(--amber)' : 'var(--border)'),
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: '240px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: testingMode ? 'var(--amber)' : 'var(--white)', marginBottom: '4px' }}>
                {testingMode ? '🧪 TESTING MODE — all listings visible' : '🔒 Production mode — verified-only'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--fog)', lineHeight: 1.5 }}>
                {testingMode
                  ? 'Drivers see all 1,186 listings (verified + unverified). The green ✔ badge still only shows on verified.'
                  : 'Drivers see only listings flipped to verified=true. Verified badge appears next to all of them.'}
              </div>
            </div>
            <button
              onClick={() => toggleTestingMode(!testingMode)}
              style={{
                background: testingMode ? 'var(--amber)' : 'transparent',
                color: testingMode ? '#000' : 'var(--fog)',
                border: '1px solid ' + (testingMode ? 'var(--amber)' : 'var(--border)'),
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
                whiteSpace: 'nowrap',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
              }}
            >
              {testingMode ? 'Switch to Production' : 'Enable Testing Mode'}
            </button>
          </div>
        )}

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
              {t === 'hotels' ? '🏨 Listings' : t === 'interstates' ? '🛣️ Interstates & Exits' : '👤 Hoteliers'}
            </button>
          ))}
        </div>

        {tab === 'hotels' && (
          <>
            {/* Add/Edit Hotel Form */}
            <div style={{ ...cardStyle, padding: '20px', marginBottom: '16px' }}>
              {/* Header row: title + (when editing) the current verification
                  status of THIS record so admin sees state at a glance while
                  reviewing on laptop. The pill mirrors the row-list styling
                  so it reads consistently across the page. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', margin: 0 }}>
                  {editId ? `✏️ Edit ${form.type === 'rv_park' ? 'RV Park' : 'Hotel'}` : `+ Add ${form.type === 'rv_park' ? 'RV Park' : 'Hotel'}`}
                </h2>
                {editId && (() => {
                  const cur = hotels.find(h => h.id === editId)
                  const isVerified = !!cur?.verified
                  const lastVer = cur?.last_verified_at
                    ? new Date(cur.last_verified_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    : null
                  return (
                    <span style={{
                      fontSize: '11px', padding: '4px 10px', borderRadius: '999px',
                      background: isVerified ? 'rgba(34,197,94,0.10)' : 'rgba(245,166,35,0.12)',
                      color: isVerified ? '#22c55e' : 'var(--amber)',
                      border: `1px solid ${isVerified ? '#22c55e' : 'var(--amber)'}`,
                      fontWeight: 600,
                    }}>
                      {isVerified
                        ? `✓ Verified${lastVer ? ` · ${lastVer}` : ''}`
                        : '⚠ Unverified · hidden from drivers'}
                    </span>
                  )
                })()}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="dark-label">Hotel Name *</label>
                  <input className="dark-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Sleep Inn I-95"/>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="dark-label">Category</label>
                  <select
                    className="dark-input"
                    value={form.type || 'hotel'}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as 'hotel' | 'rv_park' }))}
                  >
                    <option value="hotel">🏨 Hotel</option>
                    <option value="rv_park">🚐 RV Park</option>
                  </select>
                </div>
                <div>
                  <label className="dark-label">
                    Phone
                    {editId && !form.phone?.trim() && <MissingDot />}
                  </label>
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
                {/* Structured address — replaces the old freeform single-field
                    'address' input. Better data quality, easier filtering, and
                    matches what hoteliers actually have on a business card.
                    The legacy 'address' column still exists in the DB; we
                    auto-compose it on save for backwards compatibility. */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="dark-label">
                    Street Address
                    {editId && !form.street_address?.trim() && <MissingDot />}
                  </label>
                  <input className="dark-input" value={form.street_address}
                    onChange={e => setForm(f => ({ ...f, street_address: e.target.value }))}
                    placeholder="123 Highway Dr"/>
                </div>
                <div>
                  <label className="dark-label">
                    City
                    {editId && !form.city?.trim() && <MissingDot />}
                  </label>
                  <input className="dark-input" value={form.city}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="Macon"/>
                </div>
                <div>
                  <label className="dark-label">
                    State
                    {editId && !form.state?.trim() && <MissingDot />}
                  </label>
                  <input className="dark-input" value={form.state}
                    onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase().slice(0, 2) }))}
                    placeholder="GA" maxLength={2}/>
                </div>
                <div>
                  <label className="dark-label">
                    ZIP
                    {editId && !form.zip?.trim() && <MissingDot />}
                  </label>
                  <input className="dark-input" value={form.zip}
                    onChange={e => setForm(f => ({ ...f, zip: e.target.value }))}
                    placeholder="31201"/>
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
                ★ Boost this listing <span style={{ color: 'var(--fog)', fontSize: '11px' }}>(top placement + pulsating price banner above Call)</span>
              </label>

              {/* Action row.
                  Add mode: just one ADD button.
                  Edit mode: SAVE on the left, SAVE & VERIFY on the right
                    (or UNVERIFY if record is currently verified).
                  Cancel chip on the far right when editing.
                  The dual-button design lets admin tweak fields and either
                  save-only (still working through it) or save-and-verify
                  (done, push it live to drivers) in one click. */}
              {(() => {
                const cur = editId ? hotels.find(h => h.id === editId) : null
                const isVerified = !!cur?.verified
                return (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => saveHotel(false)}
                      disabled={loading}
                      className="btn-amber"
                      style={{ flex: 1, minWidth: '140px', padding: '12px', fontSize: '13px' }}>
                      {loading ? 'SAVING...' : editId ? '💾 SAVE CHANGES' : '+ ADD HOTEL'}
                    </button>

                    {editId && !isVerified && (
                      <button
                        onClick={() => saveHotel(true)}
                        disabled={loading}
                        style={{
                          flex: 1, minWidth: '140px', padding: '12px', fontSize: '13px',
                          background: '#22c55e', border: '1px solid #22c55e', color: '#0a0f0a',
                          borderRadius: '8px', cursor: 'pointer', fontWeight: 700,
                          letterSpacing: '0.5px',
                        }}
                        title="Save current edits AND mark this record verified — pushes it live to driver search.">
                        ✓ SAVE & VERIFY
                      </button>
                    )}

                    {editId && isVerified && (
                      <button
                        onClick={async () => {
                          if (!confirm('Unverify this listing? It will be hidden from driver search until verified again.')) return
                          await toggleVerified(editId, true)
                          flash('Unverified — hidden from drivers')
                        }}
                        disabled={loading}
                        style={{
                          padding: '12px 16px', fontSize: '13px',
                          background: 'rgba(239,68,68,0.10)', color: '#ef4444',
                          border: '1px solid #ef4444', borderRadius: '8px', cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        title="Already verified. Click to unverify (e.g., info went stale).">
                        ⏸ UNVERIFY
                      </button>
                    )}

                    {editId && (
                      <button onClick={() => { setEditId(null); setForm({ ...emptyHotel }) }} style={{
                        background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--mist)',
                        padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
                      }}>Cancel</button>
                    )}
                  </div>
                )
              })()}
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
                <h3 style={{ fontSize: '14px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '10px' }}>
                  All Listings ({hotels.length})
                </h3>
                {/* Two big toggle buttons matching the driver page (no 'All').
                    Active = filled amber, inactive = outlined. Tap to switch
                    between hotels and RV parks during verification work. */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                  {([
                    { key: 'hotel',   label: `🏨 Hotels (${hotels.filter(h => (h.type || 'hotel') === 'hotel').length})` },
                    { key: 'rv_park', label: `🚐 RV Parks (${hotels.filter(h => h.type === 'rv_park').length})` },
                  ] as const).map(opt => {
                    const active = adminCategory === opt.key
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setAdminCategory(opt.key)}
                        style={{
                          flex: 1,
                          background: active ? 'var(--amber)' : 'transparent',
                          color: active ? 'var(--night)' : 'var(--amber)',
                          border: '2px solid var(--amber)',
                          borderRadius: '10px',
                          padding: '12px 10px',
                          fontSize: '13px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: 'Syne, sans-serif',
                          letterSpacing: '0.3px',
                          minHeight: '44px',
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                {/* Phone verification progress — lets admin see at a glance how much work remains */}
                {hotels.length > 0 && (() => {
                  const visible = hotels.filter(h => (h.type || 'hotel') === adminCategory)
                  return (
                    <div style={{ fontSize: '11px', color: 'var(--fog)' }}>
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>
                        ✓ {visible.filter(h => h.verified).length} verified
                      </span>
                      {' · '}
                      <span style={{ color: '#ef4444', fontWeight: 600 }}>
                        ⚠ {visible.filter(h => !h.verified).length} need phone verification
                      </span>
                      {' · '}
                      <span>only verified {adminCategory === 'rv_park' ? 'RV parks' : 'hotels'} appear in driver search</span>
                    </div>
                  )
                })()}
                {/* Boost / billing counters — admin sees who's currently boosted (live)
                    and who used a boost today (for end-of-day billing). */}
                {hotels.length > 0 && (() => {
                  const adminEtToday = new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'America/New_York',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                  }).format(new Date())
                  const liveBoosted = hotels.filter(h =>
                    h.featured && h.boost_ends_at && new Date(h.boost_ends_at).getTime() > Date.now()
                  )
                  const boostedToday = hotels.filter(h => h.last_boost_date === adminEtToday)
                  return (
                    <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--fog)' }}>
                      <span style={{ color: 'var(--amber)', fontWeight: 600 }}>
                        🔥 {liveBoosted.length} boost{liveBoosted.length === 1 ? '' : 's'} live now
                      </span>
                      {' · '}
                      <span style={{ color: 'var(--white)', fontWeight: 600 }}>
                        💰 {boostedToday.length} boosted today (bill these)
                      </span>
                    </div>
                  )
                })()}
              </div>
              {hotels.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fog)', fontSize: '13px' }}>No listings yet</div>
              ) : (
                <div>
                  {hotels
                    .filter(h => (h.type || 'hotel') === adminCategory)
                    .map(h => {
                    const exit = h.exits
                    return (
                      <div key={h.id} className="admin-hotel-card">
                      <div className="admin-hotel-row">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--white)', fontSize: '13px' }}>{h.name}</span>
                            {/* Category pill — small, inline. RV Park gets a green
                                tint so admins can scan a long list quickly. */}
                            <span style={{
                              fontSize: '10px',
                              background: h.type === 'rv_park' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)',
                              color: h.type === 'rv_park' ? '#22c55e' : 'var(--fog)',
                              padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                              border: `1px solid ${h.type === 'rv_park' ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                            }}>
                              {h.type === 'rv_park' ? '🚐 RV' : '🏨 Hotel'}
                            </span>
                            {h.verified ? (
                              <span style={{
                                fontSize: '10px', background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                                padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                              }}>✓ Verified</span>
                            ) : (
                              <span style={{
                                fontSize: '10px', background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                                padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                              }}>⚠ Unverified · hidden from drivers</span>
                            )}
                            {/* All-time total calls received from anywhere in
                                the app (home, search, hotel detail). Always
                                shown — even at zero — so admin can compare
                                across hotels and spot dead inventory. Visually
                                distinct (mist/blue tint) from the green boost
                                pill so the two never blur together. */}
                            {(() => {
                              const total = hotelCallTotals[h.id] || 0
                              return (
                                <span
                                  title="Total calls received from drivers across the entire app — boosted and organic combined."
                                  style={{
                                    fontSize: '10px',
                                    background: total > 0 ? 'rgba(99,179,237,0.10)' : 'rgba(255,255,255,0.04)',
                                    color: total > 0 ? '#63b3ed' : 'var(--fog)',
                                    padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                                    border: `1px solid ${total > 0 ? 'rgba(99,179,237,0.25)' : 'var(--border)'}`,
                                  }}>
                                  📞 {total} total call{total === 1 ? '' : 's'}
                                </span>
                              )
                            })()}
                            {h.featured && (() => {
                              const live = h.boost_ends_at && new Date(h.boost_ends_at).getTime() > Date.now()
                              const minutesLeft = h.boost_ends_at
                                ? Math.max(0, Math.floor((new Date(h.boost_ends_at).getTime() - Date.now()) / 60000))
                                : 0
                              return (
                                <span style={{
                                  fontSize: '10px',
                                  background: live ? 'rgba(245,166,35,0.20)' : 'rgba(245,166,35,0.10)',
                                  color: 'var(--amber)',
                                  padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                                }}>
                                  ★ Boosted{h.boost_price ? ` · $${h.boost_price}` : ''}
                                  {live ? ` · ${minutesLeft}m left` : ''}
                                </span>
                              )
                            })()}
                            {/* Boost-attributed call counter.
                                Shows on any hotel that has had a boost window
                                (currently live OR previously ran one). The
                                count is calls received between
                                boost_started_at and boost_ends_at.
                                  - Live boost  → "⭐ N boost calls (live)"
                                  - Boost ended → "⭐ N boost calls (last)"
                                Hidden if there's no boost history at all.
                                Uses ⭐ + amber so it visually pairs with the
                                ★ Boosted pill, and never blurs together with
                                the blue 📞 total-calls pill above. */}
                            {boostCalls[h.id] && (() => {
                              const live = h.boost_ends_at && new Date(h.boost_ends_at).getTime() > Date.now()
                              const n = live ? boostCalls[h.id].duringCurrent : boostCalls[h.id].lastBoost
                              const label = live ? 'live' : 'last'
                              return (
                                <span
                                  title={live
                                    ? 'Calls received since this boost started.'
                                    : 'Calls received during the most recent boost campaign.'}
                                  style={{
                                    fontSize: '10px',
                                    background: 'rgba(245,166,35,0.10)',
                                    color: 'var(--amber)',
                                    padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                                    border: '1px solid rgba(245,166,35,0.30)',
                                  }}>
                                  ⭐ {n} boost call{n === 1 ? '' : 's'} ({label})
                                </span>
                              )
                            })()}
                          </div>
                          {exit && (
                            <p style={{ fontSize: '11px', color: 'var(--fog)' }}>
                              {exit.interstates?.name} · MM {exit.mile_marker} · {exit.city}, {exit.state}
                            </p>
                          )}
                          <p style={{ fontSize: '11px', color: 'var(--mist)' }}>{h.phone}</p>
                        </div>
                        <div className="admin-hotel-actions">
                          <div className="admin-hotel-actions-inner">
                            <button
                              onClick={() => toggleVerified(h.id, h.verified || false)}
                              style={{
                                ...btnGhost,
                                // Color logic: when verified, show muted red ("hide" warning).
                                // When NOT verified, show muted amber ("action needed" prompt).
                                // We deliberately avoid bright green on the unverified state
                                // because at a glance it reads as "this hotel IS verified",
                                // which is the opposite of the truth.
                                background: h.verified ? 'rgba(239,68,68,0.10)' : 'rgba(245,166,35,0.12)',
                                color: h.verified ? '#ef4444' : 'var(--amber)',
                                fontWeight: 700,
                                border: `1px solid ${h.verified ? '#ef4444' : 'var(--amber)'}`,
                              }}
                              title={h.verified
                                ? 'Currently visible to drivers. Click to hide (e.g., re-verify needed).'
                                : 'Click after you have called this hotel and confirmed the phone works. Will become visible to drivers.'}
                            >
                              {h.verified ? '⏸ Hide from Drivers' : '📞 Verify Phone'}
                            </button>
                            <button onClick={() => toggleFeatured(h.id, h.featured)} style={btnGhost}>
                              {h.featured ? '★ Unboost' : '☆ Boost'}
                            </button>
                            <button onClick={() => editHotel(h)} style={{ ...btnGhost, color: 'var(--blue)' }}>Edit</button>
                            <button onClick={() => deleteHotel(h.id)} style={{ ...btnGhost, color: 'var(--red)' }}>Del</button>
                          </div>

                          {/* Triage priority — set during the verification call.
                              Surfaces high-priority hotels first to drivers when
                              multiple options sit at similar distance. Clicking
                              the same level again clears the priority. */}
                          <PriorityRow
                            value={h.priority}
                            onSet={(level) => setPriority(h.id, h.priority, level)}
                          />
                        </div>
                      </div>
                      {/* Notes textarea sits in its own row below — full width
                          on desktop, where there used to be lots of empty dark
                          space next to the cramped right action column. Auto-
                          grows from 3 to 6 rows on big screens for real notes. */}
                      <div className="admin-hotel-notes">
                        <NotesField
                          initial={h.admin_notes || ''}
                          onSave={(v) => saveNotes(h.id, v)}
                        />
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

// ─────────────────────────────────────────────────────────────────────────
// Per-row subcomponents for priority + notes
// ─────────────────────────────────────────────────────────────────────────

/**
 * MissingDot — small amber dot rendered next to a field label when the value
 * is empty and we're editing an existing hotel. Lets admin scan an Edit form
 * during a phone verification call and immediately see which fields still
 * need filling. Hidden on the new-hotel form (everything would be dotted).
 */
function MissingDot() {
  return (
    <span
      title="Missing — fill in during verification call"
      aria-label="missing"
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: 'var(--amber)',
        marginLeft: '6px',
        verticalAlign: 'middle',
        boxShadow: '0 0 0 2px rgba(245,166,35,0.18)',
      }}
    />
  )
}

/**
 * PriorityRow — three pill buttons (HIGH / MED / LOW) showing the current
 * triage state. The active level is highlighted; clicking it again clears.
 * Used during phone verification to surface good hotels first to drivers.
 */
function PriorityRow({ value, onSet }: {
  value: string | null
  onSet: (level: 'high'|'medium'|'low') => void
}) {
  const levels: Array<{ key: 'high'|'medium'|'low'; label: string; color: string }> = [
    { key: 'high',   label: 'HIGH', color: '#22c55e' },  // green = good
    { key: 'medium', label: 'MED',  color: '#f5a623' },  // amber = ok
    { key: 'low',    label: 'LOW',  color: '#ef4444' },  // red = poor
  ]
  return (
    <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '10px', color: 'var(--fog)', alignSelf: 'center', marginRight: '2px' }}>
        Priority:
      </span>
      {levels.map(l => {
        const active = value === l.key
        return (
          <button
            key={l.key}
            onClick={() => onSet(l.key)}
            title={active ? `Clear ${l.label} priority` : `Mark as ${l.label} priority`}
            style={{
              padding: '4px 10px',
              borderRadius: '12px',
              fontSize: '10px',
              fontWeight: 700,
              cursor: 'pointer',
              border: `1px solid ${l.color}`,
              background: active ? l.color : 'transparent',
              color: active ? 'var(--night)' : l.color,
            }}
          >
            {l.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * NotesField — small textarea that tracks local edits and only writes to the
 * database on blur. Avoids hammering Supabase on every keystroke and avoids
 * focus-stealing re-renders that would happen if the parent reloaded the
 * whole hotel list on each save.
 */
function NotesField({ initial, onSave }: {
  initial: string
  onSave: (v: string) => void
}) {
  const [val, setVal] = useState(initial)
  const [saved, setSaved] = useState(true)
  return (
    <div style={{ marginTop: '4px', position: 'relative' }}>
      <textarea
        value={val}
        onChange={e => { setVal(e.target.value); setSaved(false) }}
        onBlur={() => { if (!saved) { onSave(val); setSaved(true) } }}
        placeholder="📝 Notes from call (e.g. 'Sarah owner, $69 cash, ask for room 12', 'no truck parking', 'call back Tue', 'rude — sink lower in sort')"
        rows={4}
        style={{
          width: '100%',
          background: 'var(--night3)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '10px 12px',
          color: 'var(--white)',
          fontSize: '13px',
          fontFamily: 'DM Sans, sans-serif',
          lineHeight: 1.5,
          resize: 'vertical',
          boxSizing: 'border-box',
          minHeight: '64px',
        }}
      />
      {!saved && (
        <span style={{ position: 'absolute', right: '10px', top: '8px', fontSize: '10px', color: 'var(--amber)' }}>
          unsaved · click out to save
        </span>
      )}
    </div>
  )
}
