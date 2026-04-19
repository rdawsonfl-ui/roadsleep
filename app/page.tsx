'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function HotelierPage() {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [todayCalls, setTodayCalls] = useState(0);
  const [estValue, setEstValue] = useState(0);
  const [avgRate, setAvgRate] = useState(85);
  const [recentCalls, setRecentCalls] = useState<{hotel: string; time: string}[]>([]);

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('call_logs')
      .select('called_at, hotels(name, est_revenue_per_call)')
      .gte('called_at', today + 'T00:00:00')
      .order('called_at', { ascending: false })
      .limit(20);
    if (data && data.length) {
      setTodayCalls(data.length);
      const total = data.reduce((s: number, c: any) => s + (c.hotels?.est_revenue_per_call || 85), 0);
      setEstValue(total);
      setAvgRate(Math.round(total / data.length));
      setRecentCalls(data.slice(0, 5).map((c: any) => ({
        hotel: c.hotels?.name || 'Hotel',
        time: new Date(c.called_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      })));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg('');
    if (tab === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setMsg(error.message); setLoading(false); return; }
      window.location.href = '/dashboard';
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setMsg(error.message); setLoading(false); return; }
      setMsg('Check your email to confirm your account.');
    }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0f14', color: '#e8e0d0', fontFamily: "'Syne', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .card { background: #1a1d26; border: 1px solid #2a2d3a; border-radius: 12px; }
        .inp { width: 100%; background: #0d0f14; border: 1px solid #2a2d3a; border-radius: 8px; padding: 11px 14px; color: #e8e0d0; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; }
        .inp:focus { border-color: #f59e0b; }
        .btn-amber { background: #f59e0b; color: #000; border: none; border-radius: 8px; font-family: 'Syne', sans-serif; font-weight: 700; cursor: pointer; transition: background .15s; }
        .btn-amber:hover { background: #fbbf24; }
        .btn-ghost { background: transparent; color: #6b7280; border: none; font-family: 'Syne', sans-serif; font-weight: 600; cursor: pointer; border-radius: 8px; transition: all .15s; }
        .btn-ghost.active { background: #f59e0b; color: #000; }
      `}</style>

      {/* Nav */}
      <div style={{ borderBottom: '1px solid #2a2d3a', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href="/" style={{ fontSize: 20, fontWeight: 800, textDecoration: 'none', color: '#e8e0d0', letterSpacing: '-0.5px' }}>Road<span style={{ color: '#f59e0b' }}>Sleep</span></a>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="/" style={{ color: '#9ca3af', fontSize: 13, textDecoration: 'none' }}>Find Hotels</a>
          <a href="/dashboard" style={{ color: '#9ca3af', fontSize: 13, textDecoration: 'none' }}>Dashboard</a>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px 60px' }}>

        {/* Live Call Activity */}
        <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#f59e0b', marginBottom: 14 }}>Live Call Activity — Today</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
            <div style={{ background: '#0d0f14', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b', lineHeight: 1 }}>{todayCalls}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Calls Today</div>
            </div>
            <div style={{ background: '#0d0f14', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#22c55e', lineHeight: 1 }}>${estValue.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Est. Value</div>
            </div>
            <div style={{ background: '#0d0f14', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#e8e0d0', lineHeight: 1 }}>${avgRate}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>Avg Room Rate</div>
            </div>
          </div>
          {recentCalls.length > 0 && (
            <div style={{ borderTop: '1px solid #2a2d3a', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>Recent Calls</div>
              {recentCalls.map((c, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#9ca3af', marginBottom: 6 }}>
                  <span>📞 {c.hotel}</span>
                  <span style={{ color: '#6b7280', fontFamily: 'monospace' }}>{c.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pricing */}
        <div className="card" style={{ padding: '20px', marginBottom: 20 }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#f59e0b', marginBottom: 8 }}>For Hoteliers</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Get travelers calling your front desk</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>For less than the price of one room, get travelers calling your front desk</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {[
              { price: '$49', label: 'Starter', perks: ['1 hotel listing', 'Call tracking', 'Basic analytics'] },
              { price: '$99', label: 'Growth', perks: ['3 hotel listings', 'Call tracking', 'Revenue dashboard', 'Featured placement'], featured: true },
              { price: '$149', label: 'Pro', perks: ['Unlimited listings', 'Call tracking', 'Revenue dashboard', 'Priority placement', 'Admin access'] },
            ].map(tier => (
              <div key={tier.label} style={{ background: tier.featured ? '#f59e0b11' : '#0d0f14', border: `1px solid ${tier.featured ? '#f59e0b' : '#2a2d3a'}`, borderRadius: 10, padding: '16px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: tier.featured ? '#f59e0b' : '#6b7280', marginBottom: 8 }}>{tier.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 12 }}>{tier.price}<span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>/mo</span></div>
                {tier.perks.map(p => (
                  <div key={p} style={{ fontSize: 12, color: '#9ca3af', display: 'flex', gap: 6, marginBottom: 4 }}>
                    <span style={{ color: '#f59e0b' }}>✓</span>{p}
                  </div>
                ))}
                <button onClick={() => document.getElementById('login-form')?.scrollIntoView({ behavior: 'smooth' })}
                  className="btn-amber" style={{ width: '100%', marginTop: 14, padding: '8px 0', fontSize: 13, borderRadius: 6 }}>
                  Get Started
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Login / Signup */}
        <div className="card" id="login-form" style={{ padding: '24px', maxWidth: 420, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏨</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Hotelier <span style={{ color: '#f59e0b' }}>Portal</span></h1>
            <p style={{ color: '#6b7280', fontSize: 13 }}>List your property · Track calls · No commissions</p>
          </div>
          <div style={{ display: 'flex', background: '#0d0f14', border: '1px solid #2a2d3a', borderRadius: 8, padding: 4, marginBottom: 20 }}>
            <button className={`btn-ghost${tab === 'login' ? ' active' : ''}`} onClick={() => setTab('login')}
              style={{ flex: 1, padding: '9px 0', fontSize: 13 }}>Log In</button>
            <button className={`btn-ghost${tab === 'signup' ? ' active' : ''}`} onClick={() => setTab('signup')}
              style={{ flex: 1, padding: '9px 0', fontSize: 13 }}>Sign Up</button>
          </div>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6b7280', marginBottom: 6 }}>Email</div>
              <input className="inp" type="email" placeholder="you@yourhotel.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6b7280', marginBottom: 6 }}>Password</div>
              <input className="inp" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {msg && <div style={{ fontSize: 13, color: msg.includes('Check') ? '#22c55e' : '#ef4444', marginBottom: 14, textAlign: 'center' }}>{msg}</div>}
            <button className="btn-amber" type="submit" disabled={loading} style={{ width: '100%', padding: 14, fontSize: 14 }}>
              {loading ? 'Please wait...' : tab === 'login' ? 'LOG IN →' : 'CREATE ACCOUNT →'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: '#6b7280' }}>
            Free basic listing. Drivers call you directly. Zero commissions.
          </p>
        </div>

      </div>
    </div>
  );
}
