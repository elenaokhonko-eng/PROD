import type { Metadata } from 'next'
import { GoogleTagManager } from '@/components/analytics/google-tag-manager'
import { SignUpCompleted } from '@/components/analytics/sign-up-completed'
import { googleTagEnabled, safeNextPath } from '@/lib/analytics/google-tag'

// The step after sign-up (lib/analytics/google-tag.ts): one conversion event to Google, then on to the case.
export const metadata: Metadata = { title: { absolute: 'Setting up your account · GuideBuoy' }, robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function SignedUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <div className="text-center" role="status">
      <p className="text-lg">Setting up your account…</p>
      <GoogleTagManager />
      <SignUpCompleted next={safeNextPath(next)} report={googleTagEnabled()} />
    </div>
  )
}
