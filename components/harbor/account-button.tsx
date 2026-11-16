'use client'

import { UserButton, useUser } from '@clerk/nextjs'

// Cutover checklist, week one (Elena, 12 Nov): the account button is on every page a signed-in person sees, public
// pages included, so signing out and the account settings are always one tap away. Signed out, the headers keep their
// own "Sign in" link.
export function AccountButton() {
  const { isLoaded, isSignedIn } = useUser()
  if (!isLoaded || !isSignedIn) return null
  return (
    <div className="flex size-11 shrink-0 items-center justify-center" data-testid="account-button">
      <UserButton />
    </div>
  )
}
