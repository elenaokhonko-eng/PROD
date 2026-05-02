import { NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { createClient } from '@/lib/supabase/server'

interface ClerkUserEvent {
  data: {
    id: string
    email_addresses: Array<{
      id: string
      email_address: string
    }>
    primary_email_address_id: string
    first_name: string | null
    last_name: string | null
  }
  type: string
}

export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    )
  }

  const svixId = request.headers.get('svix-id')
  const svixTimestamp = request.headers.get('svix-timestamp')
  const svixSignature = request.headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: 'Missing svix headers' },
      { status: 400 }
    )
  }

  const body = await request.text()

  let event: ClerkUserEvent
  try {
    const wh = new Webhook(secret)
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkUserEvent
  } catch {
    return NextResponse.json(
      { error: 'Invalid webhook signature' },
      { status: 400 }
    )
  }

  if (event.type === 'user.created') {
    const { id: clerkId, email_addresses, primary_email_address_id, first_name, last_name } =
      event.data

    const primaryEmail =
      email_addresses.find((e) => e.id === primary_email_address_id)
        ?.email_address ?? email_addresses[0]?.email_address

    if (!primaryEmail) {
      return NextResponse.json(
        { error: 'No email address found' },
        { status: 400 }
      )
    }

    const profileUUID = crypto.randomUUID()

    const supabase = await createClient()
    const { error: insertError } = await supabase.from('profiles').insert({
      id: profileUUID,
      clerk_id: clerkId,
      email: primaryEmail,
      first_name,
      last_name,
    })

    if (insertError) {
      console.error('[clerk-webhook] failed to create profile:', insertError.message)
      return NextResponse.json(
        { error: 'Failed to create profile' },
        { status: 500 }
      )
    }

    const clerkSecretKey = process.env.CLERK_SECRET_KEY
    if (!clerkSecretKey) {
      console.error('[clerk-webhook] CLERK_SECRET_KEY not set — cannot sync supabase_uuid to Clerk')
    } else {
      const clerkRes = await fetch(
        `https://api.clerk.com/v1/users/${clerkId}/metadata`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${clerkSecretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            public_metadata: { supabase_uuid: profileUUID },
          }),
        },
      )
      if (!clerkRes.ok) {
        const bodyText = await clerkRes.text()
        console.error(
          '[clerk-webhook] failed to update Clerk public_metadata:',
          clerkRes.status,
          bodyText,
        )
      }
    }
  }

  return NextResponse.json({ received: true })
}