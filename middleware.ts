import { NextResponse, type NextRequest } from 'next/server'

// Clean campaign URLs for offline media.
//
// A billboard or flyer reads better as roadsleep.com/i75 than
// roadsleep.com/?src=i75, so we let a bare single-segment path act as a
// source tag: /i75 redirects to /?src=i75, where the client-side tracker
// (SourceTracker -> captureAndLogSource) records the visit and remembers the
// source for the session. We use a redirect (not a rewrite) on purpose — the
// client needs the ?src= visible in the URL to read it.
//
// Anything that is a real route or a static file must pass through untouched.
// IMPORTANT: when you add a new top-level route, add its first path segment to
// RESERVED below, or visitors to it will be redirected to the home page.
const RESERVED = new Set([
  'admin', 'dashboard', 'hotel', 'hotelier', 'search', 'privacy', 'terms',
  'components', 'api', '_next',
  'favicon.ico', 'favicon.png', 'robots.txt', 'sitemap.xml',
  'manifest.json', 'manifest.webmanifest', 'sw.js',
])

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  // Only act on bare single-segment paths with no existing query string.
  const seg = pathname.replace(/^\//, '')
  if (!seg || seg.includes('/') || seg.includes('.') || search) {
    return NextResponse.next()
  }
  if (RESERVED.has(seg.toLowerCase())) {
    return NextResponse.next()
  }

  const url = req.nextUrl.clone()
  url.pathname = '/'
  url.searchParams.set('src', seg.toLowerCase())
  return NextResponse.redirect(url)
}

export const config = {
  // Skip Next internals and any path containing a dot (static files).
  matcher: ['/((?!_next/|.*\\.).*)'],
}
