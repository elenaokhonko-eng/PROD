import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default async function NewCasePage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  return (
    <main className="gb-container py-10 sm:py-16">
      <section className="gb-card mx-auto max-w-2xl p-6 sm:p-8" aria-labelledby="new-case-title">
        <p className="gb-eyebrow">New case</p>
        <h1 id="new-case-title" className="gb-display mt-3 text-4xl font-semibold text-harbor-deep">
          Start in the way that feels easier.
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Tell your story in your own words or begin with guided questions. GuideBuoy helps organise information; it does not submit a complaint or decide your case.
        </p>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Button asChild size="lg" className="min-h-11">
            <Link href="/#tell-your-story">Tell your story</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="min-h-11">
            <Link href="/router">Answer guided questions</Link>
          </Button>
        </div>
        <p className="mt-6 text-sm leading-6 text-muted-foreground">
          Your case information may indicate a next step. Check the official requirements before acting.
        </p>
      </section>
    </main>
  )
}
