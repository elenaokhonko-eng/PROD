import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'

export default async function AppSignupPage() {
  const user = await getCurrentUser()

  if (user) {
    redirect('/app/case/new')
  }

  redirect('/sign-up')
}
