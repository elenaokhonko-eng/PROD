'use client'

/**
 * Layer 2 node `L2-DecisionRunning` (SM Diagram 3).
 *
 * Status screen while the background worker runs `run_case_decision_v1`.
 * Realtime remains the authoritative transition signal.
 */

import { FileSearch, ListChecks, NotebookTabs, type LucideIcon } from 'lucide-react'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import { Card, CardContent } from '@/components/ui/card'

/** The processing stages are informational; Realtime controls transitions. */
const STEPS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: FileSearch, label: 'Reading your intake and evidence' },
  { icon: ListChecks, label: 'Checking the available information' },
  { icon: NotebookTabs, label: 'Preparing the report inputs' },
]

export function DecisionProgress() {
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="space-y-6 p-6">
        <StateMachineLoading
          size="full"
          title="Checking your case information"
          description="You can leave this page and return to your case later."
          className="min-h-0"
        />
        <ul className="space-y-2" aria-label="Case processing steps">
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
      </CardContent>
    </Card>
  )
}
