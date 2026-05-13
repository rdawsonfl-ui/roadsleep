'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type HotelWithStats = {
  id: string
  name: string
  phone: string
  featured: boolean
  est_revenue_per_call: number
  calls_today: number
  calls_this_month: number
  calls_last_month: number
  calls_all_time: number
  // Boost attribution: how many of the calls came in while the hotel
  // was actively boosted (driver tapped Call on a boosted listing).
  // Lets hoteliers see whether their boost spend converted.
  boost_calls_today: number
  boost_calls_this_month: number
  // GPS-verified arrivals — driver tapped Call AND actually drove to
  // within 0.25mi of the hotel. Strongest signal a boost converted.
  arrived_today: number
  arrived_this_month: number
  // The most recent arrival in this hotel's history — surfaced inline on
  // the arrival summary so the hotelier sees the exact date/time without
  // scrolling to find it. Null when there are no arrivals.
  last_arrival_at: string | null
  last_arrival_closest_mi: number | null
  revenue_today: number
  revenue_this_month: number
  revenue_last_month: number
  projected_monthly: number
}

export default function HotelierDashboardPage() {
  // Standalone /dashboard route — kept for backwards-compat with bookmarks.
  // The actual UI lives in DashboardView so /hotelier can render the same
  // thing inside its Performance tab without duplicating 300 lines of code.
  return <DashboardView />
}

