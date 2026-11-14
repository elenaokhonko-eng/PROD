import type { Metadata } from 'next'
import { SignIn } from '@clerk/nextjs'

// Brief W1 §F and §L3: plain wording, email code or Google only, its own title (noindex comes from the root layout).
export const metadata: Metadata = { title: { absolute: 'Sign in · GuideBuoy' } }

export default function SignInPage() {
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-5xl items-center gap-10 py-12 lg:grid-cols-[1fr_auto]">
      <section className="max-w-xl">
        <p className="gb-eyebrow">Secure case access</p>
        <h1 className="gb-display mt-4 text-4xl font-semibold text-harbor-deep">Welcome back.</h1>
        <p className="mt-4 text-lg leading-8 text-foreground">Sign in to continue your case.</p>
      </section>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </div>
  )
}
