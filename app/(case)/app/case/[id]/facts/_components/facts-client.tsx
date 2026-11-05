'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmFactsPanel } from '@/components/state-machine/facts/confirm-facts-panel'
import type { Stage } from '@/lib/facts'

export default function FactsClient({ caseId, stage }: { caseId: string; stage: Stage }) {
  const [confirmed, setConfirmed] = useState(false)

  if (confirmed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Thank you, your facts are confirmed</CardTitle>
          <CardDescription>
            We’ll use exactly these facts. If you change your story, your answers or your documents, we’ll ask you to
            check again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/app/case/${caseId}/dashboard`}>Back to your case</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return <ConfirmFactsPanel caseId={caseId} stage={stage} onConfirmed={() => setConfirmed(true)} />
}
