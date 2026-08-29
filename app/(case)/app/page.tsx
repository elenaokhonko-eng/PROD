import Link from 'next/link'
import { ArrowRight, FolderOpen, Plus } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'

export default async function CasesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  const supabase = await createUserClient()
  const { data: cases, error } = await supabase
    .from('cases')
    .select('id, institution_name, created_at, updated_at')
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
            Start a new case
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
                <Link
                  href={`/app/case/${caseItem.id}/dashboard`}
                  className="gb-card group flex min-h-40 flex-col p-5 outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-start justify-between gap-4">
                    <FolderOpen className="size-6 shrink-0 text-primary" aria-hidden="true" />
                    <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                  <span className="mt-5 text-xl font-semibold text-foreground">
                    {caseItem.institution_name?.trim() || 'Saved complaint'}
                  </span>
                  <span className="mt-2 text-sm text-muted-foreground">
                    {updatedLabel ? `Updated ${updatedLabel}` : 'Open case workspace'}
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
            Start with your story or the guided questions. Nothing is submitted to another organisation by GuideBuoy.
          </p>
          <Button asChild className="mt-6 min-h-11">
            <Link href="/app/case/new">Start a new case</Link>
          </Button>
        </section>
      )}
    </main>
  )
}
