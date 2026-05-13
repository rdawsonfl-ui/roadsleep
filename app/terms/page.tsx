'use client'

import Link from 'next/link'
import SiteFooter from '@/app/components/SiteFooter'

// Terms of Service.
//
// Two audiences in one page: drivers (who use the search side for free)
// and hoteliers (who pay for boost). Each gets its own section since
// their relationships with RoadSleep are different.
//
// Plain English. We're not trying to look like a Big Co legal doc;
// dense pages mean fewer people read them and worse-informed consent.
// The protective bits (limitation of liability, arbitration, governing
// law) are present, just written in shorter sentences.

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--fog)', marginBottom: '32px' }}>
          Last updated: November 2025
        </p>

        <p style={{
          fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6,
          marginBottom: '24px',
        }}>
          By using RoadSleep, you agree to these terms. They&apos;re written in plain
          English on purpose. If something is unclear, email{' '}
          <a href="mailto:hello@roadsleep.com" style={{ color: 'var(--amber)' }}>
            hello@roadsleep.com
          </a>{' '}
          and we&apos;ll explain.
        </p>

        {/* --- Driver terms --- */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '22px', fontWeight: 800, fontFamily: 'Syne, sans-serif',
            marginBottom: '12px',
          }}>
            For drivers
          </h2>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Free to use</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            RoadSleep is free for drivers. We don&apos;t take a commission when you book,
            we don&apos;t charge per-call, and we don&apos;t run ads against your activity.
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Hotel information accuracy</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            We do our best to keep hotel addresses, phone numbers, and amenities accurate,
            but we don&apos;t set them — hotels do. We don&apos;t display hotel prices because
            those change daily. <strong style={{ color: 'var(--white)' }}>Always confirm
            the rate by phone before driving to a hotel.</strong> If a featured hotel
            displays a price, that&apos;s the rate that hotel chose to publish for that
            time window.
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Tracking</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            We ask before tracking arrival. Your choice is remembered per device. See
            the <Link href="/privacy" style={{ color: 'var(--amber)' }}>Privacy Policy</Link>{' '}
            for what we record and who sees it.
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Don&apos;t drive distracted</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            RoadSleep is meant for use when stopped or via voice. Don&apos;t use it while
            actively driving. We are not responsible for accidents caused by use of the app
            while in motion.
          </p>
        </section>

        {/* --- Hotelier terms --- */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '22px', fontWeight: 800, fontFamily: 'Syne, sans-serif',
            marginBottom: '12px',
          }}>
            For hoteliers
          </h2>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Boost is the only paid feature</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            Hotels are listed for free. Featuring your listing for 1, 2, or 3 hours is
            the paid product. You choose when and whether to boost. We don&apos;t
            auto-charge you for anything else.
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Arrival data is your data</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '8px' }}>
            When a driver opts in to arrival tracking and then physically drives to your
            hotel, you see that arrival proof in your dashboard. The data on those calls
            (time, distance, whether the driver arrived) belongs to your hotel&apos;s account.
          </p>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            <strong style={{ color: 'var(--white)' }}>You may not use arrival data to
            identify, contact, or follow up with individual drivers</strong> outside of
            the call they initiated. Drivers consent to arrival verification, not to
            outbound marketing.
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Honesty</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            If you advertise a boost price, you must honor it for callers during the
            boost window. We track confirmation codes and arrival data partly to catch
            rate bait-and-switch. We may suspend hotels that don&apos;t honor boost rates.
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Cancellation</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            You can stop boosting at any time (the &quot;End Boost Now&quot; button in your
            dashboard) and unboost takes effect within seconds. Any partial-window
            boost is refunded pro-rata.
          </p>
        </section>

        {/* --- Legal protections (shorter but present) --- */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '22px', fontWeight: 800, fontFamily: 'Syne, sans-serif',
            marginBottom: '12px',
          }}>
            Legal stuff
          </h2>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No warranties</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            RoadSleep is provided as-is. We try to make it reliable, but we can&apos;t guarantee
            uptime, accuracy of hotel data, or that the GPS arrival tracker will catch every
            arrival (it depends on your phone&apos;s GPS signal and battery).
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Limitation of liability</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            RoadSleep is not liable for indirect, incidental, or consequential damages
            arising from use of the service. Our maximum liability in any 12-month
            period is the total amount you paid us during that period (zero, for drivers).
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Disputes</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            We&apos;ll try to resolve any dispute by email first. If we can&apos;t, disputes
            will be resolved by binding arbitration under the rules of the American
            Arbitration Association, with venue in Saratoga County, New York. You waive
            class action rights to the extent permitted by law.
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Governing law</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            These terms are governed by the laws of New York State, without regard to
            its conflict-of-laws principles.
          </p>

          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>Changes</h3>
          <p style={{ fontSize: '14px', color: 'var(--mist)', lineHeight: 1.6, marginBottom: '16px' }}>
            We may update these terms. If we change anything material, we&apos;ll show you
            the change before it takes effect. Continued use after a material change
            means you accept the new terms.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Syne, sans-serif', marginBottom: '10px' }}>
            Contact
          </h2>
          <p style={{ fontSize: '15px', color: 'var(--mist)', lineHeight: 1.6 }}>
            Email <a href="mailto:hello@roadsleep.com" style={{ color: 'var(--amber)' }}>
              hello@roadsleep.com
            </a> for anything. For data-specific requests use{' '}
            <a href="mailto:privacy@roadsleep.com" style={{ color: 'var(--amber)' }}>
              privacy@roadsleep.com
            </a>.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
