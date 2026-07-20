'use client'

import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'rs_theme'

/**
 * Day / Night toggle.
 *
 * Dark is the default and the original design — it's what a driver wants at
 * 10pm on the interstate, and it's what every existing screenshot and the PWA
 * splash screen assume. Light is opt-in.
 *
 * The choice persists in localStorage under `rs_theme` and is applied by
 * setting `data-theme` on <html>, which flips the CSS variable block in
 * globals.css. There's a matching inline script in layout.tsx that applies the
 * stored value before first paint — without it, a driver who chose light mode
 * gets a full-screen flash of black on every page load.
 *
 * Deliberately NOT wired to prefers-color-scheme. Most phones sit on light
 * system-wide, which would hand the majority of drivers a white screen at
 * night — the exact opposite of what this app is for. An explicit choice is
 * safer than a clever default.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  // Read the value the pre-paint script already applied, so the button state
  // matches what's on screen rather than resetting it.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme')
    setTheme(current === 'light' ? 'light' : 'dark')
  }, [])

  function apply(next: Theme) {
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Private browsing / storage disabled. The theme still applies for this
      // session; it just won't be remembered. Not worth surfacing an error.
    }
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      <button
        type="button"
        aria-pressed={theme === 'light'}
        onClick={() => apply('light')}
      >
        Day
      </button>
      <button
        type="button"
        aria-pressed={theme === 'dark'}
        onClick={() => apply('dark')}
      >
        Night
      </button>
    </div>
  )
}
