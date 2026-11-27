import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { readFidrecTimeline } from '@/lib/journey/fidrec-timeline'
import { linkNewAccount } from '@/lib/server/current-user'
import { createUserClient } from '@/lib/supabase/server'
import { NewCaseSteps } from './_components/new-case-steps'

// CR-2: "Add a new case" stays inside the dashboard: the home page's story box and nothing else. For a case waiting
// with a paid FIDReC pack, the timeline questionnaire comes first (amended 27 Nov).
export default async function NewCasePage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const user = (await getCurrentUser()) ?? (await linkNewAccount())
  if (!user) redirect('/sign-in')

  return (
    <main className="gb-container py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="sr-only">Add a new case</h1>
        <NewCaseSteps timelineCaseId={await caseNeedingTimeline()} />
      </div>
    </main>
  )
}

// The case the story will fill, when its FIDReC pack is paid and the questionnaire is not answered. A failed read
// leaves the questionnaire to the case page, which asks it before anything is generated.
async function caseNeedingTimeline(): Promise<string | null> {
  const supabase = await createUserClient()
  const { data: waiting } = await supabase.from('cases').select('id').not('pack_first_at', 'is', null).is('primary_narrative', null).limit(1)
  const caseId = waiting?.[0]?.id as string | undefined
  if (!caseId) return null
  const [purchases, responses] = await Promise.all([
    supabase.from('case_purchases').select('product_code').eq('case_id', caseId).eq('payment_status', 'paid').eq('product_code', 'escalation_pack'),
    supabase.from('case_responses').select('question_key, response_value').eq('case_id', caseId),
  ])
  if (!purchases.data?.length || responses.error) return null
  return readFidrecTimeline(responses.data ?? []) ? null : caseId
}
