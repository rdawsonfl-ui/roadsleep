'use client';

// Client-only component that handles three PWA pieces:
//   1. Registers /sw.js on mount so the app works offline / installs cleanly.
//   2. Shows an "Add to Home Screen" hint for iOS Safari users (where the
//      OS won't auto-prompt — they have to tap the share icon manually).
//   3. Captures the `beforeinstallprompt` event on Chrome/Edge (Android +
//      desktop) and shows our own Install button that fires the OS dialog
//      cleanly. Without this, those browsers only show a tiny address-bar
//      install icon that 99% of users miss.
//
// Honest design decisions documented inline:
//   - 3-second delay (not 20s). Long enough to not feel jarring on first
//     paint, short enough that the popup appears before the user navigates
//     away. 20s was overly conservative and meant most users never saw it.
//   - Dismissal expires after 7 days. localStorage stores a timestamp, not
//     a boolean — so a tap-× doesn't permanently kill the popup. A user who
//     dismisses today gets re-prompted next week. Honest middle ground
//     between "ask every visit" (annoying) and "ask once ever" (lost forever).
//   - We DO show the iOS hint to in-app browsers (UA contains "Safari" but
//     not "Standalone" yet they're not real Safari). They'll see the hint
//     and learn the app exists; if they tap they can open in Safari from
//     there. Better than hiding entirely.

import { useEffect, useState } from 'react';

// How long after dismissal before we'll show the prompt again.
// 7 days = long enough to not pester, short enough that a new visit on a
// later trip gets a fresh nudge.
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const DISMISS_STORAGE_KEY = 'rs_install_dismissed_at';
const SHOW_DELAY_MS = 3000;

// BeforeInstallPromptEvent isn't in standard TS lib types. Minimal shape.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export default function PWAInit() {
  // Two distinct UIs: iOS Safari (manual share→add) vs Chrome/Edge (auto-prompt).
  // Track separately so each can be dismissed independently.
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    // -- Service worker registration --
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('Service worker registration failed:', err));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Test hatch: ?install=1 in the URL forces the install prompt regardless
    // of dismissed state. Lets us verify the UI without nuking localStorage.
    // Real users won't see this param so it has zero impact on normal flow.
    const forceShow = new URLSearchParams(window.location.search).get('install') === '1';

    // Check if app is already installed. We never want to prompt in that case.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isStandalone && !forceShow) return;

    // Check the dismissed-recently cooldown. Stored as a timestamp so we can
    // expire it after DISMISS_COOLDOWN_MS rather than treating dismissal as
    // permanent. If localStorage throws (private mode), treat as not dismissed.
    let dismissedRecently = false;
    try {
      const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
      if (raw) {
        const dismissedAt = parseInt(raw, 10);
        if (!isNaN(dismissedAt) && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) {
          dismissedRecently = true;
        }
      }
    } catch {
      // localStorage unavailable — proceed as not dismissed.
    }
    if (dismissedRecently && !forceShow) return;

    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);

    // For Chrome/Edge/Android: capture the beforeinstallprompt event. The OS
    // fires this when the site meets PWA install criteria (manifest, sw,
    // engaged user). We save it so we can fire `.prompt()` from our button.
    const onBeforeInstallPrompt = (e: Event) => {
      // Suppress the browser's default mini-banner so we can show our own
      // bigger, clearer prompt instead.
      e.preventDefault();
      const promptEvent = e as InstallPromptEvent;
      // Show our prompt after a small delay so it doesn't fight first paint.
      setTimeout(() => setInstallPrompt(promptEvent), SHOW_DELAY_MS);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    // iOS Safari never fires beforeinstallprompt. Show our manual hint
    // instead. We trigger it for ANY iOS browser — even Chrome on iOS uses
    // Safari's webview under the hood, and the share-sheet trick works the
    // same way. Better to over-show on iOS than miss real installs.
    let iosTimer: ReturnType<typeof setTimeout> | null = null;
    if (isIOS) {
      iosTimer = setTimeout(() => setShowIOSHint(true), SHOW_DELAY_MS);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  const recordDismissal = () => {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      /* private mode — dismissal won't persist, that's fine */
    }
  };

  const handleAndroidInstall = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'dismissed') {
        recordDismissal();
      }
      // Either way, the prompt is consumed — remove our UI.
      setInstallPrompt(null);
    } catch {
      setInstallPrompt(null);
    }
  };

  // Shared styling for the bottom-sheet card. Both iOS and Android use it.
  const sheetStyle: React.CSSProperties = {
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
  };

  const dismissButtonStyle: React.CSSProperties = {
    background: 'transparent',
    color: 'rgba(245,245,245,0.6)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '20px',
    lineHeight: 1,
    padding: '2px 6px',
    marginTop: '-2px',
  };

  // Android/Chrome/Edge: real install button (fires the OS dialog).
  if (installPrompt) {
    return (
      <div role="dialog" aria-label="Install RoadSleep" style={sheetStyle}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>
            Install RoadSleep<sup style={{ fontSize: '0.65em', marginLeft: '1px' }}>™</sup>
          </div>
          <div style={{ color: 'rgba(245,245,245,0.78)', fontSize: '13px', marginBottom: '10px' }}>
            One-tap install — works offline, opens like a regular app.
          </div>
          <button
            onClick={handleAndroidInstall}
            style={{
              background: '#FF6A00',
              color: '#0d0f14',
              border: 'none',
              borderRadius: '10px',
              padding: '10px 18px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Install
          </button>
        </div>
        <button
          onClick={() => {
            recordDismissal();
            setInstallPrompt(null);
          }}
          aria-label="Dismiss"
          style={dismissButtonStyle}
        >
          ×
        </button>
      </div>
    );
  }

  // iOS Safari: manual hint (share → Add to Home Screen).
  if (showIOSHint) {
    return (
      <div role="dialog" aria-label="Install RoadSleep" style={sheetStyle}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>
            Install RoadSleep<sup style={{ fontSize: '0.65em', marginLeft: '1px' }}>™</sup>
          </div>
          <div style={{ color: 'rgba(245,245,245,0.78)', fontSize: '13px' }}>
            Tap{' '}
            <span aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
              {/* iOS share icon */}
              <svg width="14" height="18" viewBox="0 0 14 18" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ verticalAlign: 'middle' }}>
                <path d="M7 1L7 12" stroke="#FF6A00" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M3.5 4.5L7 1L10.5 4.5" stroke="#FF6A00" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 8V16C2 16.5523 2.44772 17 3 17H11C11.5523 17 12 16.5523 12 16V8" stroke="#FF6A00" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>{' '}
            then &quot;Add to Home Screen&quot; to use RoadSleep<sup style={{ fontSize: '0.7em', marginLeft: '1px' }}>™</sup> without opening Safari.
          </div>
        </div>
        <button
          onClick={() => {
            recordDismissal();
            setShowIOSHint(false);
          }}
          aria-label="Dismiss"
          style={dismissButtonStyle}
        >
          ×
        </button>
      </div>
    );
  }

  return null;
}
