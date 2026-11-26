import Link from 'next/link'
import { ArrowRight, FolderOpen, Plus } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/auth'
import { isAwaitingStory } from '@/lib/journey/pack-case'
import { linkNewAccount } from '@/lib/server/current-user'
import { createUserClient } from '@/lib/supabase/server'

export default async function CasesPage() {
  // A new account that is not linked yet is linked here, not sent back to sign-in (smoke test, 12 Nov).
  const user = (await getCurrentUser()) ?? (await linkNewAccount())
  if (!user) redirect('/sign-in')

  const supabase = await createUserClient()
  const { data: cases, error } = await supabase
    .from('cases')
    .select('id, institution_name, created_at, updated_at, primary_narrative, pack_first_at')
    .order('updated_at', { ascending: false })

  if (error) throw new Error('The case list could not be loaded.')

  return (
    <main className="gb-container py-8 sm:py-12">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="gb-eyebrow">Case workspace</p>
          <h1 className="gb-display mt-3 text-4xl font-semibold text-harbor-deep">Your cases</h1>
          <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
            Open a saved case or start organising another complaint.
          </p>
        </div>
        <Button asChild className="min-h-11 sm:self-auto">
          <Link href="/app/case/new">
            <Plus className="size-4" aria-hidden="true" />
            Add a new case
          </Link>
        </Button>
      </div>

      {cases && cases.length > 0 ? (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Saved cases">
          {cases.map((caseItem) => {
            const dateValue = caseItem.updated_at ?? caseItem.created_at
            const updatedLabel = dateValue
              ? new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium' }).format(new Date(dateValue))
              : null

            return (
              <li key={caseItem.id}>
                {/* CR-2: a case opened for a pack has no case page until its story is added. */}
                <Link
                  href={isAwaitingStory(caseItem) ? '/app/case/new' : `/app/case/${caseItem.id}/dashboard`}
                  className="gb-card group flex min-h-40 flex-col p-5 outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-start justify-between gap-4">
                    <FolderOpen className="size-6 shrink-0 text-primary" aria-hidden="true" />
                    <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                  <span className="mt-5 text-xl font-semibold text-foreground">
                    {/* Named by workflow (finding E4); stage 1 has one workflow. */}
                    Scam and fraud case
                  </span>
                  {caseItem.institution_name?.trim() ? (
                    <span className="mt-1 text-sm font-medium text-foreground">{caseItem.institution_name.trim()}</span>
                  ) : null}
                  <span className="mt-2 text-sm text-muted-foreground">
                    {isAwaitingStory(caseItem) ? 'Waiting for your story' : updatedLabel ? `Updated ${updatedLabel}` : 'Open case workspace'}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <section className="gb-card mt-8 max-w-2xl p-6 sm:p-8" aria-labelledby="empty-cases-title">
          <FolderOpen className="size-9 text-primary" aria-hidden="true" />
          <h2 id="empty-cases-title" className="mt-5 text-2xl font-semibold text-harbor-deep">No saved cases yet</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Start with your story. Nothing is submitted to another organisation by GuideBuoy.
          </p>
          <Button asChild className="mt-6 min-h-11">
            <Link href="/app/case/new">Add a new case</Link>
          </Button>
        </section>
      )}
    </main>
  )
}
