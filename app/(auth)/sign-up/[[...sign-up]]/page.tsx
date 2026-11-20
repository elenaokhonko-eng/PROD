import type { Metadata } from 'next'
import { SignUp } from '@clerk/nextjs'
import { NO_CARD_LINE } from '@/lib/harbor/cta'
import { SAFETY_NOTICE_SHORT } from '@/lib/safety-notice'
import { FunnelStep } from '@/components/analytics/funnel-step'
import { GoogleTagManager } from '@/components/analytics/google-tag-manager'
import { signedUpRedirect } from '@/lib/analytics/google-tag'

// Brief W1 §F and §L3: plain wording, email code or Google only, its own title (noindex comes from the root layout).
export const metadata: Metadata = { title: { absolute: 'Create your account · GuideBuoy' } }

// A new account goes through /signed-up (the sign-up conversion), then on to where it was going (redirect_url).
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string }> }) {
  const { redirect_url: redirectUrl } = await searchParams
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-5xl items-center gap-10 py-12 lg:grid-cols-[1fr_auto]">
      <section className="max-w-xl">
        <p className="gb-eyebrow">Save your progress</p>
        <h1 className="gb-display mt-4 text-4xl font-semibold text-harbor-deep">Save your case</h1>
        <p className="mt-4 text-lg leading-8 text-foreground">
          Create a free account to keep your story private and get your evaluation.
        </p>
      </section>
      <div className="flex flex-col items-center gap-4">
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl={signedUpRedirect(redirectUrl)} />
        <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
          {NO_CARD_LINE} {SAFETY_NOTICE_SHORT}
        </p>
      </div>
      <FunnelStep event="signup_reached" />
      {/* Sign-up is the campaigns' conversion page; the signed-in case area has no Google tag. */}
      <GoogleTagManager />
    </div>
  )
}
