
'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface Hotel {
  id: string;
  name: string;
  phone: string;
  address: string;
  price_min: number;
  price_max: number;
  amenities: string[];
  availability_badge: string;
  featured: boolean;
  est_revenue_per_call: number;
  description: string;
  exit_id: string;
  exits?: {
    exit_label: string;
    mile_marker: number;
    city: string;
    state: string;
    lat: number;
    lng: number;
    interstates?: { name: string };
  };
  distance?: number;
  score?: number;
}

const DISTANCE_OPTIONS = [
  { label: '10 mi', value: 10 },
  { label: '30 mi', value: 30 },
  { label: '60 mi', value: 60 },
  { label: 'Closest', value: 1 },
];

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBestCall(hotels: Hotel[]): { top: Hotel; alts: Hotel[]; reason: string } | null {
  if (!hotels.length) return null;
  const scored = hotels.map(h => {
    let score = 0;
    if (h.distance !== undefined) score += Math.max(0, 60 - h.distance) * 1.5;
    if (h.price_min) score += Math.max(0, 150 - h.price_min) * 0.5;
    const roomTypes = h.amenities?.length || 0;
    score += roomTypes * 3;
    if (h.availability_badge === 'available') score += 20;
    if (h.availability_badge === 'limited') score += 8;
    if (h.featured) score += 10;
    return { ...h, score };
  }).sort((a, b) => (b.score || 0) - (a.score || 0));

  const top = scored[0];
  const alts = scored.slice(1, 3);
  const reasons = [];
  if (top.distance !== undefined && top.distance < 5) reasons.push(`only ${top.distance.toFixed(1)} mi away`);
  if (top.price_min && top.price_min < 80) reasons.push(`rates from $${top.price_min}`);
  if (top.amenities && top.amenities.length > 3) reasons.push(`${top.amenities.length} room types available`);
  if (top.availability_badge === 'available') reasons.push('rooms available now');
  const reason = reasons.length ? reasons.join(', ') : 'best match for your route';
  return { top, alts, reason };
}

