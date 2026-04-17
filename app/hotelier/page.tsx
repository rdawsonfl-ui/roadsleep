'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type Hotelier = { id: string; email: string; name: string; business_phone: string }
type Hotel = {
  id: string
  name: string
  phone: string
  address: string
  price_min: number
  price_max: number
  description: string
  check_in_time: string
  check_out_time: string
  website: string
  amenities: string[]
  availability_badge: string
  featured: boolean
}

const AMENITY_OPTIONS = [
  { key: 'truck_parking', label: '🚛 Truck Parking' },
  { key: 'pets', label: '🐾 Pet Friendly' },
  { key: '24hr_checkin', label: '🌙 24hr Check-in' },
  { key: 'wifi', label: '📶 WiFi' },
  { key: 'pool', label: '🏊 Pool' },
  { key: 'breakfast', label: '🍳 Breakfast' },
  { key: 'parking', label: '🅿️ Free Parking' },
  { key: 'ac', label: '❄️ A/C' },
]

function hashPassword(pw: string): string {
  // Simple deterministic hash for demo — in production use bcrypt via edge function
  let h = 0
  for (let i = 0; i < pw.length; i++) { h = (Math.imul(31, h) + pw.charCodeAt(i)) | 0 }
  return 'hash_' + Math.abs(h).toString(16) + '_' + pw.length
}

