'use client'

import { useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { NarrativeCapture } from '@/components/landing/narrative-capture'
import { FidrecTimelineForm, FidrecWaiting } from '@/components/state-machine/facts/fidrec-timeline'
import type { FidrecPackCheck } from '@/lib/facts'
import { fidrecTimelineCheck, singaporeToday, type FidrecTimeline } from '@/lib/journey/fidrec-timeline'
import { saveFidrecTimeline } from '@/lib/journey/save-fidrec-timeline'

export function NewCaseSteps({ timelineCaseId }: { timelineCaseId: string | null }) {
  const { getToken } = useAuth()
  const [check, setCheck] = useState<FidrecPackCheck | null>(null)

  async function save(timeline: FidrecTimeline) {
    await saveFidrecTimeline(timelineCaseId!, timeline, getToken)
    setCheck(fidrecTimelineCheck(timeline, singaporeToday()))
  }

  if (timelineCaseId && !check) return <FidrecTimelineForm initial={null} onSave={save} />

  return (
    <div className="space-y-5">
      {check ? <FidrecWaiting check={check} /> : null}
      <NarrativeCapture variant="case" />
    </div>
  )
}
