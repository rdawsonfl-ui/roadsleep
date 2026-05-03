'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Nav() {
  const path = usePathname()
  // Only public-facing tabs in the top nav. The Admin route still exists at
  // /admin (and still requires the password gate to enter), but we don't link
  // to it from the nav so casual visitors and drivers don't see it. The site
  // owner gets there by typing the URL directly.
  const tabs = [
    { href: '/',         label: 'Find a Stop' },
    { href: '/hotelier', label: 'Hotel/Park Owner' },
  ]
  return (
    <nav style={{
      background: 'rgba(13,15,20,0.95)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--border)',
      padding: '0 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '56px',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <Link href="/" style={{
        fontFamily: 'Syne, sans-serif',
        fontWeight: 800,
        fontSize: '22px',
        color: 'var(--white)',
        letterSpacing: '-0.5px',
        textDecoration: 'none',
      }}>
        Road<span style={{ color: 'var(--amber)' }}>Sleep</span>
      </Link>
      <div style={{ display: 'flex', gap: '4px' }}>
        {tabs.map(t => {
          const active = path === t.href || (t.href !== '/' && path.startsWith(t.href))
          return (
            <Link key={t.href} href={t.href} style={{
              color: active ? 'var(--amber)' : 'var(--fog)',
              background: active ? 'rgba(245,166,35,0.1)' : 'transparent',
              fontSize: '13px',
              padding: '6px 14px',
              borderRadius: '6px',
              textDecoration: 'none',
              transition: 'all 0.15s',
              fontFamily: 'DM Sans, sans-serif',
            }}>
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
