// Tracking-consent helpers.
//
// The driver-side app does TWO kinds of GPS work:
//
//   1) Live position for the listing matrix (watchPosition every 30s while
//      the page is open). This is standard "geolocation API" usage that any
//      map-based app does — the browser already gates it with the platform
//      permission prompt. We don't gate this with our own consent layer.
//
//   2) ARRIVAL TRACKING after a boosted-hotel Call tap (trackApproach):
//      we sample the driver's position every 60s for up to 90 minutes,
//      record the closest-approach distance, and SHARE the arrival proof
//      with the hotelier they called. THIS is the part drivers don't
//      expect from a generic GPS-permission prompt, so we add a
//      just-in-time consent modal the first time it would run, with a
//      clear plain-English explanation of what we log and who sees it.
//
// Choice is persisted in localStorage so we only ask once per device.
// User can revisit /privacy to flip the choice later.

const KEY = 'roadsleep_track_consent_v1'

export type TrackConsent = 'allow' | 'deny' | null

/** Read current consent state. Returns null if user hasn't decided. */
export function getTrackConsent(): TrackConsent {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(KEY)
    if (v === 'allow' || v === 'deny') return v
    return null
  } catch {
    // localStorage can throw in private modes — treat as undecided so the
    // modal shows, rather than silently tracking.
    return null
  }
}

/** Persist consent choice. */
export function setTrackConsent(v: 'allow' | 'deny') {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, v)
  } catch {
    // private mode etc. — set in memory only via a fallback global so the
    // current session still respects the choice even if it can't persist.
    ;(window as unknown as { __rsTrackConsent?: string }).__rsTrackConsent = v
  }
}

/** Clear consent (used by /privacy "reset" link). */
export function clearTrackConsent() {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(KEY) } catch { /* ignore */ }
}
