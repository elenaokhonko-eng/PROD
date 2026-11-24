'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmFactsPanel } from '@/components/state-machine/facts/confirm-facts-panel'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { FactsRequestError } from '@/hooks/state-machine/facts/use-case-facts'
import { useGenerateFreeEvaluation } from '@/hooks/state-machine/facts/use-generate-free-evaluation'
import type { Stage } from '@/lib/facts'
import { DeviceConfirmation } from './device-confirmation'

export default function FactsClient({ caseId, stage }: { caseId: string; stage: Stage }) {
  const router = useRouter()
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const generate = useGenerateFreeEvaluation(caseId)

  if (generate.isPending) {
    return (
      <StateMachineLoading
        title="Preparing your free evaluation"
        description="We're writing it from the facts you confirmed. This usually takes under a minute."
      />
    )
  }

  if (snapshotId) {
    const failed = generate.error instanceof FactsRequestError ? generate.error : null
    return (
      <Card>
        <CardHeader>
          <CardTitle>Thank you, your facts are confirmed</CardTitle>
          <CardDescription>
            We’ll use exactly these facts. If you change your story, your answers or your documents, we’ll ask you to
            check again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {failed.reason === 'facts_unconfirmed'
                ? 'Your facts changed since you confirmed them. Please check them again.'
                : failed.reason === 'output_validation_failed'
                  ? 'We couldn’t produce a reliable evaluation from these facts. We’ve been notified; please try again later.'
                  : 'Something went wrong. Please try again.'}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {stage === 'free' && (
              <Button
                onClick={() =>
                  generate.mutate(snapshotId, { onSuccess: () => router.push(`/app/case/${caseId}/dashboard`) })
                }
              >
                Get my free evaluation
              </Button>
            )}
            {failed?.reason === 'facts_unconfirmed' ? (
              <Button variant="outline" onClick={() => setSnapshotId(null)}>Check my facts again</Button>
            ) : (
              <Button variant="outline" asChild>
                <Link href={`/app/case/${caseId}/dashboard`}>Back to your case</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // The paid stages ask about the devices in the institution's records first; the panel counts that answer as one of
  // the facts left to check.
  return (
    <div className="space-y-6">
      {stage !== 'free' && <DeviceConfirmation caseId={caseId} stage={stage} />}
      <ConfirmFactsPanel caseId={caseId} stage={stage} onConfirmed={setSnapshotId} />
    </div>
  )
}
