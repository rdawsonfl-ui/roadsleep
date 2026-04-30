'use client'
/**
 * Reset-password landing page.
 *
 * Flow:
 *   1. User clicks the "Reset Password" link in their email.
 *   2. Supabase verifies the token and lands them here with an active
 *      "recovery" session attached (cookies are set automatically).
 *   3. They enter a new password; we call supabase.auth.updateUser({ password }).
 *   4. On success, redirect to /hotelier — the auth listener picks them up
 *      as logged in and the dashboard loads.
 *
 * If the page is opened without a recovery session (someone hit the URL
 * directly), we tell them to request a new link.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [hasSession, setHasSession]   = useState<boolean | null>(null)
  const [password, setPassword]       = useState('')
  const [confirmPassword, setConfirm] = useState('')
  const [busy, setBusy]               = useState(false)
  const [err, setErr]                 = useState('')
  const [msg, setMsg]                 = useState('')

  // Verify there's an active recovery session before showing the form.
  useEffect(() => {
    let cancelled = false
    async function check() {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      setHasSession(!!session?.user)
    }
    // The recovery token in the URL hash takes a beat to be processed by the
    // auth client. Listen for the PASSWORD_RECOVERY event as the source of truth.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session?.user) setHasSession(true)
    })
    check()
    return () => { cancelled = true; sub?.subscription.unsubscribe() }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('')
    if (password.length < 6) { setErr('Password must be at least 6 characters'); return }
    if (password !== confirmPassword) { setErr('Passwords do not match'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg('✓ Password updated! Redirecting…')
    setTimeout(() => router.push('/hotelier'), 1200)
  }

  // Render branches: still checking → loading; no session → tell them to retry; ok → form.
  return (
    <main style={{ background:'var(--night)', minHeight:'calc(100vh - 56px)', padding:'40px 20px' }}>
      <div style={{ maxWidth:'440px', margin:'0 auto' }}>
        <div style={{ textAlign:'center', marginBottom:'24px' }}>
          <div style={{ fontSize:'36px', marginBottom:'8px' }}>🔐</div>
          <h1 style={{ fontSize:'26px', fontFamily:'Syne, sans-serif', fontWeight:800, color:'var(--white)' }}>
            Set a New <span style={{ color:'var(--amber)' }}>Password</span>
          </h1>
        </div>

        <div style={{ background:'var(--night2)', border:'1px solid var(--border)', borderRadius:'16px', padding:'24px' }}>
          {hasSession === null && (
            <p style={{ color:'var(--mist)', fontSize:'13px', textAlign:'center' }}>Verifying your reset link…</p>
          )}

          {hasSession === false && (
            <div>
              <p style={{ color:'var(--mist)', fontSize:'13px', marginBottom:'14px', lineHeight:1.5 }}>
                This link looks expired or invalid. Reset links are good for one use only.
              </p>
              <button
                onClick={() => router.push('/hotelier')}
                className="btn-amber"
                style={{ width:'100%', padding:'12px', fontSize:'13px' }}
              >
                Request a new link
              </button>
            </div>
          )}

          {hasSession === true && (
            <form onSubmit={handleSubmit}>
              <p style={{ color:'var(--mist)', fontSize:'12px', marginBottom:'14px', lineHeight:1.5 }}>
                Pick something you&apos;ll remember. Min 6 characters.
              </p>
              <label style={{ fontSize:'11px', color:'var(--fog)', display:'block', marginBottom:'4px' }}>
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width:'100%', background:'var(--night3)', border:'1px solid var(--border)',
                  borderRadius:'8px', padding:'10px 12px', color:'var(--white)',
                  fontSize:'14px', fontFamily:'DM Sans, sans-serif', boxSizing:'border-box',
                  marginBottom:'12px',
                }}
              />
              <label style={{ fontSize:'11px', color:'var(--fog)', display:'block', marginBottom:'4px' }}>
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                style={{
                  width:'100%', background:'var(--night3)', border:'1px solid var(--border)',
                  borderRadius:'8px', padding:'10px 12px', color:'var(--white)',
                  fontSize:'14px', fontFamily:'DM Sans, sans-serif', boxSizing:'border-box',
                  marginBottom:'12px',
                }}
              />
              {err && (
                <div style={{
                  background:'rgba(239,68,68,0.10)', border:'1px solid rgba(239,68,68,0.4)',
                  color:'#ef4444', borderRadius:'8px', padding:'10px 12px', marginBottom:'12px',
                  fontSize:'12px',
                }}>{err}</div>
              )}
              {msg && (
                <div style={{
                  background:'rgba(34,197,94,0.10)', border:'1px solid rgba(34,197,94,0.4)',
                  color:'#22c55e', borderRadius:'8px', padding:'10px 12px', marginBottom:'12px',
                  fontSize:'12px',
                }}>{msg}</div>
              )}
              <button type="submit" disabled={busy} className="btn-amber" style={{ width:'100%', padding:'14px', fontSize:'14px', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'UPDATING…' : 'UPDATE PASSWORD →'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
