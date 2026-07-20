'use client'
import { useState, useEffect } from 'react'
import { supabase, type Hotel, type Interstate } from '@/lib/supabase'
import AdminGate from './AdminGate'

type Tab = 'hotels' | 'hidden' | 'interstates' | 'hoteliers' | 'campaigns'

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

/** Numeric portion of an interstate label, for sorting. "I-75" -> 75.
 *  Returns Number.MAX_SAFE_INTEGER for labels with no digits so they sort to
 *  the end rather than colliding at 0 with each other. */
function interstateNumber(label: string): number {
  const m = label.match(/\d+/)
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER
}

function AdminPageContent() {
  // Defaults to Listings. Reads ?tab= so the Campaigns panel — which no
  // longer has a button in the tab bar — is still reachable at
  // /admin?tab=campaigns without a code change.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'hotels'
    const t = new URLSearchParams(window.location.search).get('tab')
    const valid: Tab[] = ['hotels', 'hidden', 'interstates', 'hoteliers', 'campaigns']
    return valid.includes(t as Tab) ? (t as Tab) : 'hotels'
  })
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
  // Authoritative from_boost call count per hotel (uses the from_boost column
  // on call_logs, not the boost-window timestamp join). More accurate when
  // a hotel has been boosted multiple times.
  const [fromBoostCounts, setFromBoostCounts] = useState<Record<string, number>>({})
  // Per-hotel call history for the drill-down modal. Mirrors the hotelier
  // page's "Recent Calls" mini-log so admin can audit any hotel's call
  // timeline (timestamp + boost flag + initial driver distance) without
  // logging in as that hotelier. Populated in loadAll from the same cl
  // array we already pull for the count stats — no extra query.
  const [recentCallsByHotel, setRecentCallsByHotel] = useState<Record<string, Array<{
    called_at: string
    from_boost: boolean
    initial_distance_mi: number | null
  }>>>({})
  // Hotel id -> interstate name. Needed to render "Driver called from I-75"
  // on each row. Built once during loadAll from each hotel's exit's
  // interstate. Hotels without an exit (rare, RV parks via near_interstate)
  // just omit the I-X part of the line.
  const [hotelInterstate, setHotelInterstate] = useState<Record<string, string>>({})
  // Modal: when admin clicks a hotel's "N calls" pill, show the per-hotel
  // call timeline. null = closed. Holds the hotel name for the title and
  // the rows are looked up from recentCallsByHotel on render.
  const [callsModal, setCallsModal] = useState<{ id: string; name: string } | null>(null)
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
  // Free-text filter for the listings list — name, city, state, address, phone.
  // Case-insensitive substring match. 1,335 hotels is enough that scrolling to
  // find one row is painful; this turns the list into a usable lookup tool.
  const [listingSearch, setListingSearch] = useState('')

  // When true, the listings list also shows hotels with hidden=true. Default
  // false because admin usually wants to see what drivers see. Flip on when
  // triaging the auto-hidden batch (closed, no-phone, bad lat/lng) to decide
  // which to call/unhide. The pill on each hotel card makes it obvious which
  // rows are hidden so this filter doesn't obscure that state.
  const [showHidden, setShowHidden] = useState<boolean>(false)
  // Free-text filter for the dedicated Hidden view (separate from the Listings
  // tab's listingSearch so the two queues don't interfere with each other).
  const [hiddenSearch, setHiddenSearch] = useState<string>('')

  // Testing-mode toggle. When ON, drivers see ALL listings (verified +
  // unverified). When OFF (production), only verified=true show. The green
  // '✔ Front desk confirmed' badge stays bound to verified=true regardless,
  // so the badge keeps its meaning even while testing.
  const [testingMode, setTestingMode] = useState<boolean>(false)
  const [testingModeLoaded, setTestingModeLoaded] = useState<boolean>(false)

  // Campaign attribution: source -> visits -> calls, computed client-side from
  // campaign_visits (landings) and call_logs.source (tagged calls). Loaded
  // lazily when the Campaigns tab is opened so we don't add work to every page.
  const [campaignRows, setCampaignRows] = useState<{ source: string; visits: number; calls: number }[]>([])
  const [campaignLoading, setCampaignLoading] = useState<boolean>(false)

  async function loadCampaigns() {
    setCampaignLoading(true)
    const [visitsRes, callsRes] = await Promise.all([
      supabase.from('campaign_visits').select('source'),
      supabase.from('call_logs').select('source'),
    ])
    const map: Record<string, { visits: number; calls: number }> = {}
    const bump = (s: string | null, key: 'visits' | 'calls') => {
      const k = (s && s.trim()) || '(untagged)'
      if (!map[k]) map[k] = { visits: 0, calls: 0 }
      map[k][key]++
    }
    ;(visitsRes.data || []).forEach((r: any) => bump(r.source, 'visits'))
    ;(callsRes.data || []).forEach((r: any) => bump(r.source, 'calls'))
    const rows = Object.entries(map)
      .map(([source, v]) => ({ source, visits: v.visits, calls: v.calls }))
      .sort((a, b) => b.calls - a.calls || b.visits - a.visits)
    setCampaignRows(rows)
    setCampaignLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  useEffect(() => { if (tab === 'campaigns') loadCampaigns() }, [tab])

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

  // Page through every hotel row of a given type, 1000 at a time, until a
  // short page comes back. Supabase PostgREST caps each response at
  // db-max-rows (1000) regardless of how wide the .range() span is, so a
  // single big range silently truncates. The previous fix hard-coded exactly
  // two pages (0..999, 1000..1999) — that quietly started dropping hotels the
  // moment the 'hotel' type crossed 2000 rows. Looping until a page returns
  // fewer than PAGE rows guarantees we load ALL of them no matter how large
  // inventory grows. RV parks go through the same loop for the same safety.
  async function fetchAllHotelsByType(type: string): Promise<any[]> {
    const PAGE = 1000
    const all: any[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('hotels')
        .select('*, exits(*, interstates(*))')
        .eq('type', type)
        .range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      all.push(...data)
      if (data.length < PAGE) break
    }
    return all
  }

  async function loadAll() {
    const [hotelsOnly, rvOnly, intResp, exitsResp, htResp, clResp] = await Promise.all([
      fetchAllHotelsByType('hotel'),
      fetchAllHotelsByType('rv_park'),
      supabase.from('interstates').select('*').order('name'),
      supabase.from('exits').select('*, interstates(name)').order('mile_marker').range(0, 4999),
      supabase.from('hoteliers').select('*').order('created_at', { ascending: false }),
      // Pull hotel_id + called_at + from_boost + arrival fields so we can
      // compute boost attribution + per-hotel call totals + the timeline
      // modal. hotelier_id stays so the Hoteliers tab works.
      supabase.from('call_logs').select('hotel_id, hotelier_id, called_at, from_boost, arrived_at, closest_approach_mi, initial_distance_mi'),
    ])
    const i = intResp.data
    const e = exitsResp.data
    const ht = htResp.data
    const cl = clResp.data
    const h = [...hotelsOnly, ...(rvOnly || [])]
    if (h.length > 0) {
      // Sort geographically: interstate → state → mile marker (ascending)
      // This way the admin list reads like driving the corridor north-to-south.
      //
      // Interstates sort NUMERICALLY, not as strings. A plain string compare
      // puts I-10 before I-4 (because '1' < '4' character-by-character), which
      // reads as broken to anyone scanning the list. We pull the digits out of
      // the label and compare those, falling back to a string compare for any
      // label that isn't in I-<number> form (US-1, state routes, etc.) so odd
      // corridor names still order deterministically instead of colliding.
      const sorted = [...h].sort((a, b) => {
        const intA = a.exits?.interstates?.name || 'zzz'
        const intB = b.exits?.interstates?.name || 'zzz'
        if (intA !== intB) {
          const numA = interstateNumber(intA)
          const numB = interstateNumber(intB)
          if (numA !== numB) return numA - numB
          return intA.localeCompare(intB)
        }
        const stA = a.exits?.state || a.state || 'ZZ'
        const stB = b.exits?.state || b.state || 'ZZ'
        if (stA !== stB) return stA.localeCompare(stB)
        const mmA = parseFloat(a.exits?.mile_marker ?? '99999')
        const mmB = parseFloat(b.exits?.mile_marker ?? '99999')
        return mmA - mmB
      })
      setHotels(sorted)
    }
    // Re-sort client-side: the DB order('name') is a string sort (I-10 before
    // I-4). Same numeric comparator as the hotels list uses.
    if (i) setInterstates([...i].sort((x, y) => {
      const d = interstateNumber(x.name || '') - interstateNumber(y.name || '')
      return d !== 0 ? d : (x.name || '').localeCompare(y.name || '')
    }))
    if (e) setExits(e)
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
      // Per-hotel from_boost counts. Authoritative source of truth for
      // boost attribution (the boost-window method above can miss calls
      // if a hotel was boosted multiple times or if the boost window was
      // reset). The from_boost column is set at insert time by the
      // driver app, so it's accurate regardless of later boost edits.
      const fromBoostCounts: Record<string, number> = {}
      // Per-hotel call list for the drill-down modal. Newest-first because
      // that's what hoteliers see and what admin will care about (most
      // recent activity at the top of the modal).
      const callsByHotel: Record<string, Array<{
        called_at: string
        from_boost: boolean
        initial_distance_mi: number | null
      }>> = {}
      for (const c of cl) {
        if (c.hotel_id) {
          totals[c.hotel_id] = (totals[c.hotel_id] || 0) + 1
          if (c.from_boost === true) {
            fromBoostCounts[c.hotel_id] = (fromBoostCounts[c.hotel_id] || 0) + 1
          }
          if (!callsByHotel[c.hotel_id]) callsByHotel[c.hotel_id] = []
          callsByHotel[c.hotel_id].push({
            called_at: c.called_at,
            from_boost: c.from_boost === true,
            initial_distance_mi: c.initial_distance_mi != null ? Number(c.initial_distance_mi) : null,
          })
        }
      }
      // Sort each hotel's call list newest-first. The base call_logs query
      // doesn't impose an order so we sort here to guarantee modal rows
      // are chronological regardless of how the rows arrived.
      for (const hid of Object.keys(callsByHotel)) {
        callsByHotel[hid].sort((a, b) => +new Date(b.called_at) - +new Date(a.called_at))
      }
      setHotelCallTotals(totals)
      setFromBoostCounts(fromBoostCounts)
      setRecentCallsByHotel(callsByHotel)

      // Build hotel_id -> interstate name map from the hotels we already
      // loaded. Each hotel's exit knows its interstate, so we just walk the
      // hotels array once. RV parks linked to an interstate by near_interstate
      // (not by exit) aren't handled here — they'll just omit the I-X part
      // in the modal, which renders cleanly because the row code already
      // gates the "from I-X" string on interstate being non-null.
      if (h) {
        const interMap: Record<string, string> = {}
        for (const hotel of h) {
          const iname = hotel.exits?.interstates?.name
          if (iname) interMap[hotel.id] = iname
        }
        setHotelInterstate(interMap)
      }
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
      // See toggleVerified — same multi-column write so the bold front-desk
      // badge appears and any prior auto-hide is cleared.
      const nowIso = new Date().toISOString()
      payload.verified = true
      payload.last_verified_at = nowIso
      payload.verified_at = nowIso
      payload.verification_source = 'frontdesk'
      payload.hidden = false
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

  // Phone-verification toggle. When confirming, we record the verification in
  // ALL the columns that matter — both the legacy boolean (verified +
  // last_verified_at) AND the new richer schema added during the Google
  // verification work:
  //   verification_source = 'frontdesk'  — promotes the hotel from the
  //     softer "Listed on Google · Operational" badge to the bold green
  //     "✔ Front desk confirmed" badge on the driver-facing list.
  //   verified_at                         — fresh timestamp (separate from
  //     last_verified_at for now; both updated until the legacy column is
  //     fully retired).
  //   hidden = false                      — confirming by phone overrides
  //     any prior auto-hide (closed, no-phone, etc.). If you JUST called
  //     and it's a real hotel, it should be visible to drivers regardless
  //     of stale Google data that hid it.
  // When un-verifying, we clear the verified flag + timestamps + source
  // so the hotel reverts to whatever Google says about it. We do NOT
  // re-hide automatically — that's a separate explicit action.
  async function toggleVerified(id: string, val: boolean) {
    const next = !val
    const nowIso = new Date().toISOString()
    const update: Record<string, unknown> = {
      verified: next,
      last_verified_at: next ? nowIso : null,
      verified_at: next ? nowIso : null,
      verification_source: next ? 'frontdesk' : null,
    }
    if (next) update.hidden = false
    await supabase.from('hotels').update(update).eq('id', id)
    loadAll()
  }

  // Toggle hidden flag on a hotel. Used by admin to manually hide a hotel
  // from drivers (suspicious, can't reach, etc.) or to unhide one that the
  // Google verification pipeline auto-hid for reasons admin disagrees with.
  // Hidden = true removes the hotel from /search and / driver views via
  // baseSelect filter; the row stays in DB for audit + future unhide.
  async function toggleHidden(id: string, val: boolean) {
    const next = !val
    await supabase.from('hotels').update({ hidden: next }).eq('id', id)
    loadAll()
  }

  // Reinstate a hidden listing: force hidden=false so it returns to driver
  // search. Unconditional (unlike toggleHidden) — the Hidden view only ever
  // wants to un-hide, so a dedicated one-way action keeps that button honest.
  async function reinstate(id: string) {
    await supabase.from('hotels').update({ hidden: false }).eq('id', id)
    flash('Reinstated — visible to drivers again')
    loadAll()
  }

  // "Verify-and-hide" sweep: every listing that is NOT phone/front-desk
  // verified and not already hidden gets hidden in one pass, dropping it into
  // the Hidden view as a triage queue. We build the id list from the already-
  // loaded (and now COMPLETE — see fetchAllHotelsByType) hotels array so the
  // count in the confirm dialog is exact, then update in chunks of 200 to keep
  // the PostgREST in() filter URL well under length limits.
  async function verifyAndHide() {
    const targets = hotels.filter(h => h.verified !== true && h.hidden !== true)
    if (targets.length === 0) { flash('Nothing to sweep — no unverified visible listings'); return }
    if (!confirm(
      `Hide ${targets.length} unverified listing${targets.length === 1 ? '' : 's'}?\n\n` +
      `They move to the Hidden view and disappear from driver search immediately. ` +
      `Nothing is deleted — reinstate any of them individually from the Hidden tab.`
    )) return
    const ids = targets.map(t => t.id)
    for (let i = 0; i < ids.length; i += 200) {
      await supabase.from('hotels').update({ hidden: true }).in('id', ids.slice(i, i + 200))
    }
    flash(`${targets.length} unverified listing${targets.length === 1 ? '' : 's'} moved to Hidden`)
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

        {/* App-wide call totals — sums of every call_log row, plus the
            subset attributed to boost (from_boost column, authoritative per
            tap). The honest boost-ROI proof is timestamps + initial distance,
            both captured at tap. The old "GPS arrivals" stat was removed
            because the 90-min background tracker that wrote arrived_at almost
            never completed on iOS Safari (it kills background JS) — out of
            ~70 calls in May only 1 had arrived_at set, and that was from
            internal testing. See TODO.md for SMS-confirmation replacement. */}
        {(() => {
          const totalAll = Object.values(hotelCallTotals).reduce((s, n) => s + n, 0)
          const totalBoost = Object.values(fromBoostCounts).reduce((s, n) => s + n, 0)
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
              {stat('Boost Calls', totalBoost, 'var(--amber)', 'tapped Call on a boosted listing')}
              {stat('Organic Calls', organic, '#9ca3af', 'no boost active at tap time')}
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
                  ? `Drivers see all ${hotels.filter(h => h.hidden !== true).length.toLocaleString()} visible listings (verified + unverified). The green ✔ badge still only shows on verified.`
                  : `Drivers see only the ${hotels.filter(h => h.verified === true && h.hidden !== true).length.toLocaleString()} listings flipped to verified=true. Verified badge appears next to all of them.`}
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

        {/* Sub-tabs
         *
         * Campaigns is deliberately NOT in this list. Attribution tracking is
         * fully built and still recording — middleware, campaign_visits, the
         * source stamp on call_logs, and the panel below all remain live — but
         * there are no tagged campaigns running yet, so the tab was showing a
         * single "(untagged)" row and taking up space on a phone screen.
         *
         * Nothing was deleted. To bring it back, either add 'campaigns' to the
         * array below, or visit /admin?tab=campaigns which still renders it. */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '20px',
          borderBottom: '1px solid var(--border)',
          // Labels like "Interstates & Exits" wrapped mid-phrase on a phone,
          // which is what made the tab row look garbled. Keep each label on
          // one line and let the row scroll sideways instead.
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
          {(['hotels', 'hidden', 'interstates', 'hoteliers'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'none', border: 'none',
              color: tab === t ? 'var(--amber)' : 'var(--fog)',
              borderBottom: tab === t ? '2px solid var(--amber)' : '2px solid transparent',
              padding: '10px 4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif', marginBottom: '-1px',
              whiteSpace: 'nowrap',
            }}>
              {t === 'hotels' ? '🏨 Listings'
                : t === 'hidden' ? `🚫 Hidden (${hotels.filter(h => h.hidden === true).length})`
                : t === 'interstates' ? '🛣️ Interstates & Exits'
                : t === 'hoteliers' ? '👤 Hoteliers'
                : '📣 Campaigns'}
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
                {/* Price Min/Max are INTERNAL analytics only — never shown
                    to drivers or hoteliers anywhere in the app. Used by
                    est_revenue_per_call calculations on the dashboard. */}
                <div>
                  <label className="dark-label">Price Min ($/night) <span style={{ color:'#888', fontSize:'10px' }}>(internal only)</span></label>
                  <input className="dark-input" type="number" value={form.price_min} onChange={e => setForm(f => ({ ...f, price_min: e.target.value }))} placeholder="59"/>
                </div>
                <div>
                  <label className="dark-label">Price Max ($/night) <span style={{ color:'#888', fontSize:'10px' }}>(internal only)</span></label>
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
                  {/* Search box — filters listings client-side. Searches across name,
                      city, state, full address, and phone so the admin can find a row
                      however they remember it ("lake george", "wifi", "518-792"). 
                      Distinct amber-tinted background + bold label so it stands out
                      from the dark form inputs above. */}
                  <div style={{
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--border)',
                    background: 'rgba(245,166,35,0.06)',
                  }}>
                    <label style={{
                      display: 'block',
                      fontSize: '11px',
                      color: 'var(--amber)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      fontWeight: 700,
                      marginBottom: '6px',
                    }}>
                      🔍 Search Listings
                    </label>
                    <input
                      type="text"
                      value={listingSearch}
                      onChange={(e) => setListingSearch(e.target.value)}
                      placeholder="Search by name, city, state, address, or phone…"
                      autoComplete="off"
                      spellCheck={false}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        fontSize: '15px',
                        background: 'var(--white)',
                        color: 'var(--night)',
                        border: '2px solid var(--amber)',
                        borderRadius: '8px',
                        outline: 'none',
                        fontFamily: 'inherit',
                      }}
                    />
                    {/* Hidden-listings toggle. Off by default (admin sees what
                        drivers see). Flip on when triaging the auto-hidden
                        batch (closed/no-phone/bad-lat-lng). Each shown hidden
                        row gets a red "🚫 Hidden" badge + Unhide button. */}
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      marginTop: '10px', fontSize: '12px', color: 'var(--mist)',
                      cursor: 'pointer', userSelect: 'none',
                    }}>
                      <input
                        type="checkbox"
                        checked={showHidden}
                        onChange={(e) => setShowHidden(e.target.checked)}
                        style={{ cursor: 'pointer', accentColor: 'var(--amber)' }}
                      />
                      Show hidden listings
                      <span style={{ color: 'var(--fog)', fontSize: '11px' }}>
                        ({hotels.filter(h => (h.type || 'hotel') === adminCategory && h.hidden === true).length} hidden in this category)
                      </span>
                    </label>
                    {listingSearch.trim() !== '' && (() => {
                      const q = listingSearch.trim().toLowerCase()
                      const visible = hotels
                        .filter(h => (h.type || 'hotel') === adminCategory)
                        .filter(h => showHidden || h.hidden !== true)
                        .filter(h => {
                          const hay = [
                            h.name, h.city, h.state, h.address, h.street_address,
                            h.zip, h.phone,
                            h.exits?.city, h.exits?.state, h.exits?.interstates?.name,
                          ].filter(Boolean).join(' ').toLowerCase()
                          return hay.includes(q)
                        })
                      return (
                        <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--fog)' }}>
                          {visible.length} match{visible.length === 1 ? '' : 'es'}
                          {visible.length > 0 && (
                            <button
                              onClick={() => setListingSearch('')}
                              style={{
                                marginLeft: '8px', padding: '2px 8px', fontSize: '11px',
                                background: 'transparent', border: '1px solid var(--border)',
                                color: 'var(--fog)', borderRadius: '4px', cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >Clear</button>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                  {hotels
                    .filter(h => (h.type || 'hotel') === adminCategory)
                    .filter(h => showHidden || h.hidden !== true)
                    .filter(h => {
                      if (listingSearch.trim() === '') return true
                      const q = listingSearch.trim().toLowerCase()
                      const hay = [
                        h.name, h.city, h.state, h.address, h.street_address,
                        h.zip, h.phone,
                        h.exits?.city, h.exits?.state, h.exits?.interstates?.name,
                      ].filter(Boolean).join(' ').toLowerCase()
                      return hay.includes(q)
                    })
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
                            {/* Verification status mirroring the driver-facing
                                badge logic. Three states surface differently
                                so admin can tell at a glance what backed each
                                verification:

                                - bold green "✔ Front desk confirmed":
                                  verified=true AND verification_source='frontdesk'
                                  → admin (you) called and confirmed live.
                                  Strongest possible signal; this is the badge
                                  drivers see on the bold-green tier.

                                - softer slate "Listed on Google · Operational":
                                  verified=true AND verification_source='google'
                                  → Google Places API confirmed the hotel is
                                  OPERATIONAL but no human has called yet.
                                  Visible to drivers with the secondary badge.

                                - amber "✓ Verified" (no source recorded):
                                  verified=true AND verification_source IS NULL
                                  → legacy verifications from before the
                                  two-tier work. Treat as unsourced; eligible
                                  for a Phone Verify pass to promote.

                                - red "⚠ Unverified · hidden from drivers":
                                  verified=false → never confirmed by anyone.
                                  Driver-facing list excludes these by default
                                  (unless testing mode is on). */}
                            {h.verified ? (
                              h.verification_source === 'frontdesk' ? (
                                <span style={{
                                  fontSize: '10px',
                                  background: 'rgba(34,197,94,0.18)',
                                  color: '#22c55e',
                                  padding: '2px 7px', borderRadius: '10px', fontWeight: 700,
                                  border: '1px solid rgba(34,197,94,0.40)',
                                }}
                                title="You confirmed this hotel by phone. Drivers see the bold front-desk badge.">
                                  ✔ Front desk confirmed
                                </span>
                              ) : h.verification_source === 'google' ? (
                                <span style={{
                                  fontSize: '10px',
                                  background: 'rgba(148,163,184,0.12)',
                                  color: '#94a3b8',
                                  padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                                  border: '1px solid rgba(148,163,184,0.30)',
                                }}
                                title="Confirmed by Google Places API (status=OPERATIONAL). Drivers see the softer Google badge. Phone-verify this to promote to bold Front desk.">
                                  G · Operational
                                </span>
                              ) : (
                                <span style={{
                                  fontSize: '10px',
                                  background: 'rgba(245,166,35,0.15)',
                                  color: 'var(--amber)',
                                  padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                                  border: '1px solid rgba(245,166,35,0.30)',
                                }}
                                title="Verified before the two-tier work landed. No verification_source recorded. Phone-verify to promote to bold Front desk.">
                                  ✓ Verified (legacy)
                                </span>
                              )
                            ) : (
                              <span style={{
                                fontSize: '10px', background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                                padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                              }}>⚠ Unverified · hidden from drivers</span>
                            )}
                            {/* Closed-permanently pill. Shows when Google
                                Places returned CLOSED_PERMANENTLY for this
                                hotel. We auto-set hidden=true when that
                                happens. Surfacing the reason here so admin
                                doesn't have to guess why a row is hidden. */}
                            {h.google_business_status === 'CLOSED_PERMANENTLY' && (
                              <span style={{
                                fontSize: '10px',
                                background: 'rgba(239,68,68,0.10)',
                                color: '#ef4444',
                                padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                                border: '1px solid rgba(239,68,68,0.30)',
                              }}
                              title="Google Places reported this hotel as CLOSED_PERMANENTLY. Auto-hidden from drivers. Phone-verify to override if Google is wrong.">
                                ⛔ Closed (Google)
                              </span>
                            )}
                            {/* Hidden-from-drivers pill. Renders for any
                                hidden=true row regardless of reason — closed,
                                no-phone, bad lat/lng, or admin-toggled. The
                                closed pill above is supplemental info; this
                                one is the truth about driver visibility. */}
                            {h.hidden === true && (
                              <span style={{
                                fontSize: '10px',
                                background: 'rgba(239,68,68,0.20)',
                                color: '#ef4444',
                                padding: '2px 7px', borderRadius: '10px', fontWeight: 700,
                                border: '1px solid rgba(239,68,68,0.40)',
                              }}
                              title="Currently hidden from drivers. Use the Unhide button below to restore visibility.">
                                🚫 Hidden
                              </span>
                            )}
                            {/* All-time total calls received from anywhere in
                                the app (home, search, hotel detail). Always
                                shown — even at zero — so admin can compare
                                across hotels and spot dead inventory. Visually
                                distinct (mist/blue tint) from the green boost
                                pill so the two never blur together. When
                                total > 0, the pill becomes a clickable button
                                that opens a per-hotel timeline modal mirroring
                                the hotelier dashboard's Recent Calls log
                                (timestamp + ★ boost flag + "Driver called
                                from I-X · N mi away"). At zero it stays a
                                non-interactive span so we don't tease an
                                empty modal. */}
                            {(() => {
                              const total = hotelCallTotals[h.id] || 0
                              const sharedStyle = {
                                fontSize: '10px',
                                background: total > 0 ? 'rgba(99,179,237,0.10)' : 'rgba(255,255,255,0.04)',
                                color: total > 0 ? '#63b3ed' : 'var(--fog)',
                                padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                                border: `1px solid ${total > 0 ? 'rgba(99,179,237,0.25)' : 'var(--border)'}`,
                              } as const
                              const label = `📞 ${total} total call${total === 1 ? '' : 's'}`
                              if (total === 0) {
                                return (
                                  <span
                                    title="No calls yet for this hotel."
                                    style={sharedStyle}>
                                    {label}
                                  </span>
                                )
                              }
                              return (
                                <button
                                  onClick={() => setCallsModal({ id: h.id, name: h.name })}
                                  title="Click to see each call with timestamp + driver distance (mirrors the hotelier dashboard view)."
                                  style={{
                                    ...sharedStyle,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                  }}>
                                  {label} →
                                </button>
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
                            {/* The "📍 N arrivals" pill was removed here.
                                Same reason as the dashboard pill: iOS Safari
                                kills background JS in ~30s, so the 90-min
                                arrival tracker rarely completed honestly.
                                Showing arrivals on the admin card was either
                                zero (most hotels) or a misleading "1" from a
                                test run — neither useful. The underlying
                                arrived_at column stays in the DB for the
                                future SMS-confirmation flow. */}
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
                            {/* Hide/Unhide toggle. Separate from the
                                Verify button because "verified=true" and
                                "hidden=false" are now independent: a hotel
                                can be verified but still hidden (admin
                                hid it manually) or unverified but visible
                                (testing mode). Showing this button always
                                so admin has explicit control over driver
                                visibility regardless of verification path. */}
                            <button
                              onClick={() => toggleHidden(h.id, h.hidden || false)}
                              style={{
                                ...btnGhost,
                                color: h.hidden ? '#22c55e' : '#94a3b8',
                                border: `1px solid ${h.hidden ? 'rgba(34,197,94,0.40)' : 'var(--border)'}`,
                                background: h.hidden ? 'rgba(34,197,94,0.10)' : 'transparent',
                              }}
                              title={h.hidden
                                ? 'Currently hidden from drivers. Click to restore.'
                                : 'Currently visible to drivers. Click to hide.'}
                            >
                              {h.hidden ? '👁 Unhide' : '🚫 Hide'}
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

        {tab === 'hidden' && (() => {
          // Every hidden listing across BOTH categories (hotels + RV parks),
          // not just the active adminCategory — this is the single triage
          // queue the whole "179 hidden" number refers to. Already geo-sorted
          // upstream in loadAll, so we keep that order here.
          const q = hiddenSearch.trim().toLowerCase()
          const allHidden = hotels.filter(h => h.hidden === true)
          const shown = q === '' ? allHidden : allHidden.filter(h => {
            const hay = [
              h.name, h.city, h.state, h.address, h.street_address, h.zip, h.phone,
              h.exits?.city, h.exits?.state, h.exits?.interstates?.name,
            ].filter(Boolean).join(' ').toLowerCase()
            return hay.includes(q)
          })
          return (
            <div style={{ ...cardStyle, padding: '20px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
                <div>
                  <h2 style={{ fontSize: '16px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '4px' }}>
                    🚫 Hidden listings
                  </h2>
                  <p style={{ fontSize: '12px', color: 'var(--fog)', margin: 0 }}>
                    {allHidden.length} listing{allHidden.length === 1 ? '' : 's'} hidden from driver search.
                    Reinstate any of them — nothing here is deleted.
                  </p>
                </div>
                {/* Verify-and-hide sweep: pulls every still-unverified visible
                    listing into this queue in one pass. */}
                <button
                  onClick={verifyAndHide}
                  style={{
                    padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                    background: 'rgba(239,68,68,0.10)', color: '#ef4444',
                    border: '1px solid rgba(239,68,68,0.40)', borderRadius: '8px',
                    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }}
                  title="Hide every listing that is not phone/front-desk verified. They land in this Hidden queue and drop out of driver search until reinstated."
                >
                  ↓ Sweep unverified into Hidden
                </button>
              </div>

              {allHidden.length > 5 && (
                <input
                  className="dark-input"
                  value={hiddenSearch}
                  onChange={e => setHiddenSearch(e.target.value)}
                  placeholder="Filter hidden listings by name, city, phone, interstate…"
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: '13px',
                    background: 'var(--night)', color: 'var(--white)',
                    border: '1px solid var(--border)', borderRadius: '8px',
                    outline: 'none', fontFamily: 'inherit', marginBottom: '12px',
                  }}
                />
              )}

              {shown.length === 0 ? (
                <div style={{ padding: '28px 8px', textAlign: 'center', color: 'var(--fog)', fontSize: '13px' }}>
                  {allHidden.length === 0
                    ? 'No hidden listings. Everything is visible to drivers.'
                    : 'No hidden listings match that filter.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {shown.map(h => {
                    const loc = [
                      h.exits?.interstates?.name,
                      h.exits?.mile_marker != null ? `MM ${h.exits.mile_marker}` : null,
                      h.exits?.city || h.city,
                      h.exits?.state || h.state,
                    ].filter(Boolean).join(' · ')
                    const closed = h.google_business_status === 'CLOSED_PERMANENTLY'
                    return (
                      <div key={h.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '12px', padding: '12px 14px', background: 'var(--night)',
                        border: '1px solid var(--border)', borderRadius: '10px', flexWrap: 'wrap',
                      }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--white)' }}>
                              {h.name || '(unnamed)'}
                            </span>
                            {(h.type || 'hotel') === 'rv_park' && (
                              <span style={{ fontSize: '10px', color: 'var(--fog)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1px 6px' }}>RV</span>
                            )}
                            {closed && (
                              <span style={{
                                fontSize: '10px', background: 'rgba(239,68,68,0.10)', color: '#ef4444',
                                padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                                border: '1px solid rgba(239,68,68,0.30)',
                              }} title="Google Places reported CLOSED_PERMANENTLY.">⛔ Closed (Google)</span>
                            )}
                            {h.verified !== true && (
                              <span style={{
                                fontSize: '10px', background: 'rgba(245,158,11,0.10)', color: 'var(--amber)',
                                padding: '2px 7px', borderRadius: '10px', fontWeight: 600,
                                border: '1px solid rgba(245,158,11,0.30)',
                              }} title="Not phone/front-desk verified.">⚠ Unverified</span>
                            )}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--fog)', marginTop: '3px' }}>
                            {loc || 'No exit linked'}{h.phone ? ` · ${h.phone}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => reinstate(h.id)}
                          style={{
                            padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                            background: 'rgba(34,197,94,0.10)', color: '#22c55e',
                            border: '1px solid rgba(34,197,94,0.40)', borderRadius: '8px',
                            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                          }}
                          title="Set hidden=false — restore this listing to driver search."
                        >
                          ✓ Reinstate
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

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

        {tab === 'campaigns' && (
          <div>
            <h2 style={{ fontSize: '16px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '4px' }}>
              📣 Campaign Attribution
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--fog)', marginBottom: '16px', lineHeight: 1.5 }}>
              Tag any link, QR code, or billboard with a source and it shows up here as visits → calls,
              so you can compare channels on cost-per-call. Use{' '}
              <code style={{ color: 'var(--amber)' }}>roadsleep.com/?src=YOURTAG</code> or the short form{' '}
              <code style={{ color: 'var(--amber)' }}>roadsleep.com/YOURTAG</code> — e.g.{' '}
              <code style={{ color: 'var(--amber)' }}>roadsleep.com/i75</code> on an I-75 billboard,{' '}
              <code style={{ color: 'var(--amber)' }}>roadsleep.com/pilot</code> on a fuel-desk card.
            </p>

            {campaignLoading ? (
              <p style={{ color: 'var(--fog)', fontSize: '13px' }}>Loading…</p>
            ) : campaignRows.length === 0 ? (
              <p style={{ color: 'var(--fog)', fontSize: '13px' }}>
                No traffic logged yet. Once a tagged link or QR is in the wild, visits and calls land here.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fog)' }}>
                      <th style={{ padding: '8px 12px' }}>Source</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Visits</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Calls</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Call rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRows.map(r => {
                      const rate = r.visits > 0 ? Math.round((r.calls / r.visits) * 100) : null
                      const untagged = r.source === '(untagged)'
                      return (
                        <tr key={r.source} style={{ borderBottom: '1px solid var(--border)', color: untagged ? 'var(--fog)' : 'var(--white)' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.source}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{r.visits || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{r.calls}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--amber)' }}>
                            {rate === null ? '—' : `${rate}%`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p style={{ fontSize: '11px', color: 'var(--fog)', marginTop: '10px', lineHeight: 1.5 }}>
                  Visits = unique tagged landings per session. Calls = Call-button taps during a session
                  that arrived with that tag. <strong style={{ color: 'var(--fog)' }}>(untagged)</strong> = calls
                  with no source — direct traffic, organic, or logged before tracking went live (no visit row,
                  so no rate).
                </p>
              </div>
            )}
          </div>
        )}
      </div>


      {/* Per-hotel call timeline modal. Opens when admin clicks a hotel's
          📞 N total calls pill. Renders the same data the hotelier sees on
          their own dashboard: every call to this hotel, newest first, with
          timestamp + ★ boost flag (when from_boost=true) + "Driver called
          from I-X · N mi away" line built from initial_distance_mi captured
          at tap.

          Honest reuse: the rows come from recentCallsByHotel which was
          populated once during loadAll from the SAME cl array the stats
          loops use. No extra Supabase query, no separate fetch on open —
          the data is already in memory, the click just changes which slice
          we show. Modal closes on backdrop click or × button.

          What's NOT here: arrival proof, closest-approach distance, or any
          "did the driver actually visit" data. Those columns still exist on
          call_logs but rarely populated honestly (iOS Safari kills the
          90-min tracker in ~30s). SMS-confirmation flow is the future
          replacement — see TODO.md. */}
      {callsModal && (() => {
        const rows = recentCallsByHotel[callsModal.id] || []
        return (
          <div
            onClick={() => setCallsModal(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px',
            }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--night2)',
                border: '1px solid var(--border)',
                borderRadius: '14px',
                maxWidth: '520px', width: '100%',
                maxHeight: '80vh',
                overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
              }}>
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px',
              }}>
                <div>
                  <div style={{
                    fontFamily: 'Syne, sans-serif',
                    fontSize: '18px', fontWeight: 700, color: 'var(--white)',
                    marginBottom: '4px',
                  }}>
                    {callsModal.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--fog)' }}>
                    {rows.length} call{rows.length === 1 ? '' : 's'} on record · newest first
                  </div>
                </div>
                <button
                  onClick={() => setCallsModal(null)}
                  aria-label="Close"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--fog)',
                    cursor: 'pointer',
                    fontSize: '22px', lineHeight: 1,
                    padding: '4px 8px',
                  }}>×</button>
              </div>
              <div style={{ padding: '12px 20px 20px', overflowY: 'auto' }}>
                {rows.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--fog)', fontSize: '13px' }}>
                    No calls logged for this hotel.
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {rows.map((c, i) => {
                      const d = new Date(c.called_at)
                      const now = new Date()
                      const isToday = d.toDateString() === now.toDateString()
                      const yesterday = new Date(now)
                      yesterday.setDate(now.getDate() - 1)
                      const isYesterday = d.toDateString() === yesterday.toDateString()
                      const dayLabel = isToday
                        ? 'Today'
                        : isYesterday
                          ? 'Yesterday'
                          : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                      const timeLabel = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                      const interstate = hotelInterstate[callsModal.id]
                      const dist = c.initial_distance_mi
                      const hasOrigin = interstate || dist != null
                      return (
                        <li key={i} style={{
                          display: 'flex', flexDirection: 'column', gap: '2px',
                          fontSize: '13px', color: 'var(--white)',
                          padding: '10px 0',
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
            </div>
          </div>
        )
      })()}
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
