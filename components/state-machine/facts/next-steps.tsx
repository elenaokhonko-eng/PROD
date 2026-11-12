'use client'

/**
 * After the free evaluation: the recommended next step (design 6.1) and the two paid options. In stage 1 both paid
 * options show "Available shortly" (finding D1: no dates) with an "Email me when it's available" button instead of
 * a buy button.
 */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { useJoinWaitlist, useRecommendation } from '@/hooks/state-machine/facts/use-recommendation'
import { FIDREC_RULES, type ProductState, type StageProduct } from '@/lib/facts'

const PRODUCT_TITLES: Record<StageProduct, string> = {
  free_evaluation: 'Free evaluation',
  bank_pack: 'Bank dispute pack',
  fidrec_pack: 'FIDReC escalation pack',
}

// Each card says what the report does and who it is for (finding C6), and offers a human review (D2).
const CONSULTATION = 'Human consultation: S$99 for 30 minutes. Email info@guidebuoyai.sg to book.'

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const FIDREC_TIMING =
  'You can go to FIDReC within 6 months of your bank’s final reply, or 4 weeks after you sent a written complaint if the bank hasn’t resolved it. You don’t have to wait for a final reply.'

function ruleNote(state: ProductState | undefined): string | null {
  if (!state) return null
  if (state.state === 'available_from') {
    return state.date
      ? `For your case, you can go to FIDReC from ${formatDate(state.date)}, four weeks after your written complaint, if your bank hasn't resolved it. You don't have to wait for a final reply.`
      : 'For your case, you can go to FIDReC four weeks after you send your bank a written complaint, if it hasn’t resolved it. You don’t have to wait for a final reply.'
  }
  if (state.state === 'not_offered') {
    if (state.reason === 'final_reply_received') return 'Not needed for your case: your bank has already sent its final reply.'
    if (state.reason === 'fidrec_window_expired') return 'The six-month window to go to FIDReC after the final reply has passed.'
    if (state.reason === 'complaint_not_raised') return 'For your case, this comes after you have complained to your bank.'
  }
  return null
}

export function NextSteps({ caseId, priceLabels }: { caseId: string; priceLabels: { report: string; tier2: string } }) {
  const recommendation = useRecommendation(caseId)
  const join = useJoinWaitlist()
  const [joined, setJoined] = useState<Record<string, string>>({})

  if (recommendation.isPending) return <StateMachineLoading size="inline" title="Preparing your next steps" />
  if (recommendation.isError) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>Your next steps</CardTitle>
          <CardDescription>We couldn’t load your next steps just now. Please refresh the page.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const { recommendation: rec, paidStages } = recommendation.data
  const stateOf = (product: StageProduct) => rec?.products.find((p) => p.product === product)
  const cards: Array<{ product: 'bank_pack' | 'fidrec_pack'; price: string; description: string; detail: string }> = [
    {
      product: 'bank_pack',
      price: priceLabels.report,
      description:
        'Haven’t sent your bank a full written complaint yet, or not sure yours was complete? We’ll prepare one with you, with the evidence the bank expects and the regulatory framework in mind.',
      detail: 'A concise, formal complaint with the key facts and your evidence.',
    },
    {
      product: 'fidrec_pack',
      price: priceLabels.tier2,
      // The fee comes from the rules config, quoted from the ToR (Annex 1, 6.6); the timing is shown once, for the
      // person's case when we know it (walkthrough, 8 Nov).
      description:
        `FIDReC is Singapore’s independent dispute resolution centre for consumers and financial institutions. It costs nothing to start; if your case goes to adjudication, FIDReC charges individuals a S$${FIDREC_RULES.adjudicationFeeSgd.individual} case fee.`,
      detail: 'A comprehensive case pack with every material fact and the arguments on both sides, ready for FIDReC’s process.',
    },
  ]

  return (
    <section aria-labelledby="next-steps" className="space-y-4">
      <h2 id="next-steps" className="text-xl font-semibold">Your next steps</h2>

      {rec && (
      <Card>
        <CardHeader>
          <CardTitle>
            {rec.recommended && rec.recommended !== 'free_evaluation'
              ? `We suggest: ${PRODUCT_TITLES[rec.recommended]}${rec.optional ? ' (optional)' : ''}`
              : 'What we suggest'}
          </CardTitle>
          <CardDescription>This is a suggestion based on the facts you confirmed. You can choose differently.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {rec.reasons.map((reason) => <p key={reason}>{reason}</p>)}
          {rec.guidance.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {rec.guidance.map((g) => <li key={g}>{g}</li>)}
            </ul>
          )}
          {rec.deadline && (
            <p className={rec.deadline.soon ? 'font-semibold text-destructive' : 'font-medium'}>
              File with FIDReC by {formatDate(rec.deadline.date)} (six months after your bank’s final reply)
              {rec.deadline.soon ? `: only ${rec.deadline.daysLeft} days left.` : '.'}
            </p>
          )}
          {rec.notes.map((note) => <p key={note} className="text-muted-foreground">{note}</p>)}
        </CardContent>
      </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => {
          const note = ruleNote(stateOf(card.product))
          const done = joined[card.product]
          return (
            <Card key={card.product}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{PRODUCT_TITLES[card.product]} · {card.price}</CardTitle>
                  {!paidStages.enabled && <Badge variant="secondary">Available shortly</Badge>}
                </div>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{card.detail}</p>
                {note ? (
                  <p className="text-muted-foreground">{note}</p>
                ) : card.product === 'fidrec_pack' ? (
                  <p className="text-muted-foreground">{FIDREC_TIMING}</p>
                ) : null}
                <p className="text-muted-foreground">{CONSULTATION}</p>
                {!paidStages.enabled && (
                  done ? (
                    <p role="status">Thank you. We’ll email {done} when it’s available.</p>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        disabled={join.isPending}
                        onClick={() =>
                          join.mutate(card.product, { onSuccess: (r) => setJoined((prev) => ({ ...prev, [r.product]: r.email })) })
                        }
                      >
                        Email me when it’s available
                      </Button>
                      {join.isError && join.variables === card.product && (
                        <p role="alert" className="text-destructive">We couldn’t save that. Please try again.</p>
                      )}
                    </>
                  )
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
