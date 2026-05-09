'use client';

// Client-only component that handles two PWA pieces:
//   1. Registers /sw.js on mount so the app works offline / installs cleanly.
//   2. Shows a small iOS install hint (since iOS won't auto-prompt). On
//      Android Chrome the OS handles the install prompt itself, so we
//      don't render anything for those users.
//
// Kept as a single component (rather than two) because both pieces only
// run in the browser and dismounting one shouldn't unmount the other.

import { useEffect, useState } from 'react';

export default function PWAInit() {
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    // -- Service worker registration --
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Only register in production. In dev, the SW can confuse hot-reload
    // and cache stale assets. Vercel sets NODE_ENV=production automatically.
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        // Silent fail — SW is a progressive enhancement, the app works
        // perfectly without it. Log so it's visible in console for debugging.
        console.warn('Service worker registration failed:', err);
      });

    // -- iOS install hint --
    // We only show the hint when:
    //   - User is on iOS Safari (the only browser that supports A2HS on iOS)
    //   - App isn't already installed (display-mode: standalone means it is)
    //   - User hasn't dismissed the hint before (localStorage flag)
    //   - User has been on the site for at least 20 seconds (so we don't
    //     interrupt their first impression)
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) && !(window as any).MSStream;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari uses a vendor prefix
      (window.navigator as any).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('rs_ios_hint_dismissed') === '1';
    } catch {
      // localStorage can throw in private mode — treat as not dismissed
    }

    if (isIOS && isSafari && !isStandalone && !dismissed) {
      const t = setTimeout(() => setShowIOSHint(true), 20000);
      return () => clearTimeout(t);
    }
  }, []);

  if (!showIOSHint) return null;

  return (
    <div
      role="dialog"
      aria-label="Install RoadSleep™"
      style={{
        position: 'fixed',
        left: '12px',
        right: '12px',
        bottom: '16px',
        zIndex: 1000,
        background: '#0d0f14',
        color: '#f5f5f5',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '14px',
        padding: '14px 16px',
        boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
        fontFamily: 'DM Sans, sans-serif',
        fontSize: '14px',
        lineHeight: 1.4,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: '4px' }}>
          Install RoadSleep<sup style={{ fontSize: '0.65em', marginLeft: '1px' }}>™</sup>
        </div>
        <div style={{ color: 'rgba(245,245,245,0.78)', fontSize: '13px' }}>
          Tap{' '}
          <span aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            {/* iOS share icon — small inline SVG so we don't need an extra request */}
            <svg width="14" height="18" viewBox="0 0 14 18" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ verticalAlign: 'middle' }}>
              <path d="M7 1L7 12" stroke="#FF6A00" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M3.5 4.5L7 1L10.5 4.5" stroke="#FF6A00" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 8V16C2 16.5523 2.44772 17 3 17H11C11.5523 17 12 16.5523 12 16V8" stroke="#FF6A00" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>{' '}
          then "Add to Home Screen" to use RoadSleep<sup style={{ fontSize: '0.7em', marginLeft: '1px' }}>™</sup> without opening Safari.
        </div>
      </div>
      <button
        onClick={() => {
          try {
            localStorage.setItem('rs_ios_hint_dismissed', '1');
          } catch {
            /* ignore */
          }
          setShowIOSHint(false);
        }}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          color: 'rgba(245,245,245,0.6)',
          border: 'none',
          cursor: 'pointer',
          fontSize: '20px',
          lineHeight: 1,
          padding: '2px 6px',
          marginTop: '-2px',
        }}
      >
        ×
      </button>
    </div>
  );
}
