'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import PasswordInput from '@/app/components/PasswordInput'
import SiteFooter from '@/app/components/SiteFooter'
import { DashboardView } from '@/app/dashboard/page'

type Hotelier = { id: string; email: string; name: string; business_phone: string }
type Hotel = {
  id: string; name: string; phone: string; address: string
  price_min: number; price_max: number; description: string
  check_in_time: string; check_out_time: string; website: string
  amenities: string[]; featured: boolean
  exit_id?: string
  // Boost columns — match the DB schema added in the boost migration.
  // featured doubles as "boost is on right now"; the rest add the time/price/limit logic.
  boost_price?: number | null
  boost_started_at?: string | null
  boost_ends_at?: string | null
  boost_duration_hr?: 1 | 2 | 3 | null
  last_boost_date?: string | null
}
// Mirrors what the admin panel selects: each exit row carries the parent
// interstate so we can render "I-75 N · MM 143 · Punta Gorda, FL" in one dropdown.
type ExitOption = {
  id: string
  direction: string
  exit_label: string | null
  mile_marker: number
  city: string | null
  state: string | null
  interstates: { name: string } | null
}
type CallStat = { calls_today: number; calls_month: number; calls_total: number; revenue_month: number }
// One row in the per-hotel "Recent calls" mini-log on the My Listings card.
// Snapshot of the call_logs columns the hotelier cares about:
//   - when the call came in
//   - was it from a boost (★) or organic
//   - did the driver actually drive in (📍 arrival) and how close did they get
type RecentCall = {
  hotel_id: string
  called_at: string
  from_boost: boolean | null
  arrived_at: string | null
  closest_approach_mi: number | null
  // Distance from driver to hotel at the moment they tapped Call.
  // Snapshot of GPS state — null if the driver had GPS off, or if the
  // call predates arrival tracking (rows logged before 2026-05-12).
  initial_distance_mi: number | null
}

const AMENITY_OPTIONS = [
  { key: 'truck_parking', label: '🚛 Truck Parking' },
  { key: 'pets',          label: '🐾 Pet Friendly' },
  { key: '24hr_checkin',  label: '🌙 24hr Check-in' },
  { key: 'wifi',          label: '📶 WiFi' },
  { key: 'pool',          label: '🏊 Pool' },
  { key: 'breakfast',     label: '🍳 Breakfast' },
  { key: 'parking',       label: '🅿️ Free Parking' },
  { key: 'ac',            label: '❄️ A/C' },
]

