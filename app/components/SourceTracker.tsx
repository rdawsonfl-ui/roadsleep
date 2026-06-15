'use client'

// Mounted once in the root layout. Runs source capture on every page load so
// a campaign tag is recorded no matter which page the QR/billboard/link points
// at (home, a specific hotel, search results, etc.). Renders nothing.

import { useEffect } from 'react'
import { captureAndLogSource } from '@/lib/analytics'

export default function SourceTracker() {
  useEffect(() => {
    captureAndLogSource()
  }, [])
  return null
}
