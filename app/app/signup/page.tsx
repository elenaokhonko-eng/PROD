import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'

export default async function AppSignupPage() {
  const { userId } = await auth()

  if (userId) {
    redirect('/app/case/new')
  }

  redirect('/sign-up')
}
