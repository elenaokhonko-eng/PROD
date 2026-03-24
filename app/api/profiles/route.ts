import { NextResponse } from 'next/server'
import { getOrCreateProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function PUT(request: Request) {
  const user = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const supabase = await createClient()

  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: user.profileId,
      email: user.email,
      ...body,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
