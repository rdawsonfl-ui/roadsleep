'use client'

import Link from 'next/link'
import { setTrackConsent } from '@/lib/consent'

// Just-in-time tracking consent modal.
//
// Renders the first time a driver is about to trigger arrival tracking
// (the trackApproach loop kicked off when they tap Call on a boosted
// hotel). After they tap "Yes, track me" or "No, just call", the choice
// persists in localStorage and this modal never appears again for that
// device. They can flip the choice later via /privacy.
//
// Design choices:
//   - Plain English, no legalese in the body. Legalese lives at /privacy.
//   - Two equally weighted buttons so neither feels coerced. "Yes" is
//     visually slightly more prominent (amber) since that's the path
//     that helps both the hotelier and the driver (better recommendations
//     over time), but "No" is a full-strength option, not a tiny link.
//   - We explicitly say WHO sees the data ("the hotel you called") since
//     undisclosed sharing is the highest-risk pattern under US privacy law.
//   - Link to full Privacy Policy so the curious driver can read it.

export function ConsentModal({
  onDecide,
}: {
  onDecide: (choice: 'allow' | 'deny') => void
}) {
  function pick(choice: 'allow' | 'deny') {
    setTrackConsent(choice)
    onDecide(choice)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div style={{
        background: 'var(--night2)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '24px',
        maxWidth: '440px',
        width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontSize: '36px', textAlign: 'center', marginBottom: '8px' }}>📍</div>

        <h2 id="consent-title" style={{
          fontSize: '20px', fontWeight: 800, color: 'var(--white)',
          fontFamily: 'Syne, sans-serif', textAlign: 'center',
          marginBottom: '12px', letterSpacing: '0.3px',
        }}>
          Welcome to RoadSleep
        </h2>

        <p style={{
          fontSize: '14px', color: 'var(--mist)',
          lineHeight: 1.5, marginBottom: '14px',
        }}>
          When you call a featured hotel through RoadSleep, we can confirm
          for you and the hotel whether you arrived — by checking your
          distance to <strong style={{ color: 'var(--white)' }}>that hotel only</strong>
          {' '}for up to 90 minutes after your call.
        </p>

        <div style={{
          background: 'var(--night3)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '12px 14px',
          marginBottom: '16px',
          fontSize: '13px', color: 'var(--mist)',
          lineHeight: 1.5,
        }}>
          <div style={{ marginBottom: '6px' }}>
            <strong style={{ color: 'var(--white)' }}>What we record:</strong> distance to this hotel.
            Not your full address. Not where else you go.
          </div>
          <div style={{ marginBottom: '6px' }}>
            <strong style={{ color: 'var(--white)' }}>Who sees it:</strong> you, and the hotel you called.
            That&apos;s it. We don&apos;t sell it.
          </div>
          <div>
            <strong style={{ color: 'var(--white)' }}>When it stops:</strong> when you arrive,
            or after 90 minutes — whichever comes first.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
          <button
            onClick={() => pick('allow')}
            style={{
              padding: '14px',
              background: 'linear-gradient(135deg, #FF6A00 0%, #F5A623 100%)',
              color: '#FFFFFF', border: 'none', borderRadius: '12px',
              fontSize: '16px', fontWeight: 800, fontFamily: 'Syne, sans-serif',
              cursor: 'pointer', letterSpacing: '0.3px',
              boxShadow: '0 4px 20px rgba(255,106,0,0.4)',
            }}
          >
            ✓ Allow arrival tracking
          </button>
          <button
            onClick={() => pick('deny')}
            style={{
              padding: '14px',
              background: 'var(--night3)', color: 'var(--white)',
              border: '1px solid var(--border)', borderRadius: '12px',
              fontSize: '15px', fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            No thanks — just hotels &amp; calls
          </button>
        </div>

        <p style={{
          fontSize: '11px', color: 'var(--fog)',
          textAlign: 'center', lineHeight: 1.5, margin: 0,
        }}>
          You can change this anytime on the{' '}
          <Link href="/privacy" style={{ color: 'var(--amber)', textDecoration: 'underline' }}>
            Privacy page
          </Link>
          . We ask once per device.
        </p>
      </div>
    </div>
  )
}
