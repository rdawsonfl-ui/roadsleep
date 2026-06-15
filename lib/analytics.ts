import { supabase } from './supabase'

// Marketing-source attribution.
//
// A campaign URL carries a source tag, e.g. roadsleep.com/?src=i75 (the
// middleware also rewrites bare /i75 -> /?src=i75 so billboards can use a
// short, clean address). We capture that tag once on landing, remember it
// for the rest of the session, and stamp it onto the call_logs row when the
// driver actually taps Call. That gives the admin a real funnel per channel:
//   source -> visits (campaign_visits) -> calls (call_logs.source)
// so a billboard, a fuel-desk QR, and a Reddit post can be compared head to
// head on cost-per-call instead of guessed at.

const SRC_KEY = 'rs_src'
const VISIT_FLAG = 'rs_visit_logged' // per-session, per-source dedupe

/** Read ?src= / ?utm_source= from the URL, persist it for the session, and
 *  log a single campaign_visits row (once per source per session so a refresh
 *  or in-app navigation doesn't inflate the count). Safe to call on every
 *  page load. No-op on the server and when no source is present. */
export function captureAndLogSource(): void {
  if (typeof window === 'undefined') return
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('src') || params.get('utm_source') || ''
    const src = raw.trim().toLowerCase().slice(0, 60)
    if (!src) return

    sessionStorage.setItem(SRC_KEY, src)

    const flag = `${VISIT_FLAG}:${src}`
    if (sessionStorage.getItem(flag)) return
    sessionStorage.setItem(flag, '1')

    supabase.from('campaign_visits').insert({
      source: src,
      referrer: typeof document !== 'undefined' ? document.referrer.slice(0, 200) : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
    }).then(() => {})
  } catch {
    // sessionStorage can throw in private modes / blocked storage — never let
    // attribution break the page.
  }
}

/** The source tag for the current session, or null. Stamped onto call logs. */
export function getSource(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(SRC_KEY)
  } catch {
    return null
  }
}
