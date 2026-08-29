import { SignUp } from '@clerk/nextjs'

const clerkAppearance = {
  elements: {
    card: 'w-full rounded-2xl border border-border bg-card shadow-sm',
    headerTitle: 'text-foreground',
    headerSubtitle: 'text-muted-foreground',
    formButtonPrimary: 'bg-primary hover:bg-primary/90',
    footerActionLink: 'text-primary hover:text-primary/90',
  },
}

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <section className="w-full max-w-md space-y-4">
        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">GuideBuoy AI</p>
          <h1 className="text-3xl font-semibold tracking-tight">Save your next steps</h1>
          <p className="text-sm text-muted-foreground">Create an account to continue from your saved story.</p>
        </div>
        <SignUp appearance={clerkAppearance} />
        <div className="rounded-xl border border-border bg-card p-4">
          <button type="button" disabled className="flex min-h-11 w-full items-center justify-between rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground">
            <span>Singpass sign-in is not currently available.</span>
          </button>
        </div>
      </section>
    </main>
  )
}
