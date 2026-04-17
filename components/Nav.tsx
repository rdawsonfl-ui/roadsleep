'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Nav() {
  const pathname = usePathname()
  const tabs = [
    { href: '/', label: 'Find' },
    { href: '/admin', label: 'Hotelier' },
  ]
  return (
    <nav style={{ background: '#14171f', borderBottom: '1px solid rgba(255,255,255,0.07)', height: 56 }}
         className="flex items-center justify-between px-5 sticky top-0 z-50 backdrop-blur">
      <Link href="/" className="font-display text-xl font-extrabold tracking-tight" style={{ color: '#f0f2f7' }}>
        Road<span style={{ color: '#f5a623' }}>Sleep</span>
      </Link>
      <div className="flex gap-1">
        {tabs.map(t => {
          const active = pathname === t.href || (t.href !== '/' && pathname?.startsWith(t.href))
          return (
            <Link key={t.href} href={t.href}
              className="text-xs font-medium px-3.5 py-1.5 rounded-md transition-all"
              style={{
                color: active ? '#f5a623' : '#8a93a8',
                background: active ? 'rgba(245,166,35,0.1)' : 'transparent',
              }}>
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
