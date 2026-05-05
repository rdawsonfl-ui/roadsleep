// Change the admin password. Caller must prove they know the current one
// before we'll write the new one. Done server-side so the password never
// transits client-readable storage.
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
  const current = (body?.current || '').toString()
  const next = (body?.next || '').toString()

  if (!current) return NextResponse.json({ ok: false, error: 'Current password required' }, { status: 400 })
  if (!next) return NextResponse.json({ ok: false, error: 'New password required' }, { status: 400 })
  if (next.length < 8) return NextResponse.json({ ok: false, error: 'New password must be at least 8 characters' }, { status: 400 })
  if (next === current) return NextResponse.json({ ok: false, error: 'New password must be different from current' }, { status: 400 })

  const admin = createClient(supabaseUrl, serviceKey)

  // Verify current
  const { data: row, error: readErr } = await admin
    .from('settings')
    .select('value')
    .eq('key', 'admin_password')
    .single()

  if (readErr || !row) {
    return NextResponse.json({ ok: false, error: 'Settings unavailable' }, { status: 500 })
  }
  if (current !== row.value) {
    return NextResponse.json({ ok: false, error: 'Current password incorrect' }, { status: 401 })
  }

  // Write new
  const { error: writeErr } = await admin
    .from('settings')
    .update({ value: next, updated_at: new Date().toISOString() })
    .eq('key', 'admin_password')

  if (writeErr) {
    return NextResponse.json({ ok: false, error: 'Failed to save new password' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
