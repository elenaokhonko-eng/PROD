import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { RefreshWhileConfirming } from '@/components/journey/refresh-while-confirming'
import { readFidrecTimeline } from '@/lib/journey/fidrec-timeline'
import { CONFIRMING_PAYMENT, PURCHASE_PRODUCT_CODE } from '@/lib/journey/pack-case'
import { linkNewAccount } from '@/lib/server/current-user'
import { createUserClient } from '@/lib/supabase/server'
import { NewCaseSteps } from './_components/new-case-steps'

// CR-2: "Add a new case" stays inside the dashboard: the home page's story box and nothing else. For a case waiting
// with a paid FIDReC pack, the timeline questionnaire comes first (amended 27 Nov).
export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ checkout?: string; product?: string }> }) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const user = (await getCurrentUser()) ?? (await linkNewAccount())
  if (!user) redirect('/sign-in')

  // Back from Stripe: the pack's path starts once the payment is recorded (the questionnaire depends on it).
  const params = await searchParams
  const confirming = params.checkout === 'success' && !(await paymentRecorded(params.product))

  return (
    <main className="gb-container py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="sr-only">Add a new case</h1>
        {confirming ? (
          <>
            <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm">{CONFIRMING_PAYMENT}</p>
            <RefreshWhileConfirming />
          </>
        ) : (
          <NewCaseSteps timelineCaseId={await caseNeedingTimeline()} />
        )}
      </div>
    </main>
  )
}

// Whether the pack just bought is recorded on the case waiting for its story.
async function paymentRecorded(product: string | undefined): Promise<boolean> {
  const code = PURCHASE_PRODUCT_CODE[product as keyof typeof PURCHASE_PRODUCT_CODE]
  if (!code) return true
  const supabase = await createUserClient()
  const { data: waiting } = await supabase.from('cases').select('id').not('pack_first_at', 'is', null).is('primary_narrative', null).limit(1)
  if (!waiting?.length) return true
  const { data } = await supabase.from('case_purchases').select('product_code').eq('case_id', waiting[0].id).eq('product_code', code).eq('payment_status', 'paid')
  return Boolean(data?.length)
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
