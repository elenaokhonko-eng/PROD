'use client'

/**
 * C5: the confirm-your-facts step inside the dashboard flow. Once the facts are confirmed, the free evaluation is
 * generated from that snapshot; when it exists the dashboard moves on to the evaluation by itself.
 */

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmFactsPanel } from '@/components/state-machine/facts/confirm-facts-panel'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { FactsRequestError } from '@/hooks/state-machine/facts/use-case-facts'
import { useGenerateFreeEvaluation } from '@/hooks/state-machine/facts/use-generate-free-evaluation'

export function ConfirmAndEvaluate({ caseId, readyDocumentsKey }: { caseId: string; readyDocumentsKey: string }) {
  const generate = useGenerateFreeEvaluation(caseId)
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const lastDocumentsKey = useRef(readyDocumentsKey)

  // A document added or finished while confirming changes the facts: check them again.
  useEffect(() => {
    if (lastDocumentsKey.current === readyDocumentsKey) return
    lastDocumentsKey.current = readyDocumentsKey
    void queryClient.invalidateQueries({ queryKey: qk.case.facts(caseId, 'free') })
  }, [caseId, queryClient, readyDocumentsKey])

  if (generate.isPending) {
    return (
      <StateMachineLoading
        title="Preparing your free evaluation"
        description="We’re writing it from the facts you confirmed. This usually takes under a minute."
      />
    )
  }

  if (snapshotId && generate.isError) {
    const reason = generate.error instanceof FactsRequestError ? generate.error.reason : null
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>We couldn’t prepare your free evaluation</CardTitle>
          <CardDescription>
            {reason === 'facts_unconfirmed'
              ? 'Your facts changed since you confirmed them. Please check them again.'
              : reason === 'output_validation_failed'
                ? 'We couldn’t produce an evaluation that matches your facts exactly. We’ve been notified; please try again later.'
                : 'Something went wrong. Your answers are saved; please try again.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {reason === 'facts_unconfirmed' ? (
            <Button onClick={() => { generate.reset(); setSnapshotId(null) }}>Check my facts again</Button>
          ) : (
            <Button onClick={() => generate.mutate(snapshotId)}>Try again</Button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Next: confirm your facts</h1>
        <p className="text-muted-foreground">
          We’ll prepare your free evaluation from the facts you confirm here.
        </p>
      </div>
      <ConfirmFactsPanel
        caseId={caseId}
        stage="free"
        onConfirmed={(id) => {
          setSnapshotId(id)
          generate.mutate(id)
        }}
      />
    </div>
  )
}