export default function HotelierPortal() {
  const [mode, setMode]             = useState<'login'|'signup'|'forgot'>('login')
  const [hotelier, setHotelier]     = useState<Hotelier | null>(null)
  const [hotels, setHotels]         = useState<Hotel[]>([])
  const [exits, setExits]           = useState<ExitOption[]>([])
  const [stats, setStats]           = useState<Record<string, CallStat>>({})
  // Per-hotel last-5-calls list for the Recent Calls mini-log on each card.
  // Populated by loadAll alongside stats; same source of truth (call_logs).
  const [recentCalls, setRecentCalls] = useState<Record<string, RecentCall[]>>({})
  // Map of hotel id -> interstate name (e.g. 'I-87'). Looked up alongside
  // recent calls so the Recent Calls mini-log can show 'from I-87' next to
  // each row's distance. Kept separate from the Hotel type because that
  // type is also used by the edit form, which doesn't need this.
  const [hotelInterstate, setHotelInterstate] = useState<Record<string, string>>({})
  const [rate, setRate]             = useState(5)
  const [billingType, setBillingType] = useState<'per_call'|'monthly'>('per_call')
  // Hotelier portal has four "tabs":
  //   dashboard   — original landing page: hotel list with edit/boost buttons
  //   performance — embedded DashboardView showing calls/boost/GPS arrivals
  //   edit        — edit form for an existing hotel
  //   new         — add a new hotel
  // 'dashboard' and 'performance' are tabbed in the UI; edit/new are
  // sub-pages reachable from dashboard. We kept the old 'dashboard'
  // name for backwards-compat with existing state machine code.
  const [view, setView]             = useState<'dashboard'|'performance'|'edit'|'new'>('dashboard')
  const [selectedHotel, setSelectedHotel] = useState<Hotel | null>(null)
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState('')
  const [err, setErr]               = useState('')
  const [authBusy, setAuthBusy]     = useState(false)
  const [authForm, setAuthForm]     = useState({ email:'', password:'', name:'', business_phone:'' })
  const [hotelForm, setHotelForm]   = useState<Partial<Hotel>>({
    name:'', phone:'', address:'', price_min:0, price_max:0,
    description:'', check_in_time:'3:00 PM', check_out_time:'11:00 AM',
    website:'', amenities:[], exit_id:'',
  })

  // Look up the hoteliers row for the currently-authenticated Supabase user.
  // For brand-new users, this row is created at signup. For pre-existing
  // hoteliers (created before we switched to Supabase Auth), the row already
  // exists keyed by email — we link auth_user_id on first successful login.
  async function resolveHotelierForAuthUser(authUser: { id: string; email?: string }) {
    if (!authUser.email) return null
    const email = authUser.email.toLowerCase().trim()
    // Try direct link first (post-signup users)
    let { data: row } = await supabase
      .from('hoteliers')
      .select('id, email, name, business_phone, auth_user_id')
      .eq('auth_user_id', authUser.id)
      .maybeSingle()
    if (row) return row
    // Fall back to email match (legacy users — link them now)
    const { data: byEmail } = await supabase
      .from('hoteliers')
      .select('id, email, name, business_phone, auth_user_id')
      .eq('email', email)
      .maybeSingle()
    if (byEmail) {
      // Self-heal: stamp the auth link so future logins skip this branch
      if (!byEmail.auth_user_id) {
        await supabase.from('hoteliers').update({ auth_user_id: authUser.id }).eq('id', byEmail.id)
      }
      return byEmail
    }
    return null
  }

  // Single source of truth for "is the user logged in" — driven entirely by
  // supabase.auth (cookies). On mount we read whatever session exists, then
  // subscribe to changes so logout from another tab works too.
  useEffect(() => {
    let cancelled = false

    async function hydrateFromSession() {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (!session?.user) { setHotelier(null); return }
      const row = await resolveHotelierForAuthUser(session.user as { id: string; email?: string })
      if (cancelled) return
      if (row) {
        const h: Hotelier = {
          id: row.id, email: row.email || '', name: row.name || '',
          business_phone: row.business_phone || '',
        }
        setHotelier(h); loadAll(h.id)
      } else {
        // Logged in to Supabase Auth but no hoteliers row yet — happens if signup
        // email-confirm completes on another device. Stay on login screen with a hint.
        setHotelier(null)
        setErr('Logged in but no hotelier profile found for this email. Contact support.')
      }
    }

    hydrateFromSession()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) { setHotelier(null); return }
      // Re-hydrate the hotelier row whenever auth state flips
      resolveHotelierForAuthUser(session.user as { id: string; email?: string }).then(row => {
        if (!row) { setHotelier(null); return }
        const h: Hotelier = {
          id: row.id, email: row.email || '', name: row.name || '',
          business_phone: row.business_phone || '',
        }
        setHotelier(h); loadAll(h.id)
      })
    })
    return () => { cancelled = true; sub?.subscription.unsubscribe() }
  }, [])

  async function loadAll(hotelierId: string) {
    const [{ data: hotelsData }, { data: hData }, { data: exitsData }] = await Promise.all([
      supabase.from('hotels').select('*').eq('hotelier_id', hotelierId),
      supabase.from('hoteliers').select('rate, billing_type').eq('id', hotelierId).single(),
      // Same shape as admin panel — one row per exit, with parent interstate name joined.
      // Sorted so the dropdown reads naturally: I-10 first, then I-75, then I-95, etc.
      supabase.from('exits').select('id, direction, exit_label, mile_marker, city, state, interstates(name)').order('mile_marker'),
    ])
    const hotelList = hotelsData || []

    // Pull call_logs for this hotelier's hotels by hotel_id, NOT by the
    // call_logs.hotelier_id column. The driver-side logCall() only writes
    // hotel_id at insert time — hotelier_id stays NULL, so filtering by it
    // returned zero calls and the dashboard showed 0/0/0 even when there
    // were real calls in the DB. Joining via hotel_id is the source of truth.
    // We also pull from_boost + arrived_at + closest_approach_mi so each
    // hotel card can render a Recent Calls mini-log with boost/arrival flags.
    const hotelIds = hotelList.map(h => h.id)
    const { data: callData } = hotelIds.length > 0
      ? await supabase.from('call_logs')
          .select('hotel_id, called_at, from_boost, arrived_at, closest_approach_mi, initial_distance_mi')
          .in('hotel_id', hotelIds)
          .order('called_at', { ascending: false })
      : { data: [] as RecentCall[] }

    // Look up the interstate name for each hotel (via its exit) so the
    // Recent Calls mini-log can show 'from I-87 · 10.4 mi away'. We use
    // a separate small query instead of joining on the main hotels select
    // because the existing Hotel type doesn't carry exit/interstate fields
    // and we don't want to disturb the form code that uses Hotel.
    const exitIds = hotelList.map(h => h.exit_id).filter(Boolean) as string[]
    const { data: hotelExits } = exitIds.length > 0
      ? await supabase.from('exits').select('id, interstates(name)').in('id', exitIds)
      : { data: [] as { id: string; interstates: { name: string } | null }[] }
    const interstateByExit: Record<string, string> = {}
    for (const e of (hotelExits || []) as { id: string; interstates: { name: string } | null }[]) {
      if (e.interstates?.name) interstateByExit[e.id] = e.interstates.name
    }
    setHotelInterstate(
      Object.fromEntries(
        hotelList
          .filter(h => h.exit_id && interstateByExit[h.exit_id])
          .map(h => [h.id, interstateByExit[h.exit_id as string]])
      )
    )

    const calls = (callData || []) as RecentCall[]
    setHotels(hotelList)
    setExits((exitsData as unknown as ExitOption[]) || [])
    if (hData) { setRate(hData.rate || 5); setBillingType(hData.billing_type || 'per_call') }

    const now        = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const r          = hData?.rate || 5
    const bType      = hData?.billing_type || 'per_call'

    const statsMap: Record<string, CallStat> = {}
    // recentMap holds the 5 newest calls per hotel for the mini-log on each
    // card. Already sorted descending by called_at above, so .slice(0, 5)
    // gives us the latest. Kept separate from statsMap so React state stays
    // typed cleanly.
    const recentMap: Record<string, RecentCall[]> = {}
    for (const h of hotelList) {
      const hc      = calls.filter(c => c.hotel_id === h.id)
      const today   = hc.filter(c => new Date(c.called_at) >= todayStart).length
      const month   = hc.filter(c => new Date(c.called_at) >= monthStart).length
      const total   = hc.length
      statsMap[h.id] = {
        calls_today: today, calls_month: month, calls_total: total,
        revenue_month: bType === 'monthly' ? (hData?.rate || 0) : month * r,
      }
      recentMap[h.id] = hc.slice(0, 5)
    }
    setStats(statsMap)
    setRecentCalls(recentMap)
  }

  // Sign up via Supabase Auth, then create the hoteliers profile row linked
  // to the new auth.users entry. With email confirmation ON, the user gets
  // a verification email; auth state flips after they click it.
  async function handleSignup(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('')
    if (!authForm.email || !authForm.password || !authForm.name) {
      setErr('Please fill in all required fields'); return
    }
    if (authForm.password.length < 6) { setErr('Password must be at least 6 characters'); return }
    setAuthBusy(true)
    const email = authForm.email.toLowerCase().trim()
    const { data, error } = await supabase.auth.signUp({
      email,
      password: authForm.password,
      options: {
        emailRedirectTo: typeof window !== 'undefined'
          ? `${window.location.origin}/hotelier`
          : undefined,
      },
    })
    setAuthBusy(false)
    if (error) { setErr(error.message); return }
    if (!data.user) { setErr('Signup failed. Please try again.'); return }

    // Create the hoteliers profile row linked to the new auth user.
    // If a row with this email already existed (legacy signup), keep it and
    // just stamp auth_user_id so the user joins their old data automatically.
    const { data: existing } = await supabase
      .from('hoteliers')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (existing) {
      await supabase.from('hoteliers').update({
        auth_user_id: data.user.id,
        name: authForm.name.trim(),
        business_phone: authForm.business_phone.trim(),
      }).eq('id', existing.id)
    } else {
      await supabase.from('hoteliers').insert({
        auth_user_id: data.user.id,
        email,
        name: authForm.name.trim(),
        business_phone: authForm.business_phone.trim(),
        // password_hash is left blank — we no longer use it. The column is
        // kept for one or two releases as a zero-risk migration cushion.
        password_hash: 'supabase_auth',
      })
    }

    if (data.session) {
      // Email confirmation disabled — they're logged in immediately
      setMsg('Account created! Loading your dashboard…')
    } else {
      // Email confirmation enabled — they need to click the link in the email
      setMsg(`✓ Account created! Check ${email} for a confirmation link, then come back and log in.`)
      setMode('login')
    }
  }

  // Standard email/password login. The auth state listener in useEffect picks
  // up the new session and hydrates the hoteliers row automatically.
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('')
    if (!authForm.email || !authForm.password) { setErr('Email and password required'); return }
    setAuthBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: authForm.email.toLowerCase().trim(),
      password: authForm.password,
    })
    setAuthBusy(false)
    if (error) {
      // Friendlier error messages
      if (error.message.toLowerCase().includes('confirm')) {
        setErr('Please confirm your email first. Check your inbox for a verification link.')
      } else {
        setErr('Invalid email or password.')
      }
      return
    }
    // Success — the auth listener will load the dashboard
  }

  // Forgot-password flow: sends a reset link to the user's email. Clicking
  // the link returns them to /hotelier/reset-password with an active session
  // where they can set a new password.
  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('')
    if (!authForm.email) { setErr('Enter your email address.'); return }
    setAuthBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(
      authForm.email.toLowerCase().trim(),
      {
        redirectTo: typeof window !== 'undefined'
          ? `${window.location.origin}/hotelier/reset-password`
          : undefined,
      }
    )
    setAuthBusy(false)
    if (error) { setErr(error.message); return }
    setMsg('✓ Reset link sent! Check your email and click the link to set a new password.')
  }

  async function logout() {
    await supabase.auth.signOut()
    setHotelier(null); setHotels([]); setStats({}); setRecentCalls({}); setHotelInterstate({}); setView('dashboard'); setMsg('')
  }

  function startEdit(hotel: Hotel) {
    setSelectedHotel(hotel); setHotelForm({ ...hotel }); setView('edit'); setMsg(''); setErr('')
  }

  function startNew() {
    setHotelForm({ name:'', phone:'', address:'', price_min:0, price_max:0, description:'',
      check_in_time:'3:00 PM', check_out_time:'11:00 AM', website:'', amenities:[], exit_id:'' })
    setView('new'); setMsg(''); setErr('')
  }

  async function saveHotel(e: React.FormEvent) {
    e.preventDefault()
    if (!hotelier) return
    // Exit is required — without it, the hotel can't appear in any highway
    // search result, so we block save just like admin does.
    if (!hotelForm.exit_id) { setErr('Please select your highway exit.'); return }
    setSaving(true); setErr(''); setMsg('')
    const payload = {
      name: hotelForm.name, phone: hotelForm.phone, address: hotelForm.address,
      price_min: Number(hotelForm.price_min)||0, price_max: Number(hotelForm.price_max)||0,
      description: hotelForm.description, check_in_time: hotelForm.check_in_time,
      check_out_time: hotelForm.check_out_time, website: hotelForm.website,
      amenities: hotelForm.amenities||[],
      exit_id: hotelForm.exit_id,
      hotelier_id: hotelier.id, updated_at: new Date().toISOString(),
    }
    if (view === 'edit' && selectedHotel) {
      const { error } = await supabase.from('hotels').update(payload).eq('id', selectedHotel.id)
      if (error) { setErr('Save failed.'); setSaving(false); return }
      setMsg('✓ Hotel updated!')
    } else {
      const { error } = await supabase.from('hotels').insert(payload)
      if (error) { setErr('Could not create hotel.'); setSaving(false); return }
      // Honest about the actual state: the row inserts with verified=false
      // and is hidden from drivers until admin manually verifies. Telling
      // the owner 'drivers can now find you' would be wrong, and they'd
      // wonder why no calls came in. Set expectations up front.
      setMsg('✓ Account created! We\u2019ll call within 48 hours to verify your hotel and activate your listing for drivers.')
    }
    await loadAll(hotelier.id); setSaving(false); setView('dashboard')
  }

  function toggleAmenity(key: string) {
    const cur = hotelForm.amenities || []
    setHotelForm(f => ({ ...f, amenities: cur.includes(key) ? cur.filter(a => a !== key) : [...cur, key] }))
  }

  // ─── BOOST ─────────────────────────────────────────────────────────────
  // Local state controls the "which hotel is the user setting up boost for"
  // panel — only one expanded at a time. The actual data lives in the hotels
  // table (boost_price, boost_started_at, boost_ends_at, etc.).
  const [boostingHotelId, setBoostingHotelId] = useState<string | null>(null)
  const [boostPriceInput, setBoostPriceInput] = useState<string>('')
  const [boostDuration, setBoostDuration] = useState<1 | 2 | 3>(1)
  const [boostBusy, setBoostBusy] = useState(false)
  // Change-password modal — reachable from the dashboard top bar so a logged-in
  // hotelier can rotate their password without going through the email reset flow.
  const [showChangePw, setShowChangePw] = useState(false)

  // ET calendar date as YYYY-MM-DD — used for the "1x per day" rule.
  function etDateString(d: Date = new Date()): string {
    // Intl gives reliable ET conversion regardless of server/client TZ
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d)
    const y = parts.find(p => p.type === 'year')?.value
    const m = parts.find(p => p.type === 'month')?.value
    const day = parts.find(p => p.type === 'day')?.value
    return `${y}-${m}-${day}`
  }

  function formatBoostCountdown(endsAt: string): string {
    const ms = new Date(endsAt).getTime() - Date.now()
    if (ms <= 0) return 'ending…'
    const totalMin = Math.floor(ms / 60000)
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`
  }

  function isBoostedNow(h: Hotel): boolean {
    if (!h.featured) return false
    if (!h.boost_ends_at) return false
    return new Date(h.boost_ends_at).getTime() > Date.now()
  }

  function hasUsedBoostToday(h: Hotel): boolean {
    if (!h.last_boost_date) return false
    return h.last_boost_date === etDateString()
  }

  function openBoostPanel(h: Hotel) {
    setBoostingHotelId(h.id)
    setBoostPriceInput(h.boost_price ? String(h.boost_price) : '')
    setBoostDuration(1)
    setMsg(''); setErr('')
  }

  async function activateBoost(h: Hotel) {
    if (!hotelier) return
    // Price is optional. Hoteliers can boost for visibility alone (no price
    // shown to driver) OR with a specific boost rate. If a price is entered,
    // it just has to be a positive number — we no longer cap it against a
    // 'regular rate' since the app doesn't advertise regular rates anywhere.
    // The hotelier sets whatever rate they want to publish for the next
    // 1/2/3 hours.
    const trimmed = boostPriceInput.trim()
    let priceForBoost: number | null = null
    if (trimmed !== '') {
      const priceNum = parseInt(trimmed, 10)
      if (!priceNum || priceNum <= 0) { setErr('Boost price must be a positive number, or leave it blank.'); return }
      priceForBoost = priceNum
    }
    if (hasUsedBoostToday(h)) { setErr('You have already used today\'s boost on this hotel.'); return }

    setBoostBusy(true); setErr('')
    const now = new Date()
    const endsAt = new Date(now.getTime() + boostDuration * 60 * 60 * 1000)
    const { error } = await supabase.from('hotels').update({
      featured: true,
      boost_price: priceForBoost,
      boost_started_at: now.toISOString(),
      boost_ends_at: endsAt.toISOString(),
      boost_duration_hr: boostDuration,
      last_boost_date: etDateString(now),
    }).eq('id', h.id)
    setBoostBusy(false)
    if (error) { setErr('Could not activate boost.'); return }
    setMsg(`✓ Boost active for ${boostDuration} hour${boostDuration > 1 ? 's' : ''}!`)
    setBoostingHotelId(null)
    await loadAll(hotelier.id)
  }

  async function endBoost(h: Hotel) {
    if (!hotelier) return
    setBoostBusy(true); setErr('')
    const { error } = await supabase.from('hotels').update({
      featured: false,
      boost_started_at: null,
      boost_ends_at: null,
      boost_duration_hr: null,
      // Keep boost_price + last_boost_date — daily lockout still applies
    }).eq('id', h.id)
    setBoostBusy(false)
    if (error) { setErr('Could not end boost.'); return }
    setMsg('Boost ended.')
    await loadAll(hotelier.id)
  }

  const totalCallsMonth = Object.values(stats).reduce((s, v) => s + v.calls_month, 0)
  const totalCallsAll   = Object.values(stats).reduce((s, v) => s + v.calls_total, 0)
  const totalRevMonth   = Object.values(stats).reduce((s, v) => s + v.revenue_month, 0)

  // ── AUTH ──
  if (!hotelier) return (
    <>
    <main style={{ background:'var(--night)', minHeight:'calc(100vh - 56px)', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px 20px' }}>
      <div style={{ width:'100%', maxWidth:'420px' }}>
        <div style={{ textAlign:'center', marginBottom:'32px' }}>
          <div style={{ fontSize:'36px', marginBottom:'8px' }}>🏨 🚐</div>
          <h1 style={{ fontSize:'26px', fontFamily:'Syne, sans-serif', fontWeight:800, color:'var(--white)', letterSpacing:'-0.5px' }}>
            Hotel/Park <span style={{ color:'var(--amber)' }}>Owner</span>
          </h1>
          <p style={{ color:'var(--fog)', fontSize:'13px', marginTop:'6px' }}>List your property · Track calls · No commissions</p>
        </div>
        <div style={{ display:'flex', background:'var(--night2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'4px', marginBottom:'20px' }}>
          {(['login','signup'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setErr(''); setMsg('') }} style={{
              flex:1, padding:'10px', border:'none', borderRadius:'7px', cursor:'pointer',
              fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'13px', transition:'all 0.15s',
              background: mode===m ? 'var(--amber)' : 'transparent',
              color:      mode===m ? 'var(--night)' : 'var(--fog)',
            }}>{m === 'login' ? 'Log In' : 'Sign Up'}</button>
          ))}
        </div>
        <form
          onSubmit={
            mode === 'forgot' ? handleForgotPassword :
            mode === 'login'  ? handleLogin :
            handleSignup
          }
          style={{ background:'var(--night2)', border:'1px solid var(--border)', borderRadius:'16px', padding:'24px' }}
        >
          {mode === 'forgot' && (
            <p style={{ fontSize:'12px', color:'var(--mist)', marginBottom:'14px', lineHeight:1.5 }}>
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
          )}
          {mode === 'signup' && <>
            <Field label="Your Name *" value={authForm.name} onChange={v => setAuthForm(f=>({...f,name:v}))} placeholder="Jane Smith" />
            <Field label="Business Phone" value={authForm.business_phone} onChange={v => setAuthForm(f=>({...f,business_phone:v}))} placeholder="(555) 000-0000" type="tel" />
          </>}
          <Field label="Email Address *" value={authForm.email} onChange={v => setAuthForm(f=>({...f,email:v}))} placeholder="you@yourhotel.com" type="email" />
          {mode !== 'forgot' && (
            <Field label="Password *" value={authForm.password} onChange={v => setAuthForm(f=>({...f,password:v}))} placeholder="••••••••" type="password" />
          )}
          {err && <ErrBox msg={err} />}
          {msg && (
            <div style={{
              background:'rgba(34,197,94,0.10)', border:'1px solid rgba(34,197,94,0.4)',
              color:'#22c55e', borderRadius:'8px', padding:'10px 12px', marginBottom:'12px',
              fontSize:'12px', lineHeight:1.4,
            }}>{msg}</div>
          )}
          <button type="submit" disabled={authBusy} className="btn-amber" style={{ width:'100%', padding:'14px', fontSize:'14px', letterSpacing:'0.5px', opacity: authBusy ? 0.6 : 1 }}>
            {authBusy ? 'WORKING…' :
              mode === 'forgot' ? 'SEND RESET LINK →' :
              mode === 'login'  ? 'LOG IN →' :
              'CREATE ACCOUNT →'}
          </button>
          {mode === 'login' && (
            <div style={{ textAlign:'center', marginTop:'14px', display:'flex', flexDirection:'column', gap:'6px' }}>
              <button type="button" onClick={() => { setMode('forgot'); setErr(''); setMsg('') }} style={{ background:'none', border:'none', color:'var(--amber)', cursor:'pointer', fontSize:'12px', textDecoration:'underline' }}>
                Forgot your password?
              </button>
              <p style={{ fontSize:'12px', color:'var(--fog)', margin:0 }}>
                No account?{' '}
                <button type="button" onClick={() => { setMode('signup'); setErr(''); setMsg('') }} style={{ background:'none', border:'none', color:'var(--amber)', cursor:'pointer', fontSize:'12px', textDecoration:'underline' }}>Sign up free</button>
              </p>
            </div>
          )}
          {mode === 'forgot' && (
            <p style={{ textAlign:'center', marginTop:'14px', fontSize:'12px', color:'var(--fog)' }}>
              Remembered it?{' '}
              <button type="button" onClick={() => { setMode('login'); setErr(''); setMsg('') }} style={{ background:'none', border:'none', color:'var(--amber)', cursor:'pointer', fontSize:'12px', textDecoration:'underline' }}>Back to log in</button>
            </p>
          )}
        </form>
        <p style={{ textAlign:'center', marginTop:'16px', fontSize:'11px', color:'var(--fog)', lineHeight:1.5 }}>Free basic listing. Drivers call you directly. Zero commissions.</p>
      </div>
    </main>
    <SiteFooter />
    </>
  )

  // ── HOTEL FORM ──
  if (view==='edit' || view==='new') return (
    <>
    <main style={{ background:'var(--night)', minHeight:'calc(100vh - 56px)', padding:'24px 20px 60px' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'24px' }}>
          <button onClick={() => setView('dashboard')} style={{ background:'var(--night2)', border:'1px solid var(--border)', color:'var(--fog)', padding:'8px 14px', borderRadius:'8px', cursor:'pointer', fontSize:'13px' }}>← Back</button>
          <h1 style={{ fontSize:'22px', fontFamily:'Syne, sans-serif', color:'var(--white)', fontWeight:800 }}>{view==='new' ? 'Add Your Hotel' : 'Edit Hotel'}</h1>
        </div>
        {msg && <GreenBox msg={msg} />}
        <form onSubmit={saveHotel}>
          <Section title="📋 Basic Information">
            <Field label="Hotel / Motel Name *" value={hotelForm.name||''} onChange={v=>setHotelForm(f=>({...f,name:v}))} placeholder="Sunset Motel" />
            <Field label="Phone Number *" value={hotelForm.phone||''} onChange={v=>setHotelForm(f=>({...f,phone:v}))} placeholder="(555) 123-4567" type="tel" />
            <Field label="Street Address" value={hotelForm.address||''} onChange={v=>setHotelForm(f=>({...f,address:v}))} placeholder="1234 Highway Dr, City, FL 12345" />
            <Field label="Website (optional)" value={hotelForm.website||''} onChange={v=>setHotelForm(f=>({...f,website:v}))} placeholder="https://www.yourmotel.com" type="url" />
          </Section>
          <Section title="🛣️ Highway Exit">
            <label className="dark-label">Which exit are you off of? *</label>
            <select
              value={hotelForm.exit_id||''}
              onChange={e=>setHotelForm(f=>({...f,exit_id:e.target.value}))}
              style={{ width:'100%', background:'var(--night3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'12px 14px', color:'var(--white)', fontSize:'14px', fontFamily:'DM Sans, sans-serif', boxSizing:'border-box', appearance:'auto' }}
            >
              <option value="">Select your exit...</option>
              {exits.map(ex => (
                <option key={ex.id} value={ex.id}>
                  {ex.interstates?.name || '?'} {ex.direction} · MM {ex.mile_marker}{ex.exit_label ? ` (Exit ${ex.exit_label})` : ''} · {ex.city}, {ex.state}
                </option>
              ))}
            </select>
            <p style={{ fontSize:'11px', color:'var(--fog)', marginTop:'8px', lineHeight:1.4 }}>
              Drivers searching by highway and mile marker will only find your hotel if you select your exit here.
            </p>
          </Section>
          <Section title="📝 Description">
            <label className="dark-label">Tell drivers about your property</label>
            <textarea value={hotelForm.description||''} onChange={e=>setHotelForm(f=>({...f,description:e.target.value}))}
              placeholder="Clean, comfortable rooms right off the highway. Family owned since 1987..."
              rows={4} style={{ width:'100%', background:'var(--night3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'12px 14px', color:'var(--white)', fontSize:'14px', fontFamily:'DM Sans, sans-serif', resize:'vertical', boxSizing:'border-box', marginBottom:'0' }} />
          </Section>
          {/* Nightly Rates section removed — RoadSleep doesn't display
              regular rates on listings. Drivers call to get tonight's rate.
              Hoteliers control their price signal via Boost only. */}
          <Section title="🕐 Check-in / Check-out">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
              <Field label="Check-in Time" value={hotelForm.check_in_time||'3:00 PM'} onChange={v=>setHotelForm(f=>({...f,check_in_time:v}))} placeholder="3:00 PM" />
              <Field label="Check-out Time" value={hotelForm.check_out_time||'11:00 AM'} onChange={v=>setHotelForm(f=>({...f,check_out_time:v}))} placeholder="11:00 AM" />
            </div>
          </Section>
          <Section title="✅ Amenities">
            <div style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
              {AMENITY_OPTIONS.map(a => {
                const sel = (hotelForm.amenities||[]).includes(a.key)
                return (
                  <button key={a.key} type="button" onClick={() => toggleAmenity(a.key)} style={{
                    padding:'8px 14px', borderRadius:'20px', cursor:'pointer', fontSize:'13px',
                    fontFamily:'DM Sans, sans-serif', fontWeight:500, transition:'all 0.15s',
                    border:      sel ? '1px solid var(--amber)' : '1px solid var(--border)',
                    background:  sel ? 'rgba(245,166,35,0.15)' : 'var(--night3)',
                    color:       sel ? 'var(--amber)' : 'var(--mist)',
                  }}>{a.label}</button>
                )
              })}
            </div>
          </Section>
          {err && <ErrBox msg={err} />}
          <button type="submit" disabled={saving} className="btn-amber" style={{ width:'100%', padding:'16px', fontSize:'15px', letterSpacing:'1px', marginTop:'8px' }}>
            {saving ? 'SAVING...' : view==='new' ? 'LIST MY HOTEL →' : 'SAVE CHANGES →'}
          </button>
        </form>
      </div>
    </main>
    <SiteFooter />
    </>
  )

  // ── DASHBOARD ──
  return (
    <>
    <main style={{ background:'var(--night)', minHeight:'calc(100vh - 56px)', padding:'24px 20px 60px' }}>
      {showChangePw && <HotelierChangePasswordModal onClose={() => setShowChangePw(false)} />}
      <div style={{ maxWidth:'760px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'24px', flexWrap:'wrap', gap:'12px' }}>
          <div>
            <h1 style={{ fontSize:'26px', fontFamily:'Syne, sans-serif', fontWeight:800, color:'var(--white)', letterSpacing:'-0.5px' }}>
              Welcome, <span style={{ color:'var(--amber)' }}>{hotelier.name}</span>
            </h1>
            <p style={{ color:'var(--fog)', fontSize:'13px', marginTop:'2px' }}>{hotelier.email}</p>
          </div>
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            <button onClick={startNew} className="btn-amber" style={{ padding:'10px 18px', fontSize:'13px' }}>+ Add Hotel</button>
            <button onClick={() => setShowChangePw(true)} style={{ background:'var(--night2)', border:'1px solid var(--border)', color:'var(--fog)', padding:'10px 14px', borderRadius:'8px', cursor:'pointer', fontSize:'13px' }}>Change Password</button>
            <button onClick={logout} style={{ background:'var(--night2)', border:'1px solid var(--border)', color:'var(--fog)', padding:'10px 14px', borderRadius:'8px', cursor:'pointer', fontSize:'13px' }}>Log out</button>
          </div>
        </div>

        {/* Tab navigation. Two main hotelier views:
            - 📊 Performance: stats, boost attribution, GPS arrivals (was /dashboard)
            - 🏨 My Listings: hotel cards with edit/boost controls (was /hotelier)
            Edit/new forms are sub-pages reachable from My Listings. */}
        <div style={{
          display: 'flex', gap: '4px', marginBottom: '20px',
          borderBottom: '1px solid var(--border)',
        }}>
          {([
            ['dashboard', '🏨 My Listings'],
            ['performance', '📊 Performance'],
          ] as const).map(([key, label]) => {
            const active = view === key
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                style={{
                  padding: '10px 16px',
                  background: active ? 'var(--night2)' : 'transparent',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--amber)' : '2px solid transparent',
                  color: active ? 'var(--white)' : 'var(--fog)',
                  fontSize: '14px',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  marginBottom: '-1px',  // overlap the container border
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Performance tab — embeds the same DashboardView the /dashboard
            route renders, so we don't duplicate 300 lines of stats UI. */}
        {view === 'performance' && (
          <div style={{ marginBottom: '24px' }}>
            <DashboardView />
          </div>
        )}

        {/* My Listings tab — the original /hotelier landing content. */}
        {view === 'dashboard' && <>

        {msg && <GreenBox msg={msg} />}

        {hotels.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px,1fr))', gap:'10px', marginBottom:'24px' }}>
            <StatCard label="Calls This Month" value={String(totalCallsMonth)} accent="amber" />
            <StatCard label="Total Calls Ever" value={String(totalCallsAll)} accent="white" />
            <StatCard label={billingType==='monthly' ? 'Monthly Fee' : 'Revenue This Month'} value={`$${totalRevMonth.toLocaleString()}`} accent="blue"
              sub={billingType==='per_call' ? `$${rate}/call` : `$${rate}/mo flat`} />
          </div>
        )}

        {hotels.length === 0 ? (
          <div style={{ textAlign:'center', padding:'60px 20px', background:'var(--night2)', border:'1px solid var(--border)', borderRadius:'16px' }}>
            <div style={{ fontSize:'40px', marginBottom:'12px' }}>🏨</div>
            <h2 style={{ fontSize:'18px', fontFamily:'Syne, sans-serif', color:'var(--white)', marginBottom:'8px' }}>No hotels listed yet</h2>
            <p style={{ color:'var(--fog)', fontSize:'13px', marginBottom:'20px' }}>Add your property so drivers can find and call you.</p>
            <button onClick={startNew} className="btn-amber" style={{ padding:'12px 24px', fontSize:'14px' }}>+ List My First Hotel</button>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            {hotels.map(h => {
              const s = stats[h.id] || { calls_today:0, calls_month:0, calls_total:0, revenue_month:0 }
              return (
                <div key={h.id} style={{ background:'var(--night2)', border:'1px solid var(--border)', borderRadius:'14px', padding:'18px 20px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'12px', flexWrap:'wrap' }}>
                    <div style={{ flex:1 }}>
                      <h3 style={{ fontSize:'17px', fontFamily:'Syne, sans-serif', color:'var(--white)', fontWeight:700, marginBottom:'4px' }}>
                        {h.featured && <span style={{ color:'var(--amber)' }}>★ </span>}{h.name}
                      </h3>
                      <p style={{ fontSize:'13px', color:'var(--fog)', marginBottom:'4px' }}>{h.address}</p>
                      <p style={{ fontSize:'13px', color:'var(--mist)' }}>📞 {h.phone}</p>
                    </div>
                    <button onClick={() => startEdit(h)} style={{ background:'var(--night3)', border:'1px solid var(--border)', color:'var(--mist)', padding:'8px 16px', borderRadius:'8px', cursor:'pointer', fontSize:'13px', whiteSpace:'nowrap' }}>✏️ Edit</button>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'8px', marginTop:'14px', borderTop:'1px solid var(--border)', paddingTop:'14px' }}>
                    {[
                      { label:'Today',      value: String(s.calls_today),              isRev:false },
                      { label:'This Month', value: String(s.calls_month),              isRev:false },
                      { label:'All Time',   value: String(s.calls_total),              isRev:false },
                      { label: billingType==='monthly' ? 'Monthly Fee' : 'Mo. Revenue', value:`$${s.revenue_month.toLocaleString()}`, isRev:true },
                    ].map(st => (
                      <div key={st.label} style={{ textAlign:'center', background:'var(--night3)', borderRadius:'8px', padding:'10px 6px' }}>
                        <div style={{ fontSize:'18px', fontWeight:700, fontFamily:'Syne, sans-serif', color: st.isRev ? 'var(--amber)':'var(--white)' }}>{st.value}</div>
                        <div style={{ fontSize:'10px', color:'var(--fog)', marginTop:'2px', textTransform:'uppercase', letterSpacing:'0.4px' }}>{st.label}</div>
                        {!st.isRev && <div style={{ fontSize:'10px', color:'var(--fog)' }}>calls</div>}
                      </div>
                    ))}
                  </div>

                  {/* ─── BOOST CONTROL ─────────────────────────────────────────
                       Three states drive the UI:
                         (a) currently boosted → show countdown + End Now button
                         (b) used today's boost (window over) → locked till tomorrow
                         (c) eligible → "Boost This Listing" button (opens setup panel)
                       Boost requires a discount price entry; we disable submission
                       if it's missing or not lower than the regular rate.            */}
                  <div style={{ marginTop:'14px', borderTop:'1px solid var(--border)', paddingTop:'14px' }}>
                    {isBoostedNow(h) ? (
                      <div style={{
                        background:'linear-gradient(90deg, var(--amber) 0%, var(--amber2) 100%)',
                        color:'var(--night)', borderRadius:'10px', padding:'12px 14px',
                        display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap',
                      }}>
                        <div>
                          <div style={{ fontSize:'12px', fontWeight:700, fontFamily:'Syne, sans-serif', letterSpacing:'1px' }}>
                            🔥 BOOST ACTIVE
                          </div>
                          <div style={{ fontSize:'11px', marginTop:'2px', fontWeight:600 }}>
                            ${h.boost_price} discount · {h.boost_ends_at ? formatBoostCountdown(h.boost_ends_at) : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => endBoost(h)}
                          disabled={boostBusy}
                          style={{
                            background:'rgba(15,22,38,0.85)', color:'var(--white)',
                            border:'none', padding:'8px 14px', borderRadius:'8px',
                            fontSize:'12px', fontWeight:600, cursor:'pointer',
                          }}
                        >
                          End Boost Now
                        </button>
                      </div>
                    ) : hasUsedBoostToday(h) ? (
                      <div style={{
                        background:'var(--night3)', border:'1px solid var(--border)',
                        borderRadius:'10px', padding:'10px 14px', textAlign:'center',
                      }}>
                        <div style={{ fontSize:'12px', color:'var(--mist)', fontWeight:600 }}>
                          ⏸ Today's boost used — available again tomorrow
                        </div>
                      </div>
                    ) : (
                      // RESTING STATE — no active boost, no boost used today.
                      // Show the full setup panel inline (always visible — no
                      // hidden behind a "Set Up Boost" click). The Activate
                      // button is the hero: large, pulsating, dominant.
                      // Hotelier opens the page and the path to boost is
                      // immediately obvious.
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(255,106,0,0.08) 0%, rgba(245,166,35,0.06) 100%)',
                        border: '2px solid rgba(255,106,0,0.35)',
                        borderRadius: '14px', padding: '18px',
                      }}>
                        <div style={{
                          fontSize: '16px', fontWeight: 800, color: 'var(--white)',
                          fontFamily: 'Syne, sans-serif', marginBottom: '4px',
                          letterSpacing: '0.5px',
                        }}>
                          ⭐ Boost Your Listing
                        </div>
                        <p style={{
                          fontSize: '12px', color: 'var(--mist)',
                          marginBottom: '14px', lineHeight: 1.4,
                        }}>
                          Get featured to drivers right now. Set a rate to advertise, or leave it blank. One boost per day.
                        </p>

                        <div style={{ marginBottom: '12px' }}>
                          <label style={{ fontSize: '11px', color: 'var(--white)', display: 'block', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            Your boost price tonight <span style={{ color: 'var(--fog)', fontWeight: 500, textTransform: 'none', letterSpacing: '0' }}>(optional)</span>
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={boostingHotelId === h.id ? boostPriceInput : ''}
                            onChange={e => { setBoostingHotelId(h.id); setBoostPriceInput(e.target.value) }}
                            onFocus={() => setBoostingHotelId(h.id)}
                            placeholder="e.g. 59"
                            style={{
                              width: '100%', background: 'var(--night)',
                              border: '2px solid var(--border)',
                              borderRadius: '10px', padding: '14px 16px',
                              color: 'var(--white)', fontSize: '20px', fontWeight: 700,
                              fontFamily: 'Syne, sans-serif', boxSizing: 'border-box',
                            }}
                          />
                          <p style={{ fontSize: '14px', color: 'var(--mist)', marginTop: '8px', lineHeight: 1.45 }}>
                            Leave blank to boost without showing a price — drivers see &quot;Call for rate&quot; instead.
                          </p>
                        </div>

                        <div style={{ marginBottom: '14px' }}>
                          <label style={{ fontSize: '11px', color: 'var(--white)', display: 'block', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            Boost duration
                          </label>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {[1, 2, 3].map(hr => (
                              <button
                                key={hr}
                                onClick={() => { setBoostingHotelId(h.id); setBoostDuration(hr as 1 | 2 | 3) }}
                                style={{
                                  flex: 1, padding: '12px',
                                  background: (boostingHotelId === h.id && boostDuration === hr) ? 'var(--amber)' : 'var(--night)',
                                  color: (boostingHotelId === h.id && boostDuration === hr) ? 'var(--night)' : 'var(--white)',
                                  border: `2px solid ${(boostingHotelId === h.id && boostDuration === hr) ? 'var(--amber)' : 'var(--border)'}`,
                                  borderRadius: '10px', fontWeight: 800, fontSize: '15px',
                                  cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                                }}
                              >
                                {hr} HR
                              </button>
                            ))}
                          </div>
                        </div>

                        {(() => {
                          // Price is optional. The activate button is enabled
                          // when either (a) the field is empty (price-free
                          // boost) or (b) the field has a value that passes
                          // validation. Always-enabled feels more like a CTA;
                          // an inert hero button reads as broken.
                          const trimmed = boostPriceInput.trim()
                          const hasPrice = trimmed !== ''
                          const priceNum = parseInt(trimmed, 10)
                          const priceInvalid = hasPrice && (!priceNum || priceNum <= 0)
                          const disabled = boostBusy || priceInvalid
                          return (
                            <button
                              onClick={() => { setBoostingHotelId(h.id); activateBoost(h) }}
                              disabled={disabled}
                              className="boost-pulse-btn"
                              style={{
                                width: '100%', padding: '18px',
                                background: 'linear-gradient(135deg, #FF6A00 0%, #F5A623 100%)',
                                color: '#FFFFFF', border: 'none', borderRadius: '12px',
                                fontSize: '18px', fontWeight: 800, fontFamily: 'Syne, sans-serif',
                                cursor: 'pointer', letterSpacing: '0.5px',
                                boxShadow: '0 4px 20px rgba(255,106,0,0.4)',
                                opacity: disabled ? 0.55 : 1,
                              }}
                            >
                              {boostBusy && boostingHotelId === h.id
                                ? 'Activating…'
                                : '🔥 ACTIVATE BOOST'}
                            </button>
                          )
                        })()}
                        <p style={{
                          fontSize: '10px', color: 'var(--fog)',
                          marginTop: '10px', lineHeight: 1.4, textAlign: 'center',
                        }}>
                          One boost per hotel per day.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* ─── RECENT CALLS MINI-LOG ──────────────────────────────────
                       Last 5 call_logs rows for this hotel. Lives BELOW the
                       boost panel so the hotelier doesn't have to scroll
                       past their call history to find the Activate button —
                       boost is the action, calls are the proof. */}
                  {(() => {
                    const rc = recentCalls[h.id] || []
                    return (
                      <div style={{
                        marginTop: '14px',
                        background: 'var(--night3)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        padding: '12px 14px',
                      }}>
                        <div style={{
                          fontSize: '11px', color: 'var(--fog)',
                          textTransform: 'uppercase', letterSpacing: '0.1em',
                          fontWeight: 700, marginBottom: '8px',
                        }}>
                          📞 Recent Calls
                        </div>
                        {rc.length === 0 ? (
                          <div style={{ fontSize: '12px', color: 'var(--fog)', lineHeight: 1.45 }}>
                            No calls yet. Boost your listing above to start driving traffic.
                          </div>
                        ) : (
                          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {rc.map((c, i) => {
                              const d = new Date(c.called_at)
                              const now = new Date()
                              const isToday = d.toDateString() === now.toDateString()
                              const yesterday = new Date(now)
                              yesterday.setDate(now.getDate() - 1)
                              const isYesterday = d.toDateString() === yesterday.toDateString()
                              const dayLabel = isToday ? 'Today' : isYesterday ? 'Yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
                              const timeLabel = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                              const interstate = hotelInterstate[c.hotel_id]
                              const dist = c.initial_distance_mi
                              const hasOrigin = interstate || dist != null
                              return (
                                <li key={i} style={{
                                  display: 'flex', flexDirection: 'column', gap: '2px',
                                  fontSize: '13px', color: 'var(--white)',
                                  padding: '8px 0',
                                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ color: 'var(--mist)' }}>
                                      {dayLabel} <span style={{ color: 'var(--fog)' }}>{timeLabel}</span>
                                    </span>
                                    {c.from_boost && (
                                      <span style={{
                                        fontSize: '10px', background: 'rgba(245,166,35,0.15)',
                                        color: 'var(--amber)', padding: '2px 7px',
                                        borderRadius: '10px', fontWeight: 700,
                                        border: '1px solid rgba(245,166,35,0.30)',
                                      }}>
                                        ★ boost
                                      </span>
                                    )}
                                    {c.arrived_at && (
                                      <span
                                        title={c.closest_approach_mi != null
                                          ? `Driver closed to ${c.closest_approach_mi.toFixed(2)} mi of your front door (GPS-verified).`
                                          : 'GPS-verified arrival.'}
                                        style={{
                                          fontSize: '10px', background: 'rgba(34,197,94,0.15)',
                                          color: '#22c55e', padding: '2px 7px',
                                          borderRadius: '10px', fontWeight: 700,
                                          border: '1px solid rgba(34,197,94,0.30)',
                                        }}>
                                        📍 arrived
                                      </span>
                                    )}
                                  </div>
                                  {hasOrigin && (
                                    <div style={{ fontSize: '12px', color: 'var(--fog)' }}>
                                      Driver called from
                                      {interstate && <span style={{ color: 'var(--mist)', fontWeight: 600 }}> {interstate}</span>}
                                      {dist != null && (
                                        <>
                                          {interstate ? ' · ' : ' '}
                                          <span style={{ color: 'var(--mist)', fontWeight: 600 }}>{dist.toFixed(1)} mi away</span>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )
                  })()}

                  {h.amenities?.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginTop:'10px' }}>
                      {h.amenities.map(a => {
                        const opt = AMENITY_OPTIONS.find(o => o.key===a)
                        return opt ? <span key={a} style={{ fontSize:'11px', background:'var(--night3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'3px 8px', color:'var(--mist)' }}>{opt.label}</span> : null
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        </>}
      </div>
    </main>
    <SiteFooter />
    </>
  )
}

function Section({ title, children }: { title:string; children:React.ReactNode }) {
  return (
    <div style={{ background:'var(--night2)', border:'1px solid var(--border)', borderRadius:'14px', padding:'20px', marginBottom:'16px' }}>
      <h3 style={{ fontSize:'13px', fontFamily:'Syne, sans-serif', fontWeight:700, color:'var(--amber)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:'14px' }}>{title}</h3>
      {children}
    </div>
  )
}

function StatCard({ label, value, accent, sub }: { label:string; value:string; accent:'amber'|'white'|'blue'; sub?:string }) {
  const color = accent==='amber' ? 'var(--amber)' : accent==='blue' ? 'var(--blue)' : 'var(--white)'
  return (
    <div style={{ background:'var(--night2)', border:'1px solid var(--border)', borderRadius:'12px', padding:'16px 18px' }}>
      <div style={{ fontSize:'10px', color:'var(--fog)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:'6px' }}>{label}</div>
      <div style={{ fontSize:'24px', fontWeight:700, fontFamily:'Syne, sans-serif', color, letterSpacing:'-0.5px' }}>{value}</div>
      {sub && <div style={{ fontSize:'11px', color:'var(--fog)', marginTop:'4px' }}>{sub}</div>}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type='text' }: { label:string; value:string; onChange:(v:string)=>void; placeholder?:string; type?:string }) {
  return (
    <div style={{ marginBottom:'14px' }}>
      <label className="dark-label">{label}</label>
      {type === 'password' ? (
        <PasswordInput value={value} onChange={onChange} placeholder={placeholder} variant="inline" />
      ) : (
        <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{ width:'100%', background:'var(--night3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'12px 14px', color:'var(--white)', fontSize:'14px', fontFamily:'DM Sans, sans-serif', boxSizing:'border-box' }} />
      )}
    </div>
  )
}

function GreenBox({ msg }: { msg:string }) {
  return <div style={{ background:'rgba(62,207,142,0.1)', border:'1px solid rgba(62,207,142,0.3)', borderRadius:'10px', padding:'12px 16px', marginBottom:'20px', fontSize:'13px', color:'var(--green)' }}>{msg}</div>
}

function ErrBox({ msg }: { msg:string }) {
  return <div style={{ background:'rgba(255,80,80,0.1)', border:'1px solid rgba(255,80,80,0.3)', borderRadius:'8px', padding:'10px 14px', marginBottom:'16px', fontSize:'13px', color:'#ff6b6b' }}>{msg}</div>
}

// Change-password modal for logged-in hoteliers. Uses Supabase Auth's built-in
// updateUser({ password }) — same primitive the email-reset flow uses, just
// reachable directly from the dashboard for someone already signed in.
function HotelierChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setErr('')
    if (next !== confirm) { setErr('Passwords do not match'); return }
    if (next.length < 8) { setErr('Password must be at least 8 characters'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: next })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setDone(true)
    setTimeout(onClose, 2000)
  }

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:100,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'20px',
    }}>
      <div onClick={(e)=>e.stopPropagation()} style={{
        background:'var(--night2)', border:'1px solid var(--border)', borderRadius:'16px',
        padding:'28px', width:'100%', maxWidth:'380px',
      }}>
        <h2 style={{ fontSize:'20px', fontFamily:'Syne, sans-serif', color:'var(--white)', marginBottom:'16px' }}>
          Change <span style={{ color:'var(--amber)' }}>Password</span>
        </h2>

        {done ? (
          <p style={{ color:'var(--green)', fontSize:'14px' }}>✓ Password updated.</p>
        ) : (
          <form onSubmit={submit}>
            <Field label="New password" value={next} onChange={setNext} placeholder="at least 8 characters" type="password" />
            <Field label="Confirm new password" value={confirm} onChange={setConfirm} placeholder="same again" type="password" />

            {err && <p style={{ color:'#ff6b6b', fontSize:'12px', marginBottom:'10px' }}>⚠ {err}</p>}

            <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
              <button type="button" onClick={onClose} style={{
                flex:1, background:'var(--night3)', border:'1px solid var(--border)', color:'var(--fog)',
                padding:'10px', borderRadius:'8px', cursor:'pointer', fontSize:'13px',
              }}>Cancel</button>
              <button type="submit" disabled={busy} className="btn-amber" style={{ flex:1, padding:'10px', fontSize:'13px', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'
