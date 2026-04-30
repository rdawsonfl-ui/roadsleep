import { createClient } from '@supabase/supabase-js'

// Hard-coded so the app works without env vars on Vercel
// The anon key is designed to be public (protected by RLS)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ipfztqjxcaahwdpatkbn.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlwZnp0cWp4Y2FhaHdkcGF0a2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNzg0NTgsImV4cCI6MjA5MTk1NDQ1OH0.SyKmI01jEp-dDg3OniwSQRypNP0PxMrgiUajlqL6erA'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

export type Interstate = {
  id: string
  name: string
  is_active: boolean
}

export type Exit = {
  id: string
  interstate_id: string
  direction: 'N' | 'S' | 'E' | 'W'
  exit_label: string
  mile_marker: number
  city: string
  state: string
}

export type Hotel = {
  id: string
  exit_id: string
  name: string
  phone: string
  address: string
  price_min: number
  price_max: number
  amenities: string[]
  availability_badge: 'available' | 'limited' | 'full'
  featured: boolean
  photo_url: string
  verified?: boolean
  last_verified_at?: string | null
  verification_notes?: string | null
  boost_price?: number | null
  boost_started_at?: string | null
  boost_ends_at?: string | null
  boost_duration_hr?: 1 | 2 | 3 | null
  last_boost_date?: string | null
  exits?: Exit & { interstates?: Interstate }
}
