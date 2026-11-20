'use client'

/**
 * C5: the confirm-your-facts step inside the dashboard flow. Once the facts are confirmed, the stage's output is
 * generated from that snapshot (the free evaluation, or the bank pack after payment); when it exists the dashboard
 * moves on to it by itself.
 */

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmFactsPanel } from '@/components/state-machine/facts/confirm-facts-panel'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { FactsRequestError } from '@/hooks/state-machine/facts/use-case-facts'
import { type GeneratedStage, useGenerateStage } from '@/hooks/state-machine/facts/use-generate-free-evaluation'
import { openProblemReport } from '@/lib/report-problem'

// The paid packs' wording is pending Elena's approval (stage 2 copy list, 20 Nov 2026).
const COPY: Record<GeneratedStage, { preparing: string; failed: string; failedReason: string; problem: string }> = {
  free: {
    preparing: 'Preparing your free evaluation',
    failed: 'We couldn’t prepare your free evaluation',
    failedReason: 'We couldn’t produce an evaluation that matches your facts exactly. We’ve been notified; please try again later.',
    problem: 'free_evaluation_failed',
  },
  bank: {
    preparing: 'Preparing your bank dispute pack',
    failed: 'We couldn’t prepare your bank dispute pack',
    failedReason: 'We couldn’t produce a bank dispute pack that matches your facts exactly. We’ve been notified; please try again later.',
    problem: 'bank_pack_failed',
  },
  fidrec: {
    preparing: 'Preparing your FIDReC pack',
    failed: 'We couldn’t prepare your FIDReC pack',
    failedReason: 'We couldn’t produce a FIDReC pack that matches your facts exactly. We’ve been notified; please try again later.',
    problem: 'fidrec_pack_failed',
  },
}

// Decision 7: the confirmed facts don't open a route to FIDReC today, so nothing is generated (and nothing charged again).
const ROUTE_CLOSED: Record<string, string> = {
  fidrec_too_early:
    'Your confirmed facts show FIDReC can’t take the complaint yet: it opens four weeks after your written complaint to the bank. Check the dates in your facts, or come back then.',
  fidrec_window_expired:
    'Your confirmed facts show more than six months have passed since your bank’s final reply. Ask your bank to review your complaint again; a new final reply may start a new six-month window.',
  complaint_not_raised:
    'Your confirmed facts don’t show a written complaint to your bank yet. FIDReC needs one first: complain to your bank in writing, then come back.',
}

export function ConfirmAndEvaluate({
  caseId,
  readyDocumentsKey,
  stage = 'free',
}: {
  caseId: string
  readyDocumentsKey: string
  stage?: GeneratedStage
}) {
  const generate = useGenerateStage(caseId, stage)
  const copy = COPY[stage]
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const lastDocumentsKey = useRef(readyDocumentsKey)

  // A document added or finished while confirming changes the facts: check them again.
  useEffect(() => {
    if (lastDocumentsKey.current === readyDocumentsKey) return
    lastDocumentsKey.current = readyDocumentsKey
    void queryClient.invalidateQueries({ queryKey: qk.case.facts(caseId, stage) })
  }, [caseId, queryClient, readyDocumentsKey, stage])

  if (generate.isPending) {
    return (
      <StateMachineLoading
        title={copy.preparing}
        description="We’re writing it from the facts you confirmed. This usually takes under a minute."
      />
    )
  }

  if (snapshotId && generate.isError) {
    const reason = generate.error instanceof FactsRequestError ? generate.error.reason : null
    const checks = generate.error instanceof FactsRequestError ? generate.error.checks : []
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>{copy.failed}</CardTitle>
          <CardDescription>
            {reason === 'facts_unconfirmed'
              ? 'Your facts changed since you confirmed them. Please check them again.'
              : reason && ROUTE_CLOSED[reason]
                ? ROUTE_CLOSED[reason]
                : reason === 'usage_limit'
                ? generate.error.message
                : reason === 'output_validation_failed'
                ? copy.failedReason
                : 'Something went wrong. Your answers are saved; please try again.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {reason === 'facts_unconfirmed' ? (
            <Button onClick={() => { generate.reset(); setSnapshotId(null) }}>Check my facts again</Button>
          ) : (
            <Button onClick={() => generate.mutate(snapshotId)}>Try again</Button>
          )}
          {/* Elena, 7 Nov: the report carries the failed check names so the cause can be found. */}
          <Button variant="outline" onClick={() => openProblemReport(reason ?? copy.problem, checks.map((c) => `check: ${c}`))}>
            Report this problem
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Finding A9: this is the main step, not a neutral card. */}
      <section className="space-y-2 rounded-xl border-2 border-primary bg-primary/5 p-5">
        <h1 className="text-2xl font-semibold">Confirm your facts</h1>
        <p>
          GuideBuoy can only point you to the right resolution path, and give you correct guidance, if the facts are
          consistent. Please check each one; it takes a few minutes.
        </p>
      </section>
      <ConfirmFactsPanel
        caseId={caseId}
        stage={stage}
        showIntro={false}
        onConfirmed={(id) => {
          setSnapshotId(id)
          generate.mutate(id)
        }}
      />
    </div>
  )
}
