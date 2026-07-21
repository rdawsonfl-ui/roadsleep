'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ThemeToggle from '@/app/components/ThemeToggle'

export default function Nav() {
  const path = usePathname()
  // Only public-facing tabs in the top nav. The Admin route still exists at
  // /admin (and still requires the password gate to enter), but we don't link
  // to it from the nav so casual visitors and drivers don't see it. The site
  // owner gets there by typing the URL directly.
  const tabs = [
    { href: '/hotelier', label: 'Hotel/Park Owner' },
  ]
  return (
    <nav style={{
      background: 'var(--navbg)',
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
      {/* Day/Night toggle lives in the nav bar now — it needs to be
          reachable from every page without scrolling, and it took the
          slot the wordmark used to hold. The wordmark moved into the
          page H1. 'Find a Stop' still links home. */}
      <div className="nav-theme-toggle">
        <ThemeToggle />
      </div>
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