export default function HotelierPortal() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [hotelier, setHotelier] = useState<Hotelier | null>(null)
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [selectedHotel, setSelectedHotel] = useState<Hotel | null>(null)
  const [view, setView] = useState<'hotels' | 'edit' | 'new'>('hotels')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  // Auth form
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '', business_phone: '' })

  // Hotel form
  const [hotelForm, setHotelForm] = useState<Partial<Hotel>>({
    name: '', phone: '', address: '', price_min: 0, price_max: 0,
    description: '', check_in_time: '3:00 PM', check_out_time: '11:00 AM',
    website: '', amenities: [], availability_badge: 'available',
  })

  useEffect(() => {
    const stored = localStorage.getItem('hotelier_session')
    if (stored) {
      try {
        const h = JSON.parse(stored)
        setHotelier(h)
        loadHotels(h.id)
      } catch {}
    }
  }, [])

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!authForm.email || !authForm.password || !authForm.name) {
      setErr('Please fill in all required fields'); return
    }
    // Check if email already exists
    const { data: existing } = await supabase.from('hoteliers').select('id').eq('email', authForm.email.toLowerCase()).single()
    if (existing) { setErr('An account with this email already exists. Please log in.'); return }

    const { data, error } = await supabase.from('hoteliers').insert({
      email: authForm.email.toLowerCase().trim(),
      password_hash: hashPassword(authForm.password),
      name: authForm.name.trim(),
      business_phone: authForm.business_phone.trim(),
    }).select().single()

    if (error || !data) { setErr('Signup failed. Please try again.'); return }
    const h = { id: data.id, email: data.email, name: data.name, business_phone: data.business_phone }
    localStorage.setItem('hotelier_session', JSON.stringify(h))
    setHotelier(h)
    setMsg('Account created! Now add your hotel below.')
    setView('new')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    const { data, error } = await supabase.from('hoteliers')
      .select('*')
      .eq('email', authForm.email.toLowerCase().trim())
      .eq('password_hash', hashPassword(authForm.password))
      .single()

    if (error || !data) { setErr('Invalid email or password'); return }
    const h = { id: data.id, email: data.email, name: data.name, business_phone: data.business_phone }
    localStorage.setItem('hotelier_session', JSON.stringify(h))
    setHotelier(h)
    loadHotels(h.id)
  }

  async function loadHotels(hotelierId: string) {
    const { data } = await supabase.from('hotels').select('*').eq('hotelier_id', hotelierId)
    setHotels(data || [])
  }

  function logout() {
    localStorage.removeItem('hotelier_session')
    setHotelier(null)
    setHotels([])
    setView('hotels')
    setMsg('')
  }

  function startEdit(hotel: Hotel) {
    setSelectedHotel(hotel)
    setHotelForm({ ...hotel })
    setView('edit')
    setMsg('')
    setErr('')
  }

  function startNew() {
    setHotelForm({
      name: '', phone: '', address: '', price_min: 0, price_max: 0,
      description: '', check_in_time: '3:00 PM', check_out_time: '11:00 AM',
      website: '', amenities: [], availability_badge: 'available',
    })
    setView('new')
    setMsg('')
    setErr('')
  }

  async function saveHotel(e: React.FormEvent) {
    e.preventDefault()
    if (!hotelier) return
    setSaving(true)
    setErr('')
    setMsg('')

    const payload = {
      name: hotelForm.name,
      phone: hotelForm.phone,
      address: hotelForm.address,
      price_min: Number(hotelForm.price_min) || 0,
      price_max: Number(hotelForm.price_max) || 0,
      description: hotelForm.description,
      check_in_time: hotelForm.check_in_time,
      check_out_time: hotelForm.check_out_time,
      website: hotelForm.website,
      amenities: hotelForm.amenities || [],
      availability_badge: hotelForm.availability_badge,
      hotelier_id: hotelier.id,
      updated_at: new Date().toISOString(),
    }

    if (view === 'edit' && selectedHotel) {
      const { error } = await supabase.from('hotels').update(payload).eq('id', selectedHotel.id)
      if (error) { setErr('Save failed. Please try again.'); setSaving(false); return }
      setMsg('✓ Hotel updated successfully!')
    } else {
      const { error } = await supabase.from('hotels').insert(payload)
      if (error) { setErr('Could not create hotel. Please try again.'); setSaving(false); return }
      setMsg('✓ Hotel listed! Drivers can now find you on RoadSleep.')
    }

    await loadHotels(hotelier.id)
    setSaving(false)
    setView('hotels')
  }

  function toggleAmenity(key: string) {
    const cur = hotelForm.amenities || []
    setHotelForm(f => ({
      ...f,
      amenities: cur.includes(key) ? cur.filter(a => a !== key) : [...cur, key]
    }))
  }

  // ── AUTH SCREEN ──
  if (!hotelier) {
    return (
      <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ width: '100%', maxWidth: '420px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>🏨</div>
            <h1 style={{ fontSize: '26px', fontFamily: 'Syne, sans-serif', fontWeight: 800, color: 'var(--white)', letterSpacing: '-0.5px' }}>
              Hotelier <span style={{ color: 'var(--amber)' }}>Portal</span>
            </h1>
            <p style={{ color: 'var(--fog)', fontSize: '13px', marginTop: '6px' }}>
              List your property · Get direct phone calls · No commissions
            </p>
          </div>

          {/* Tab switcher */}
          <div style={{ display: 'flex', background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px', marginBottom: '20px' }}>
            {(['login', 'signup'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setErr('') }} style={{
                flex: 1, padding: '10px', border: 'none', borderRadius: '7px', cursor: 'pointer',
                fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', transition: 'all 0.15s',
                background: mode === m ? 'var(--amber)' : 'transparent',
                color: mode === m ? 'var(--night)' : 'var(--fog)',
              }}>
                {m === 'login' ? 'Log In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form onSubmit={mode === 'login' ? handleLogin : handleSignup}
            style={{ background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px' }}>

            {mode === 'signup' && (
              <>
                <Field label="Your Name *" value={authForm.name}
                  onChange={v => setAuthForm(f => ({ ...f, name: v }))} placeholder="Jane Smith" />
                <Field label="Business Phone" value={authForm.business_phone}
                  onChange={v => setAuthForm(f => ({ ...f, business_phone: v }))} placeholder="(555) 000-0000" type="tel" />
              </>
            )}

            <Field label="Email Address *" value={authForm.email}
              onChange={v => setAuthForm(f => ({ ...f, email: v }))} placeholder="you@yourhotel.com" type="email" />
            <Field label="Password *" value={authForm.password}
              onChange={v => setAuthForm(f => ({ ...f, password: v }))} placeholder="••••••••" type="password" />

            {err && (
              <div style={{ background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#ff6b6b' }}>
                {err}
              </div>
            )}

            <button type="submit" className="btn-amber" style={{ width: '100%', padding: '14px', fontSize: '14px', letterSpacing: '0.5px' }}>
              {mode === 'login' ? 'LOG IN →' : 'CREATE ACCOUNT →'}
            </button>

            {mode === 'login' && (
              <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '12px', color: 'var(--fog)' }}>
                No account?{' '}
                <button type="button" onClick={() => setMode('signup')}
                  style={{ background: 'none', border: 'none', color: 'var(--amber)', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>
                  Sign up free
                </button>
              </p>
            )}
          </form>

          <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '11px', color: 'var(--fog)', lineHeight: 1.5 }}>
            Free basic listing. Drivers call you directly. Zero commissions.
          </p>
        </div>
      </main>
    )
  }

  // ── HOTEL FORM ──
  if (view === 'edit' || view === 'new') {
    return (
      <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '24px 20px 60px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <button onClick={() => setView('hotels')} style={{
              background: 'var(--night2)', border: '1px solid var(--border)', color: 'var(--fog)',
              padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
            }}>← Back</button>
            <h1 style={{ fontSize: '22px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', fontWeight: 800 }}>
              {view === 'new' ? 'Add Your Hotel' : 'Edit Hotel'}
            </h1>
          </div>

          {msg && (
            <div style={{ background: 'rgba(62,207,142,0.1)', border: '1px solid rgba(62,207,142,0.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: 'var(--green)' }}>
              {msg}
            </div>
          )}

          <form onSubmit={saveHotel}>
            {/* Basic Info */}
            <Section title="📋 Basic Information">
              <Field label="Hotel / Motel Name *" value={hotelForm.name || ''} onChange={v => setHotelForm(f => ({ ...f, name: v }))} placeholder="Sunset Motel" />
              <Field label="Phone Number *" value={hotelForm.phone || ''} onChange={v => setHotelForm(f => ({ ...f, phone: v }))} placeholder="(555) 123-4567" type="tel" />
              <Field label="Street Address" value={hotelForm.address || ''} onChange={v => setHotelForm(f => ({ ...f, address: v }))} placeholder="1234 Highway Dr, City, FL 12345" />
              <Field label="Website (optional)" value={hotelForm.website || ''} onChange={v => setHotelForm(f => ({ ...f, website: v }))} placeholder="https://www.yourmotel.com" type="url" />
            </Section>

            {/* Description */}
            <Section title="📝 Description">
              <div style={{ marginBottom: '16px' }}>
                <label className="dark-label">Tell drivers about your property</label>
                <textarea
                  value={hotelForm.description || ''}
                  onChange={e => setHotelForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Clean, comfortable rooms right off the highway. Family owned since 1987. Truck-friendly lot with easy pull-through..."
                  rows={4}
                  style={{
                    width: '100%', background: 'var(--night3)', border: '1px solid var(--border)',
                    borderRadius: '10px', padding: '12px 14px', color: 'var(--white)',
                    fontSize: '14px', fontFamily: 'DM Sans, sans-serif', resize: 'vertical', boxSizing: 'border-box',
                  }}
                />
              </div>
            </Section>

            {/* Rates */}
            <Section title="💰 Nightly Rates">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <Field label="Rate From ($)" value={String(hotelForm.price_min || '')} onChange={v => setHotelForm(f => ({ ...f, price_min: Number(v) }))} placeholder="59" type="number" />
                <Field label="Rate To ($)" value={String(hotelForm.price_max || '')} onChange={v => setHotelForm(f => ({ ...f, price_max: Number(v) }))} placeholder="99" type="number" />
              </div>
              <p style={{ fontSize: '11px', color: 'var(--fog)', marginTop: '-8px' }}>
                Shown as a range to drivers. Not live pricing.
              </p>
            </Section>

            {/* Check in/out */}
            <Section title="🕐 Check-in / Check-out">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <Field label="Check-in Time" value={hotelForm.check_in_time || '3:00 PM'} onChange={v => setHotelForm(f => ({ ...f, check_in_time: v }))} placeholder="3:00 PM" />
                <Field label="Check-out Time" value={hotelForm.check_out_time || '11:00 AM'} onChange={v => setHotelForm(f => ({ ...f, check_out_time: v }))} placeholder="11:00 AM" />
              </div>
            </Section>

            {/* Amenities */}
            <Section title="✅ Amenities">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {AMENITY_OPTIONS.map(a => {
                  const selected = (hotelForm.amenities || []).includes(a.key)
                  return (
                    <button key={a.key} type="button" onClick={() => toggleAmenity(a.key)} style={{
                      padding: '8px 14px', borderRadius: '20px', cursor: 'pointer', fontSize: '13px',
                      fontFamily: 'DM Sans, sans-serif', fontWeight: 500, transition: 'all 0.15s',
                      border: selected ? '1px solid var(--amber)' : '1px solid var(--border)',
                      background: selected ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                      color: selected ? 'var(--amber)' : 'var(--mist)',
                    }}>
                      {a.label}
                    </button>
                  )
                })}
              </div>
            </Section>

            {/* Availability */}
            <Section title="🟢 Availability Status">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {[
                  { value: 'available', label: '🟢 Usually Available', desc: 'Rooms typically open' },
                  { value: 'limited', label: '🟡 Often Busy', desc: 'Call ahead recommended' },
                  { value: 'full', label: '🔴 Often Full', desc: 'Book early' },
                ].map(opt => (
                  <button key={opt.value} type="button" onClick={() => setHotelForm(f => ({ ...f, availability_badge: opt.value }))} style={{
                    padding: '12px 10px', borderRadius: '10px', cursor: 'pointer', textAlign: 'center',
                    border: hotelForm.availability_badge === opt.value ? '1px solid var(--amber)' : '1px solid var(--border)',
                    background: hotelForm.availability_badge === opt.value ? 'rgba(245,166,35,0.1)' : 'var(--night3)',
                    transition: 'all 0.15s',
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: hotelForm.availability_badge === opt.value ? 'var(--amber)' : 'var(--mist)', marginBottom: '2px' }}>{opt.label}</div>
                    <div style={{ fontSize: '10px', color: 'var(--fog)' }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </Section>

            {err && (
              <div style={{ background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#ff6b6b' }}>
                {err}
              </div>
            )}

            <button type="submit" disabled={saving} className="btn-amber" style={{ width: '100%', padding: '16px', fontSize: '15px', letterSpacing: '1px', marginTop: '8px' }}>
              {saving ? 'SAVING...' : view === 'new' ? 'LIST MY HOTEL →' : 'SAVE CHANGES →'}
            </button>
          </form>
        </div>
      </main>
    )
  }

  // ── MY HOTELS ──
  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '24px 20px 60px' }}>
      <div style={{ maxWidth: '700px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '26px', fontFamily: 'Syne, sans-serif', fontWeight: 800, color: 'var(--white)', letterSpacing: '-0.5px' }}>
              Welcome, <span style={{ color: 'var(--amber)' }}>{hotelier.name}</span>
            </h1>
            <p style={{ color: 'var(--fog)', fontSize: '13px', marginTop: '2px' }}>{hotelier.email}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={startNew} className="btn-amber" style={{ padding: '10px 18px', fontSize: '13px' }}>
              + Add Hotel
            </button>
            <button onClick={logout} style={{
              background: 'var(--night2)', border: '1px solid var(--border)', color: 'var(--fog)',
              padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
            }}>Log out</button>
          </div>
        </div>

        {msg && (
          <div style={{ background: 'rgba(62,207,142,0.1)', border: '1px solid rgba(62,207,142,0.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: 'var(--green)' }}>
            {msg}
          </div>
        )}

        {hotels.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '16px' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏨</div>
            <h2 style={{ fontSize: '18px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '8px' }}>No hotels listed yet</h2>
            <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '20px' }}>Add your property so drivers can find and call you.</p>
            <button onClick={startNew} className="btn-amber" style={{ padding: '12px 24px', fontSize: '14px' }}>
              + List My First Hotel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {hotels.map(h => (
              <div key={h.id} style={{ background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '14px', padding: '18px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: '17px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', fontWeight: 700, marginBottom: '4px' }}>
                      {h.featured && <span style={{ color: 'var(--amber)' }}>★ </span>}
                      {h.name}
                    </h3>
                    <p style={{ fontSize: '13px', color: 'var(--fog)', marginBottom: '6px' }}>{h.address}</p>
                    <p style={{ fontSize: '13px', color: 'var(--mist)' }}>📞 {h.phone}</p>
                    {h.price_min > 0 && (
                      <p style={{ fontSize: '13px', color: 'var(--amber)', marginTop: '4px' }}>
                        ${h.price_min}–${h.price_max}/night
                      </p>
                    )}
                    {h.amenities?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                        {h.amenities.map(a => {
                          const opt = AMENITY_OPTIONS.find(o => o.key === a)
                          return opt ? (
                            <span key={a} style={{ fontSize: '11px', background: 'var(--night3)', border: '1px solid var(--border)', borderRadius: '10px', padding: '3px 8px', color: 'var(--mist)' }}>
                              {opt.label}
                            </span>
                          ) : null
                        })}
                      </div>
                    )}
                  </div>
                  <button onClick={() => startEdit(h)} style={{
                    background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--mist)',
                    padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap',
                  }}>
                    ✏️ Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '14px', padding: '20px', marginBottom: '16px' }}>
      <h3 style={{ fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '14px' }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label className="dark-label">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', background: 'var(--night3)', border: '1px solid var(--border)',
          borderRadius: '10px', padding: '12px 14px', color: 'var(--white)',
          fontSize: '14px', fontFamily: 'DM Sans, sans-serif', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

export const dynamic = 'force-dynamic'
