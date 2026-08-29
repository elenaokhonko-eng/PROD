import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-5xl items-center gap-10 px-4 py-12 lg:grid-cols-[1fr_auto]">
      <section className="max-w-xl">
        <p className="gb-eyebrow">Save your progress</p>
        <h1 className="gb-display mt-4 text-4xl font-semibold text-harbor-deep">Create your case account.</h1>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">
          Use email sign-up to continue your draft in the authenticated case workspace.
        </p>
        <div className="mt-8 rounded-xl border border-dashed bg-muted/30 p-4">
          <p className="font-semibold">Singpass</p>
          <p className="mt-1 text-sm text-muted-foreground">Singpass sign-in is not currently available.</p>
          <button type="button" className="mt-3 min-h-11 w-full rounded-lg border px-4 text-sm font-semibold" disabled>
            Continue with Singpass
          </button>
        </div>
      </section>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </main>
  )
}
