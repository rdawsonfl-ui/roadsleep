// Server-side check of the admin password against the settings table.
// Browser sends candidate password, we compare on the server, return ok:true/false.
// Password never lands in client-readable storage; the settings table is RLS-locked
// so only the service role (which lives on the server) can read it.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ipfztqjxcaahwdpatkbn.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function POST(req: Request) {
  if (!serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'Server missing SUPABASE_SERVICE_ROLE_KEY env var' },
      { status: 500 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const candidate = (body?.password || '').toString()
  if (!candidate) return NextResponse.json({ ok: false, error: 'Password required' }, { status: 400 })

  const admin = createClient(supabaseUrl, serviceKey)
  const { data, error } = await admin
    .from('settings')
    .select('value')
    .eq('key', 'admin_password')
    .single()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'Settings unavailable' }, { status: 500 })
  }

  const matches = candidate === data.value
  return NextResponse.json({ ok: matches })
}