export function DashboardView() {
  const [hotels, setHotels] = useState<HotelWithStats[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [dailyData, setDailyData] = useState<{ date: string; calls: number; revenue: number }[]>([])

  useEffect(() => { loadAll() }, [])
  useEffect(() => { if (selectedId) loadDaily(selectedId) }, [selectedId])

  async function loadAll() {
    setLoading(true)
    // Scope to the current hotelier's hotels only. Without this, the dashboard
    // would show every hotel + every call across the entire app — useful for
    // admin testing but wrong for a hotelier looking at their own performance.
    // Use the auth session to find the hotelier row, then filter hotels by
    // hotelier_id. If no session (admin viewing /dashboard without login),
    // fall back to showing all hotels (legacy behavior).
    const { data: { session } } = await supabase.auth.getSession()
    let hotelierId: string | null = null
    if (session?.user) {
      const { data: ho } = await supabase
        .from('hoteliers')
        .select('id')
        .eq('auth_user_id', session.user.id)
        .maybeSingle()
      hotelierId = ho?.id ?? null
    }

    const hotelsQuery = supabase.from('hotels').select('id, name, phone, featured, est_revenue_per_call')
    const { data: hotelsData } = hotelierId
      ? await hotelsQuery.eq('hotelier_id', hotelierId)
      : await hotelsQuery
    if (!hotelsData) { setLoading(false); return }
    const hotelIds = hotelsData.map(h => h.id)

    // Include from_boost + arrival tracking columns so the dashboard can
    // attribute calls to boosts AND show GPS-verified arrivals (the
    // hotelier-grade proof that the boost actually delivered a customer).
    // Filter to only this hotelier's hotels — same join-via-hotel_id approach
    // as the My Listings tab, since call_logs.hotelier_id is unreliable.
    const callsQuery = supabase
      .from('call_logs')
      .select('hotel_id, called_at, from_boost, arrived_at, closest_approach_mi, initial_distance_mi')
    const { data: calls } = hotelIds.length > 0
      ? await callsQuery.in('hotel_id', hotelIds)
      : (hotelierId ? { data: [] } : await callsQuery)
    const callList = calls || []

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    const dayOfMonth = now.getDate()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

    const stats = hotelsData.map(h => {
      const rate = h.est_revenue_per_call || 85
      const hCalls = callList.filter(c => c.hotel_id === h.id)
      const today = hCalls.filter(c => new Date(c.called_at) >= todayStart).length
      const thisMonth = hCalls.filter(c => new Date(c.called_at) >= monthStart).length
      const lastMonth = hCalls.filter(c => {
        const d = new Date(c.called_at)
        return d >= lastMonthStart && d <= lastMonthEnd
      }).length
      const all = hCalls.length
      // Boost-attributed subsets — same windows but filtered to calls
      // where the driver came in via a boost. from_boost is nullable;
      // treat null/false as organic.
      const boostToday = hCalls.filter(c => c.from_boost === true && new Date(c.called_at) >= todayStart).length
      const boostThisMonth = hCalls.filter(c => c.from_boost === true && new Date(c.called_at) >= monthStart).length
      // GPS-verified arrivals — driver tapped Call AND actually drove to
      // within 0.25mi of the hotel. Strongest signal of booking conversion.
      const arrivedToday = hCalls.filter(c => c.arrived_at && new Date(c.called_at) >= todayStart).length
      const arrivedThisMonth = hCalls.filter(c => c.arrived_at && new Date(c.called_at) >= monthStart).length
      // Most recent arrival — first row whose arrived_at is set, after sorting
      // by called_at desc. The arrival summary surfaces this so a hotelier
      // sees "1 this month — last on May 12 at 6:28 PM" inline.
      const arrivalRows = hCalls
        .filter(c => c.arrived_at)
        .sort((a, b) => new Date(b.arrived_at!).getTime() - new Date(a.arrived_at!).getTime())
      const lastArrival = arrivalRows[0]
      const projected = dayOfMonth > 0 ? Math.round((thisMonth / dayOfMonth) * daysInMonth) : 0
      return {
        ...h,
        calls_today: today, calls_this_month: thisMonth,
        calls_last_month: lastMonth, calls_all_time: all,
        boost_calls_today: boostToday,
        boost_calls_this_month: boostThisMonth,
        arrived_today: arrivedToday,
        arrived_this_month: arrivedThisMonth,
        last_arrival_at: lastArrival?.arrived_at ?? null,
        last_arrival_closest_mi: lastArrival?.closest_approach_mi != null
          ? Number(lastArrival.closest_approach_mi)
          : null,
        revenue_today: today * rate,
        revenue_this_month: thisMonth * rate,
        revenue_last_month: lastMonth * rate,
        projected_monthly: projected * rate,
      }
    }).sort((a, b) => b.revenue_this_month - a.revenue_this_month)

    setHotels(stats)
    if (stats.length > 0 && !selectedId) setSelectedId(stats[0].id)
    setLoading(false)
  }

  async function loadDaily(hotelId: string) {
    const hotel = hotels.find(h => h.id === hotelId)
    const rate = hotel?.est_revenue_per_call || 85
    const { data } = await supabase.from('call_logs').select('called_at').eq('hotel_id', hotelId)
    const calls = data || []

    // Build last 30 days
    const days: Record<string, number> = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      days[key] = 0
    }
    calls.forEach(c => {
      const key = new Date(c.called_at).toISOString().slice(0, 10)
      if (key in days) days[key] += 1
    })
    setDailyData(Object.entries(days).map(([date, count]) => ({
      date, calls: count, revenue: count * rate
    })))
  }

  const selected = hotels.find(h => h.id === selectedId)
  const totalToday = hotels.reduce((s, h) => s + h.revenue_today, 0)
  const totalMonth = hotels.reduce((s, h) => s + h.revenue_this_month, 0)
  const totalLastMonth = hotels.reduce((s, h) => s + h.revenue_last_month, 0)
  const totalProjected = hotels.reduce((s, h) => s + h.projected_monthly, 0)
  const monthOverMonth = totalLastMonth > 0 ? ((totalMonth - totalLastMonth) / totalLastMonth) * 100 : 0

  const maxDaily = Math.max(...dailyData.map(d => d.revenue), 1)

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', padding: '24px 20px 48px' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontFamily: 'Syne, sans-serif', marginBottom: '4px', color: 'var(--white)' }}>
          Hotelier <span style={{ color: 'var(--amber)' }}>Dashboard</span>
        </h1>
        <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '24px' }}>
          Call tracking · Revenue · Projections
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--fog)', padding: '60px 0' }}>
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>📊</div>
            Loading revenue data...
          </div>
        ) : (
          <>
            {/* Summary Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '24px' }}>
              <StatCard label="Revenue Today" value={`$${totalToday.toLocaleString()}`} accent="amber"/>
              <StatCard label="This Month" value={`$${totalMonth.toLocaleString()}`} accent="white"
                sub={monthOverMonth !== 0 ? `${monthOverMonth > 0 ? '↑' : '↓'} ${Math.abs(monthOverMonth).toFixed(0)}% vs last month` : ''}
                subColor={monthOverMonth >= 0 ? 'green' : 'red'}/>
              <StatCard label="Projected Month" value={`$${totalProjected.toLocaleString()}`} accent="blue"/>
              <StatCard label="Last Month" value={`$${totalLastMonth.toLocaleString()}`} accent="white"/>
            </div>

            {/* Hotel picker */}
            <div style={{ background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '14px', padding: '16px 18px', marginBottom: '20px' }}>
              <label className="dark-label">Select hotel</label>
              <select className="dark-input" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                {hotels.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.featured ? '★ ' : ''}{h.name} — ${h.revenue_this_month.toLocaleString()} this month
                  </option>
                ))}
              </select>
            </div>

            {selected && (
              <>
                {/* Per-hotel summary */}
                <div style={{ background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                    <div>
                      <h2 style={{ fontSize: '18px', fontFamily: 'Syne, sans-serif', color: 'var(--white)' }}>
                        {selected.featured && <span style={{ color: 'var(--amber)', fontSize: '14px' }}>★ </span>}
                        {selected.name}
                      </h2>
                      <p style={{ fontSize: '12px', color: 'var(--fog)' }}>
                        {selected.phone} · ${selected.est_revenue_per_call}/call estimated
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                    <MiniStat label="Today" value={`${selected.calls_today}`} revenue={selected.revenue_today}/>
                    <MiniStat label="This Month" value={`${selected.calls_this_month}`} revenue={selected.revenue_this_month}/>
                    <MiniStat label="Last Month" value={`${selected.calls_last_month}`} revenue={selected.revenue_last_month}/>
                    <MiniStat label="Projected" value={`${selected.calls_this_month > 0 ? Math.round(selected.projected_monthly / selected.est_revenue_per_call) : 0}`} revenue={selected.projected_monthly} projection/>
                    <MiniStat label="All Time" value={`${selected.calls_all_time}`} revenue={selected.calls_all_time * selected.est_revenue_per_call}/>
                  </div>
                  {/* Boost attribution. Only render when this hotel has any
                      boost-attributed calls so far — keeps the dashboard
                      clean for hotels that have never boosted. The point of
                      this row is to tell the hotelier "X of your Y calls
                      today came in via a boost" — concrete ROI signal.
                      Plus GPS-verified arrivals when we have them, which is
                      the strongest proof the boost actually drove revenue. */}
                  {(selected.boost_calls_today > 0 || selected.boost_calls_this_month > 0) && (
                    <div style={{
                      marginTop: '12px',
                      padding: '10px 14px',
                      background: 'rgba(245,166,35,0.08)',
                      border: '1px solid rgba(245,166,35,0.25)',
                      borderRadius: '10px',
                      fontSize: '13px',
                      color: 'var(--white)',
                    }}>
                      <div>
                        <span style={{ color: 'var(--amber)', fontWeight: 700 }}>★ Boost attribution:</span>
                        {' '}
                        <span>{selected.boost_calls_today} call{selected.boost_calls_today === 1 ? '' : 's'} today</span>
                        {' · '}
                        <span>{selected.boost_calls_this_month} this month</span>
                      </div>
                      {(selected.arrived_today > 0 || selected.arrived_this_month > 0) && (
                        <div style={{ marginTop: '6px' }}>
                          <span style={{ color: '#22c55e', fontWeight: 700 }}>📍 Arrivals (GPS-verified):</span>
                          {' '}
                          <span>{selected.arrived_today} today · {selected.arrived_this_month} this month</span>
                          <div style={{ color: 'var(--fog)', marginTop: '2px', fontSize: '12px' }}>
                            (driver drove within 0.25mi of your front door)
                          </div>
                          {selected.last_arrival_at && (() => {
                            // Inline 'last arrival' line so the hotelier sees the
                            // exact moment of the most recent GPS arrival without
                            // having to drill into the admin timeline modal. Shows
                            // closest-approach distance when available — useful
                            // proof when the hotelier wants to verify "yes, that
                            // car at 7:14pm was the RoadSleep driver."
                            const d = new Date(selected.last_arrival_at)
                            const dateLabel = d.toLocaleDateString([], {
                              month: 'short', day: 'numeric', year: 'numeric',
                            })
                            const timeLabel = d.toLocaleTimeString([], {
                              hour: 'numeric', minute: '2-digit',
                            })
                            return (
                              <div style={{
                                color: '#22c55e',
                                marginTop: '4px',
                                fontSize: '12px',
                                fontWeight: 600,
                              }}>
                                Last arrival: {dateLabel} at {timeLabel}
                                {selected.last_arrival_closest_mi != null && (
                                  <span style={{ color: 'var(--fog)', fontWeight: 400, marginLeft: '6px' }}>
                                    ({selected.last_arrival_closest_mi.toFixed(2)} mi closest)
                                  </span>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      )}
                      <div style={{ color: 'var(--fog)', marginTop: '4px', fontSize: '12px' }}>
                        Boost calls log when a driver taps Call on a boosted listing.
                        Arrivals log when GPS confirms they actually drove here.
                      </div>
                    </div>
                  )}
                </div>

                {/* 30-day chart */}
                <div style={{ background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '14px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '14px' }}>
                    📈 Last 30 days · calls per day
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '120px', paddingTop: '10px' }}>
                    {dailyData.map((d, i) => {
                      const hPct = d.revenue === 0 ? 2 : (d.revenue / maxDaily) * 100
                      const date = new Date(d.date)
                      const weekend = date.getDay() === 0 || date.getDay() === 6
                      return (
                        <div key={d.date} title={`${d.date}: ${d.calls} calls · $${d.revenue}`}
                          style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: '3px' }}>
                          <div style={{
                            width: '100%',
                            height: `${hPct}%`,
                            background: d.revenue === 0 ? 'var(--night3)' : (weekend ? 'var(--amber)' : 'var(--blue)'),
                            borderRadius: '3px 3px 0 0',
                            minHeight: '2px',
                          }} />
                          {(i === 0 || i === 14 || i === 29) && (
                            <div style={{ fontSize: '9px', color: 'var(--fog)', fontFamily: 'DM Mono, monospace' }}>
                              {date.getMonth() + 1}/{date.getDate()}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '14px', marginTop: '10px', fontSize: '10px', color: 'var(--fog)' }}>
                    <span><span style={{ display: 'inline-block', width: '8px', height: '8px', background: 'var(--blue)', marginRight: '4px', borderRadius: '2px' }}/>Weekday</span>
                    <span><span style={{ display: 'inline-block', width: '8px', height: '8px', background: 'var(--amber)', marginRight: '4px', borderRadius: '2px' }}/>Weekend</span>
                  </div>
                </div>
              </>
            )}

            {/* All hotels table */}
            <div style={{ background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '14px', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: '14px', fontFamily: 'Syne, sans-serif', color: 'var(--white)' }}>
                  All Hotels — Ranked by Monthly Revenue
                </h3>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: 'var(--night3)', fontSize: '10px', color: 'var(--fog)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500 }}>Hotel</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }}>Today</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }}>This Month</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }}>Last Month</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }}>Projected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hotels.map(h => (
                      <tr key={h.id} onClick={() => setSelectedId(h.id)}
                        style={{
                          borderTop: '1px solid var(--border)', cursor: 'pointer',
                          background: selectedId === h.id ? 'rgba(245,166,35,0.05)' : 'transparent',
                        }}>
                        <td style={{ padding: '12px 14px', color: 'var(--white)' }}>
                          {h.featured && <span style={{ color: 'var(--amber)' }}>★ </span>}
                          {h.name}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--mist)' }}>
                          ${h.revenue_today.toLocaleString()} <span style={{ color: 'var(--fog)', fontSize: '11px' }}>({h.calls_today})</span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--amber)', fontWeight: 600 }}>
                          ${h.revenue_this_month.toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--mist)' }}>
                          ${h.revenue_last_month.toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--blue)' }}>
                          ${h.projected_monthly.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function StatCard({ label, value, accent, sub, subColor }: { label: string; value: string; accent: 'amber'|'white'|'blue'; sub?: string; subColor?: 'green'|'red' }) {
  const color = accent === 'amber' ? 'var(--amber)' : accent === 'blue' ? 'var(--blue)' : 'var(--white)'
  const subC = subColor === 'green' ? 'var(--green)' : subColor === 'red' ? 'var(--red)' : 'var(--fog)'
  return (
    <div style={{ background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px 18px' }}>
      <div style={{ fontSize: '10px', color: 'var(--fog)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color, letterSpacing: '-0.5px' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: subC, marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

function MiniStat({ label, value, revenue, projection }: { label: string; value: string; revenue: number; projection?: boolean }) {
  return (
    <div style={{ background: 'var(--night3)', borderRadius: '10px', padding: '12px 14px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: '10px', color: 'var(--fog)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: 'var(--white)' }}>{value} <span style={{ fontSize: '10px', color: 'var(--fog)', fontWeight: 400 }}>calls</span></div>
      <div style={{ fontSize: '13px', color: projection ? 'var(--blue)' : 'var(--amber)', fontFamily: 'Syne, sans-serif', fontWeight: 600, marginTop: '2px' }}>
        ${revenue.toLocaleString()}
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'