export default function SearchPage() {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [filtered, setFiltered] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(false);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<'pending' | 'granted' | 'denied' | 'loading'>('pending');
  const [distance, setDistance] = useState(30);
  const [maxPrice, setMaxPrice] = useState(200);
  const [bestCall, setBestCall] = useState<ReturnType<typeof getBestCall>>(null);
  const [callCount, setCallCount] = useState(0);
  const [todayCalls, setTodayCalls] = useState(0);
  const [estValue, setEstValue] = useState(0);
  const [avgRate, setAvgRate] = useState(0);
  const [recentCalls, setRecentCalls] = useState<{hotel: string; time: string}[]>([]);

  useEffect(() => {
    loadActivityStats();
    getLocation();
  }, []);

  async function loadActivityStats() {
    const today = new Date().toISOString().split('T')[0];
    const { data: calls } = await supabase
      .from('call_logs')
      .select('called_at, hotels(name, est_revenue_per_call)')
      .gte('called_at', today + 'T00:00:00')
      .order('called_at', { ascending: false })
      .limit(20);

    if (calls && calls.length) {
      setTodayCalls(calls.length);
      const total = calls.reduce((sum: number, c: any) => sum + (c.hotels?.est_revenue_per_call || 85), 0);
      setEstValue(total);
      setAvgRate(Math.round(total / calls.length));
      setRecentCalls(calls.slice(0, 5).map((c: any) => ({
        hotel: c.hotels?.name || 'Hotel',
        time: new Date(c.called_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      })));
    }
    const { count } = await supabase.from('call_logs').select('*', { count: 'exact', head: true });
    setCallCount(count || 0);
  }

  function getLocation() {
    setLocationStatus('loading');
    if (!navigator.geolocation) {
      setLocationStatus('denied');
      loadAllHotels();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setUserLat(pos.coords.latitude);
        setUserLng(pos.coords.longitude);
        setLocationStatus('granted');
      },
      () => {
        setLocationStatus('denied');
        loadAllHotels();
      },
      { timeout: 8000 }
    );
  }

  async function loadAllHotels() {
    setLoading(true);
    const { data } = await supabase
      .from('hotels')
      .select('*, exits(exit_label, mile_marker, city, state, lat, lng, interstates(name))')
      .order('featured', { ascending: false });
    setHotels(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (userLat && userLng) {
      loadHotelsWithDistance();
    }
  }, [userLat, userLng]);

  async function loadHotelsWithDistance() {
    setLoading(true);
    const { data } = await supabase
      .from('hotels')
      .select('*, exits(exit_label, mile_marker, city, state, lat, lng, interstates(name))')
      .order('featured', { ascending: false });

    if (data) {
      const withDist = data.map(h => ({
        ...h,
        distance: h.exits?.lat && h.exits?.lng && userLat && userLng
          ? haversine(userLat, userLng, h.exits.lat, h.exits.lng)
          : undefined
      })).sort((a, b) => (a.distance || 999) - (b.distance || 999));
      setHotels(withDist);
    }
    setLoading(false);
  }

  useEffect(() => {
    let result = [...hotels];
    if (distance === 1) {
      // "Closest" - show nearest 5
      result = result.filter(h => h.distance !== undefined).slice(0, 5);
      if (!result.length) result = hotels.slice(0, 5);
    } else if (userLat && userLng) {
      result = result.filter(h => h.distance === undefined || h.distance <= distance);
    }
    result = result.filter(h => !h.price_min || h.price_min <= maxPrice);
    setFiltered(result);
    setBestCall(getBestCall(result));
  }, [hotels, distance, maxPrice, userLat, userLng]);

  async function logCall(hotelId: string) {
    await supabase.from('call_logs').insert({ hotel_id: hotelId, user_agent: navigator.userAgent });
    loadActivityStats();
  }

  const badgeColor = (b: string) => b === 'available' ? '#22c55e' : b === 'limited' ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ minHeight: '100vh', background: '#0d0f14', color: '#e8e0d0', fontFamily: "'Syne', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #1a1d26; } ::-webkit-scrollbar-thumb { background: #f59e0b44; border-radius: 2px; }
        .btn-amber { background: #f59e0b; color: #000; border: none; border-radius: 6px; font-family: 'Syne', sans-serif; font-weight: 600; cursor: pointer; transition: background .15s; }
        .btn-amber:hover { background: #fbbf24; }
        .card { background: #1a1d26; border: 1px solid #2a2d3a; border-radius: 12px; }
        .card:hover { border-color: #f59e0b44; }
        .filter-btn { background: #1a1d26; border: 1px solid #2a2d3a; color: #9ca3af; border-radius: 6px; padding: 6px 14px; font-family: 'Syne', sans-serif; font-size: 13px; cursor: pointer; transition: all .15s; }
        .filter-btn.active { background: #f59e0b22; border-color: #f59e0b; color: #f59e0b; font-weight: 600; }
        .badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: .05em; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #2a2d3a', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' }}>
          Road<span style={{ color: '#f59e0b' }}>Sleep</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/hotelier" style={{ color: '#9ca3af', fontSize: 13, textDecoration: 'none' }}>Hoteliers</a>
          <a href="/dashboard" style={{ color: '#9ca3af', fontSize: 13, textDecoration: 'none' }}>Dashboard</a>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 60px' }}>

        {/* Money Dashboard */}
        <div style={{ background: '#1a1d26', border: '1px solid #2a2d3a', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#f59e0b', marginBottom: 12 }}>Live Call Activity</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <div style={{ background: '#0d0f14', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b', lineHeight: 1 }}>{todayCalls}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Calls Today</div>
            </div>
            <div style={{ background: '#0d0f14', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#22c55e', lineHeight: 1 }}>${estValue.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Est. Value</div>
            </div>
            <div style={{ background: '#0d0f14', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#e8e0d0', lineHeight: 1 }}>${avgRate || 85}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Avg Room Rate</div>
            </div>
          </div>
          {recentCalls.length > 0 && (
            <div style={{ borderTop: '1px solid #2a2d3a', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>Recent Calls</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recentCalls.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9ca3af' }}>
                    <span>📞 {c.hotel}</span>
                    <span style={{ color: '#6b7280' }}>{c.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Best Call Feature */}
        {bestCall && (
          <div style={{ background: '#1a1d26', border: '1px solid #f59e0b44', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#f59e0b', marginBottom: 12 }}>⭐ Best Place to Call</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{bestCall.top.name}</div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>{bestCall.reason}</div>
              </div>
              <a href={`tel:${bestCall.top.phone}`} onClick={() => logCall(bestCall.top.id)}
                style={{ background: '#f59e0b', color: '#000', padding: '8px 16px', borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
                📞 Call Now
              </a>
            </div>
            {bestCall.alts.length > 0 && (
              <div style={{ borderTop: '1px solid #2a2d3a', paddingTop: 12 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>Alternatives</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {bestCall.alts.map(alt => (
                    <div key={alt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{alt.name}</span>
                        {alt.distance !== undefined && <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{alt.distance.toFixed(1)} mi</span>}
                      </div>
                      <a href={`tel:${alt.phone}`} onClick={() => logCall(alt.id)}
                        style={{ fontSize: 12, color: '#f59e0b', textDecoration: 'none', fontWeight: 600 }}>Call</a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Hero */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1.1, marginBottom: 8 }}>
            Hotels at your<br /><span style={{ color: '#f59e0b' }}>next exit</span>
          </h1>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            {locationStatus === 'loading' ? 'Getting your location...' :
             locationStatus === 'granted' ? `Showing hotels near you` :
             'Hotels along major interstates'}
          </p>
        </div>

        {/* Filters */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b7280', marginBottom: 8 }}>Distance</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {DISTANCE_OPTIONS.map(opt => (
              <button key={opt.value} className={`filter-btn${distance === opt.value ? ' active' : ''}`}
                onClick={() => setDistance(opt.value)}>{opt.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b7280', marginBottom: 8 }}>
            Max price: <span style={{ color: '#f59e0b' }}>${maxPrice}</span>
          </div>
          <input type="range" min={50} max={300} step={10} value={maxPrice} onChange={e => setMaxPrice(+e.target.value)}
            style={{ width: '100%', accentColor: '#f59e0b' }} />
        </div>

        {/* Results */}
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
          {loading ? 'Loading...' : `${filtered.length} hotel${filtered.length !== 1 ? 's' : ''} found`}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#6b7280' }}>Finding hotels...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#6b7280' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🛣️</div>
            <div>No hotels found in this range. Try expanding your distance filter.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(hotel => (
              <div key={hotel.id} className="card" style={{ padding: '16px 18px', transition: 'border-color .15s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      {hotel.featured && <span className="badge" style={{ background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44' }}>Featured</span>}
                      <span className="badge" style={{ background: badgeColor(hotel.availability_badge) + '22', color: badgeColor(hotel.availability_badge) }}>
                        {hotel.availability_badge}
                      </span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{hotel.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {hotel.exits?.interstates?.name && <span>I-{hotel.exits.interstates.name} </span>}
                      Exit {hotel.exits?.exit_label} · {hotel.exits?.city}, {hotel.exits?.state}
                      {hotel.distance !== undefined && <span> · {hotel.distance.toFixed(1)} mi</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#f59e0b' }}>
                      ${hotel.price_min}{hotel.price_max && hotel.price_max !== hotel.price_min ? `–$${hotel.price_max}` : ''}
                    </div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>per night</div>
                  </div>
                </div>
                {hotel.description && (
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10, lineHeight: 1.5 }}>{hotel.description}</div>
                )}
                {hotel.amenities && hotel.amenities.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {hotel.amenities.map((a: string) => (
                      <span key={a} style={{ fontSize: 11, background: '#2a2d3a', color: '#9ca3af', padding: '2px 8px', borderRadius: 4 }}>{a}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href={`tel:${hotel.phone}`} onClick={() => logCall(hotel.id)}
                    className="btn-amber" style={{ flex: 1, padding: '10px 0', textAlign: 'center', textDecoration: 'none', fontSize: 14, borderRadius: 6 }}>
                    📞 Call Front Desk
                  </a>
                  <a href={`/hotel/${hotel.id}`} style={{ padding: '10px 14px', background: '#2a2d3a', color: '#e8e0d0', borderRadius: 6, textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>
                    Details
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pricing */}
        <div style={{ marginTop: 40, borderTop: '1px solid #2a2d3a', paddingTop: 32 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>For Hoteliers</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Get travelers calling your front desk</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>For less than the price of one room, get travelers calling your front desk</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { price: '$49', label: 'Starter', perks: ['1 hotel listing', 'Call tracking', 'Basic analytics'] },
              { price: '$99', label: 'Growth', perks: ['3 hotel listings', 'Call tracking', 'Revenue dashboard', 'Featured placement'], featured: true },
              { price: '$149', label: 'Pro', perks: ['Unlimited listings', 'Call tracking', 'Revenue dashboard', 'Priority placement', 'Admin access'] },
            ].map(tier => (
              <div key={tier.label} style={{ background: tier.featured ? '#f59e0b11' : '#1a1d26', border: `1px solid ${tier.featured ? '#f59e0b' : '#2a2d3a'}`, borderRadius: 10, padding: '16px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: tier.featured ? '#f59e0b' : '#6b7280', marginBottom: 8 }}>{tier.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{tier.price}<span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>/mo</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>
                  {tier.perks.map(p => <div key={p} style={{ fontSize: 12, color: '#9ca3af', display: 'flex', gap: 6 }}><span style={{ color: '#f59e0b' }}>✓</span>{p}</div>)}
                </div>
                <a href="/hotelier" style={{ display: 'block', marginTop: 14, padding: '8px 0', background: tier.featured ? '#f59e0b' : '#2a2d3a', color: tier.featured ? '#000' : '#e8e0d0', borderRadius: 6, textAlign: 'center', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                  Get Started
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
