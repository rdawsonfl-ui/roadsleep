'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Site footer. Pulls the contact email from the `settings` table so future
// owners can swap it from /admin without touching code. Also surfaces the
// Privacy + Terms links — required to be discoverable from every page
// for both CCPA (California) and the GDPR if EU users browse.
export default function SiteFooter() {
  const [email, setEmail] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    supabase.from('settings').select('value').eq('key', 'contact_email').single()
      .then(({ data }) => { if (!cancelled && data?.value) setEmail(data.value) })
    return () => { cancelled = true }
  }, [])

  return (
    <footer style={{
      borderTop: '1px solid var(--border)',
      padding: '20px 16px 28px',
      marginTop: '40px',
      textAlign: 'center',
      color: 'var(--fog)',
      fontSize: '12px',
    }}>
      <div style={{ marginBottom: '6px' }}>
        Questions, corrections, or want to list your hotel?
      </div>
      {email && (
        <a href={`mailto:${email}`} style={{ color: 'var(--amber)', textDecoration: 'none' }}>
          {email}
        </a>
      )}
      <div style={{
        marginTop: '14px', display: 'flex', justifyContent: 'center',
        gap: '14px', fontSize: '11px',
      }}>
        <Link href="/privacy" style={{ color: 'var(--fog)', textDecoration: 'none' }}>
          Privacy
        </Link>
        <span style={{ opacity: 0.4 }}>·</span>
        <Link href="/terms" style={{ color: 'var(--fog)', textDecoration: 'none' }}>
          Terms
        </Link>
      </div>
      <div style={{ marginTop: '10px', fontSize: '10px', opacity: 0.6 }}>
        © {new Date().getFullYear()} RoadSleep<sup style={{ fontSize: '0.7em', marginLeft: '1px' }}>™</sup>
      </div>
    </footer>
  )
}
