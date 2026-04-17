'use client'
import { useState, useEffect } from 'react'

const ADMIN_PASSWORD = 'roadsleep2026'  // Change this in production
const STORAGE_KEY = 'rs_admin_ok'

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    setMounted(true)
    if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1') {
      setOk(true)
    }
  }, [])

  const login = (e: React.FormEvent) => {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) {
      localStorage.setItem(STORAGE_KEY, '1')
      setOk(true)
    } else {
      setErr('Wrong password')
      setTimeout(() => setErr(''), 2000)
    }
  }

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY)
    setOk(false)
  }

  if (!mounted) return null
  if (ok) return (
    <>
      <button onClick={logout} style={{
        position: 'fixed', top: '72px', right: '20px', zIndex: 40,
        background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--fog)',
        padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
      }}>Logout</button>
      {children}
    </>
  )

  return (
    <main style={{ background: 'var(--night)', minHeight: 'calc(100vh - 56px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{
        background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '16px',
        padding: '32px 28px', width: '100%', maxWidth: '360px',
      }}>
        <h1 style={{ fontSize: '24px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '6px' }}>
          Admin <span style={{ color: 'var(--amber)' }}>Login</span>
        </h1>
        <p style={{ color: 'var(--fog)', fontSize: '13px', marginBottom: '20px' }}>
          Enter the admin password to continue
        </p>
        <form onSubmit={login}>
          <label className="dark-label">Password</label>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            className="dark-input"
            placeholder="••••••••••"
            autoFocus
          />
          {err && (
            <p style={{ color: 'var(--red)', fontSize: '12px', marginTop: '8px' }}>⚠ {err}</p>
          )}
          <button type="submit" className="btn-amber" style={{ width: '100%', padding: '12px', marginTop: '16px', fontSize: '14px', letterSpacing: '0.5px' }}>
            UNLOCK ADMIN →
          </button>
        </form>
        <p style={{ fontSize: '11px', color: 'var(--fog)', textAlign: 'center', marginTop: '16px' }}>
          Hotelier? <a href="/dashboard" style={{ color: 'var(--amber)', textDecoration: 'none' }}>Go to hotelier dashboard</a>
        </p>
      </div>
    </main>
  )
}
