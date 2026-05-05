'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import PasswordInput from '@/app/components/PasswordInput'

// Password is stored hashed (bcrypt) in the Supabase `settings` table.
// All access is gated by SECURITY DEFINER functions verify_admin_password
// and change_admin_password — anon callers can invoke them but cannot
// read the underlying table or extract the hash.
//
// The localStorage flag below just remembers that THIS device passed the
// check recently. Clearing it forces a re-prompt.
const STORAGE_KEY = 'rs_admin_ok'

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showChange, setShowChange] = useState(false)
  const [showChangeEmail, setShowChangeEmail] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1') {
      setOk(true)
    }
  }, [])

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const { data, error } = await supabase.rpc('verify_admin_password', { candidate: pw })
      if (error) {
        setErr('Could not verify — try again')
        setTimeout(() => setErr(''), 3000)
      } else if (data === true) {
        localStorage.setItem(STORAGE_KEY, '1')
        setOk(true)
        setPw('')
      } else {
        setErr('Wrong password')
        setTimeout(() => setErr(''), 3000)
      }
    } catch {
      setErr('Network error — try again')
      setTimeout(() => setErr(''), 3000)
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY)
    setOk(false)
  }

  if (!mounted) return null
  if (ok) return (
    <>
      <div style={{ position: 'fixed', top: '72px', right: '20px', zIndex: 40, display: 'flex', gap: '8px' }}>
        <button onClick={() => setShowChange(true)} style={{
          background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--fog)',
          padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
        }}>Change Password</button>
        <button onClick={() => setShowChangeEmail(true)} style={{
          background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--fog)',
          padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
        }}>Change Contact Email</button>
        <button onClick={logout} style={{
          background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--fog)',
          padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
        }}>Logout</button>
      </div>
      {showChange && <ChangePasswordModal onClose={() => setShowChange(false)} />}
      {showChangeEmail && <ChangeContactEmailModal onClose={() => setShowChangeEmail(false)} />}
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
          <PasswordInput
            value={pw}
            onChange={setPw}
            placeholder="••••••••••"
            autoFocus
            variant="dark-input"
          />
          {err && (
            <p style={{ color: 'var(--red)', fontSize: '12px', marginTop: '8px' }}>⚠ {err}</p>
          )}
          <button type="submit" disabled={busy} className="btn-amber" style={{ width: '100%', padding: '12px', marginTop: '16px', fontSize: '14px', letterSpacing: '0.5px', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'CHECKING…' : 'UNLOCK ADMIN →'}
          </button>
        </form>
        <p style={{ fontSize: '11px', color: 'var(--fog)', textAlign: 'center', marginTop: '16px' }}>
          Hotelier? <a href="/dashboard" style={{ color: 'var(--amber)', textDecoration: 'none' }}>Go to hotelier dashboard</a>
        </p>
      </div>
    </main>
  )
}

// Modal: change the admin password. Requires current password as a guard so
// a stolen open session can't silently rotate the credential out from under
// the real admin.
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setErr('')
    if (next !== confirm) { setErr('New passwords do not match'); return }
    if (next.length < 8) { setErr('New password must be at least 8 characters'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('change_admin_password', {
        current_pw: current,
        new_pw: next,
      })
      if (error) {
        setErr('Could not save — try again')
      } else if (data === 'ok') {
        setDone(true)
        setTimeout(onClose, 2000)
      } else if (data === 'wrong_current') {
        setErr('Current password is incorrect')
      } else if (data === 'too_short') {
        setErr('New password must be at least 8 characters')
      } else if (data === 'same_as_old') {
        setErr('New password must be different from current')
      } else {
        setErr('Could not change password')
      }
    } catch {
      setErr('Network error — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '16px',
        padding: '28px', width: '100%', maxWidth: '380px',
      }}>
        <h2 style={{ fontSize: '20px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '16px' }}>
          Change <span style={{ color: 'var(--amber)' }}>Admin Password</span>
        </h2>

        {done ? (
          <p style={{ color: 'var(--green)', fontSize: '14px' }}>✓ Password updated. Other devices stay logged in until they log out.</p>
        ) : (
          <form onSubmit={submit}>
            <label className="dark-label">Current password</label>
            <PasswordInput value={current} onChange={setCurrent} placeholder="current" variant="dark-input" />

            <label className="dark-label" style={{ marginTop: '12px' }}>New password</label>
            <PasswordInput value={next} onChange={setNext} placeholder="at least 8 characters" variant="dark-input" />

            <label className="dark-label" style={{ marginTop: '12px' }}>Confirm new password</label>
            <PasswordInput value={confirm} onChange={setConfirm} placeholder="same again" variant="dark-input" />

            {err && (
              <p style={{ color: 'var(--red)', fontSize: '12px', marginTop: '10px' }}>⚠ {err}</p>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
              <button type="button" onClick={onClose} style={{
                flex: 1, background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--fog)',
                padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
              }}>Cancel</button>
              <button type="submit" disabled={busy} className="btn-amber" style={{ flex: 1, padding: '10px', fontSize: '13px', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// Modal for changing the public contact email shown in the site footer.
// Reuses the admin password as the gate so only the admin can rotate it.
function ChangeContactEmailModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [adminPw, setAdminPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  // Load the current email so the admin can see what they're replacing.
  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'contact_email').single()
      .then(({ data }) => { if (data?.value) setCurrent(data.value) })
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setErr('')
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('change_contact_email', {
        admin_pw: adminPw,
        new_email: newEmail.trim(),
      })
      if (error) {
        setErr('Could not save — try again')
      } else if (data === 'ok') {
        setDone(true)
        setTimeout(onClose, 1500)
      } else if (data === 'wrong_admin_password') {
        setErr('Admin password is incorrect')
      } else if (data === 'invalid_email') {
        setErr('That doesn\'t look like a valid email')
      } else {
        setErr('Could not change email')
      }
    } catch {
      setErr('Network error — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--night2)', border: '1px solid var(--border)', borderRadius: '16px',
        padding: '28px', width: '100%', maxWidth: '380px',
      }}>
        <h2 style={{ fontSize: '20px', fontFamily: 'Syne, sans-serif', color: 'var(--white)', marginBottom: '6px' }}>
          Change <span style={{ color: 'var(--amber)' }}>Contact Email</span>
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--fog)', marginBottom: '16px' }}>
          Shown in the footer on the public homepage.
        </p>

        {done ? (
          <p style={{ color: 'var(--green)', fontSize: '14px' }}>✓ Contact email updated.</p>
        ) : (
          <form onSubmit={submit}>
            <div style={{ fontSize: '12px', color: 'var(--mist)', marginBottom: '14px' }}>
              <div style={{ color: 'var(--fog)', marginBottom: '2px' }}>Currently:</div>
              <div>{current || '—'}</div>
            </div>

            <label className="dark-label">New email</label>
            <input
              type="email"
              className="dark-input"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="contact@example.com"
              autoFocus
            />

            <label className="dark-label" style={{ marginTop: '12px' }}>Admin password (to confirm)</label>
            <PasswordInput value={adminPw} onChange={setAdminPw} placeholder="admin password" variant="dark-input" />

            {err && (
              <p style={{ color: 'var(--red)', fontSize: '12px', marginTop: '10px' }}>⚠ {err}</p>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
              <button type="button" onClick={onClose} style={{
                flex: 1, background: 'var(--night3)', border: '1px solid var(--border)', color: 'var(--fog)',
                padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
              }}>Cancel</button>
              <button type="submit" disabled={busy} className="btn-amber" style={{ flex: 1, padding: '10px', fontSize: '13px', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
