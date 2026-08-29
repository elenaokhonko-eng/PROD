'use client'

/**
 * Layer 2 node `L2-ReportDrafting` (SM Diagram 3).
 *
 * Progress screen while the background worker is running
 * `run_report_selfserve_v1`. Transitions to `L2-ReportReady` when a
 * `reports` row with `status='COMPLETED'` lands via Realtime.
 */

import { BookOpen, FileText, ListChecks, type LucideIcon } from 'lucide-react'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { Card, CardContent } from '@/components/ui/card'
import type { DecisionJson } from '@/lib/types/decision'

const STEPS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: BookOpen, label: 'Drafting the executive summary' },
  { icon: ListChecks, label: 'Assembling your evidence checklist' },
  { icon: FileText, label: 'Writing the requested resolution' },
]

export interface ReportDraftingProps {
  decisionPreview?: DecisionJson | null
}

export function ReportDrafting(_props: ReportDraftingProps) {
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="space-y-6 p-6">
        <StateMachineLoading
          size="full"
          title="Preparing your automated report"
          description="You can leave this page and return to your case later."
          className="min-h-0"
        />

        <ul className="space-y-2" aria-label="Report preparation steps">
          {STEPS.map((step) => {
            const Icon = step.icon
            return (
              <li
                key={step.label}
                className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm text-muted-foreground"
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span>{step.label}</span>
              </li>
            )
          })}
        </ul>

        <p className="text-xs text-muted-foreground" role="note">
          Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
        </p>
      </CardContent>
    </Card>
  )
}
