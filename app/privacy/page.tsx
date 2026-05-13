'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import SiteFooter from '@/app/components/SiteFooter'
import { getTrackConsent, setTrackConsent, clearTrackConsent } from '@/lib/consent'

// Privacy Policy page.
//
// Three jobs:
//   1) Explain in plain English what we collect, why, who sees it.
//   2) Surface the current tracking-consent state and let the user
//      change it (one-click revoke / re-grant / reset to ask-again).
//   3) Provide a contact path for data deletion or questions.
//
// This is intentionally written in clear English, not lawyer-speak.
// Per modern privacy practice (CCPA, GDPR), the disclosure has to be
// understandable by a non-lawyer or it doesn't count as informed
// consent. Legal jargon paragraphs are a compliance smell.

export default function PrivacyPage() {
  // Track consent state in React so the buttons reflect current value.
  const [consent, setConsent] = useState<'allow' | 'deny' | null>(null)

  useEffect(() => {
    setConsent(getTrackConsent())
  }, [])

  function apply(choice: 'allow' | 'deny' | null) {
    if (choice === null) clearTrackConsent()
    else setTrackConsent(choice)
    setConsent(choice)
  }

  return (
    <>
      <main style={{
        maxWidth: '720px', margin: '0 auto', padding: '24px 20px 80px',
        color: 'var(--white)', fontFamily: 'DM Sans, sans-serif',
      }}>
        <Link href="/" style={{
          color: 'var(--fog)', textDecoration: 'none', fontSize: '13px',
          display: 'inline-block', marginBottom: '20px',
        }}>
          ← Back to RoadSleep
        </Link>

        <h1 style={{
          fontSize: '32px', fontWeight: 800, fontFamily: 'Syne, sans-serif',
          marginBottom: '6px', letterSpacing: '0.5px',
        }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--fog)', marginBottom: '32px' }}>
          Last updated: November 2025
        </p>

        {/* --- Consent control panel --- */}
        <div style={{
          background: 'var(--night2)', border: '1px solid var(--border)',
          borderRadius: '12px', padding: '20px', marginBottom: '32px',
        }}>
          <h2 style={{
            fontSize: '16px', fontWeight: 800, fontFamily: 'Syne, sans-serif',
            marginBottom: '10px', letterSpacing: '0.3px',
          }}>
            📍 Your tracking choice
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.5, marginBottom: '14px' }}>
            Current setting: <strong style={{ color: 'var(--white)' }}>
              {consent === 'allow' ? 'Arrival tracking is ON' : null}
              {consent === 'deny' ? 'Arrival tracking is OFF' : null}
              {consent === null ? "You haven't decided yet — you'll be asked next time you tap Call on a featured hotel" : null}
            </strong>
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              onClick={() => apply('allow')}
              disabled={consent === 'allow'}
              style={{
                padding: '10px 14px', fontSize: '13px', fontWeight: 700,
                background: consent === 'allow' ? 'var(--night3)' : 'var(--amber)',
                color: consent === 'allow' ? 'var(--fog)' : 'var(--night)',
                border: '1px solid var(--border)', borderRadius: '8px',
                cursor: consent === 'allow' ? 'default' : 'pointer',
              }}
            >
              ✓ Allow tracking
            </button>
            <button
              onClick={() => apply('deny')}
              disabled={consent === 'deny'}
              style={{
                padding: '10px 14px', fontSize: '13px', fontWeight: 700,
                background: consent === 'deny' ? 'var(--night3)' : 'var(--white)',
                color: consent === 'deny' ? 'var(--fog)' : 'var(--night)',
                border: '1px solid var(--border)', borderRadius: '8px',
                cursor: consent === 'deny' ? 'default' : 'pointer',
              }}
            >
              ✕ Turn off tracking
            </button>
            <button
              onClick={() => apply(null)}
              disabled={consent === null}
              style={{
                padding: '10px 14px', fontSize: '13px', fontWeight: 600,
                background: 'transparent', color: 'var(--mist)',
                border: '1px solid var(--border)', borderRadius: '8px',
                cursor: consent === null ? 'default' : 'pointer',
                opacity: consent === null ? 0.5 : 1,
              }}
            >
              Reset (ask me again)
            </button>
          </div>
        </div>

        {/* --- Plain-English policy --- */}
        <section style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Syne, sans-serif', marginBottom: '10px' }}>
            What is RoadSleep?
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '12px' }}>
            RoadSleep helps long-haul truck drivers find hotels along the U.S. interstate
            system. We don&apos;t charge drivers. We don&apos;t take commissions on bookings.
            Hotels pay a small fee to feature their listing during specific hours.
          </p>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Syne, sans-serif', marginBottom: '10px' }}>
            What data we collect
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '12px' }}>
            Two kinds, and we treat them differently:
          </p>
          <div style={{ paddingLeft: '12px', borderLeft: '2px solid var(--border)', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--white)', marginBottom: '6px' }}>
              1. While you browse: your location
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.55 }}>
              We use your phone&apos;s GPS to show hotels near you and sort them by distance.
              This data stays on your phone — it&apos;s not stored on our servers.
            </p>
          </div>
          <div style={{ paddingLeft: '12px', borderLeft: '2px solid var(--border)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--white)', marginBottom: '6px' }}>
              2. When you call a featured hotel: arrival tracking
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.55, marginBottom: '8px' }}>
              If you allow it (we ask the first time), we check your distance to that
              hotel every 60 seconds for up to 90 minutes after the call. We record
              the closest distance reached. We do not store a trail of your locations —
              just one number per call: how close you got.
            </p>
            <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.55 }}>
              This is how hotels know their advertising worked. It&apos;s also the only
              location data we ever store about you.
            </p>
          </div>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Syne, sans-serif', marginBottom: '10px' }}>
            Who sees your data
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '8px' }}>
            <strong style={{ color: 'var(--white)' }}>The hotel you called</strong> sees:
            the time you called, whether you arrived, and how close you got. That&apos;s it.
            They do not see your name, phone number, vehicle, or anywhere else you went.
          </p>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '8px' }}>
            <strong style={{ color: 'var(--white)' }}>We do not sell your data.</strong>{' '}
            We do not share it with advertisers, data brokers, or any third party not
            directly involved in delivering the service.
          </p>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--white)' }}>We do not run third-party ads</strong>{' '}
            inside RoadSleep, so we don&apos;t pass your info to ad networks.
          </p>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Syne, sans-serif', marginBottom: '10px' }}>
            How long we keep it
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6 }}>
            Call records (which hotel you called, when, distance) are kept indefinitely
            so hotels can review their performance. We aggregate them after 12 months —
            individual call rows older than a year are bucketed by hotel and month,
            with the per-row arrival distance dropped.
          </p>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Syne, sans-serif', marginBottom: '10px' }}>
            Your rights
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '8px' }}>
            You can:
          </p>
          <ul style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6, paddingLeft: '24px', marginBottom: '12px' }}>
            <li>Turn off arrival tracking at any time (button above)</li>
            <li>Request a copy of all data we hold about you</li>
            <li>Request deletion of your data</li>
            <li>Continue using RoadSleep to find and call hotels without any tracking</li>
          </ul>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6 }}>
            To exercise any of these, email <a href="mailto:privacy@roadsleep.com" style={{ color: 'var(--amber)' }}>privacy@roadsleep.com</a>.
            We respond within 30 days as required by applicable law.
          </p>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Syne, sans-serif', marginBottom: '10px' }}>
            Cookies &amp; analytics
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6 }}>
            We use a small amount of local storage on your device to remember your
            settings (like your tracking choice and the last interstate you viewed).
            We do not use third-party analytics scripts or tracking pixels.
          </p>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Syne, sans-serif', marginBottom: '10px' }}>
            Changes to this policy
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6 }}>
            If we materially change how we use your data, we&apos;ll prompt you for
            consent again. Cosmetic changes will be reflected by the &quot;last updated&quot;
            date at the top of this page.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Syne, sans-serif', marginBottom: '10px' }}>
            Contact
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6 }}>
            Questions, data requests, or complaints:{' '}
            <a href="mailto:privacy@roadsleep.com" style={{ color: 'var(--amber)' }}>
              privacy@roadsleep.com
            </a>
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
