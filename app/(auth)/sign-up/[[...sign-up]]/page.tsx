import type { Metadata } from 'next'
import { SignUp } from '@clerk/nextjs'
import { NO_CARD_LINE } from '@/lib/harbor/cta'
import { SAFETY_NOTICE_SHORT } from '@/lib/safety-notice'
import { FunnelStep } from '@/components/analytics/funnel-step'

// Brief W1 §F and §L3: plain wording, email code or Google only, its own title (noindex comes from the root layout).
export const metadata: Metadata = { title: { absolute: 'Create your account · GuideBuoy' } }

export default function SignUpPage() {
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
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
        <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
          {NO_CARD_LINE} {SAFETY_NOTICE_SHORT}
        </p>
      </div>
      <FunnelStep event="signup_reached" />
    </div>
  )
}
