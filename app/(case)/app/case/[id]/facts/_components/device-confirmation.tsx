'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FactsRequestError, useCaseFacts, useResolveFinding, type FactsView } from '@/hooks/state-machine/facts/use-case-facts'
import type { Stage } from '@/lib/facts'
import {
  allAnswered,
  DEVICE_ANSWER_OPTIONS,
  DEVICE_SCREEN_TEXT as TEXT,
  devicePayload,
  deviceRows,
  initialAnswers,
} from './device-answers'

// "Is this one of your devices?" (brief v5, 3b). Shown only for the paid stages, and only when an uploaded record of
// the institution lists a device. Each answer is printed in the packs as what the complainant states.
export function DeviceConfirmation({ caseId, stage }: { caseId: string; stage: Stage }) {
  const facts = useCaseFacts(caseId, stage)
  const view = facts.data && !('inProgress' in facts.data) ? (facts.data as FactsView) : null
  const step = view?.devices ?? null
  if (!step) return null
  // Remount when the device list or the saved answers change, so the form starts from the server's state.
  return <DeviceForm key={`${step.findingId}:${step.status}`} caseId={caseId} stage={stage} step={step} />
}

function DeviceForm({ caseId, stage, step }: { caseId: string; stage: Stage; step: NonNullable<FactsView['devices']> }) {
  const resolve = useResolveFinding(caseId, stage)
  const [answers, setAnswers] = useState(() => initialAnswers(step.devices, step.answers))
  const [editing, setEditing] = useState(step.status === 'open')
  const [tried, setTried] = useState(false)
  const rows = deviceRows(step.devices)
  const complete = allAnswered(step.devices, answers)

  function save() {
    setTried(true)
    if (!complete) return
    resolve.mutate(
      { findingId: step.findingId, resolution: { kind: 'value', value: devicePayload(step.devices, answers) } },
      { onSuccess: () => setEditing(false) },
    )
  }

  const error = resolve.isError
    ? resolve.error instanceof FactsRequestError && resolve.error.reason === 'finding_outdated' ? TEXT.outdated : TEXT.failed
    : null

  return (
    <Card data-device-confirmation>
      <CardHeader>
        <CardTitle>{TEXT.title}</CardTitle>
        <CardDescription>{TEXT.intro}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => (
          <fieldset key={row.key} className="space-y-2 rounded-lg border p-4" disabled={!editing || resolve.isPending}>
            <legend className="px-1 font-medium">{row.name}</legend>
            {row.firstSeen && (
              <p className="text-sm text-muted-foreground">
                {TEXT.firstSeen} {row.firstSeen}
              </p>
            )}
            {row.reference && (
              <p className="break-all text-sm text-muted-foreground">
                {TEXT.reference} {row.reference}
              </p>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-2" role="radiogroup" aria-label={row.name}>
              {DEVICE_ANSWER_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`device-${row.key}`}
                    value={option.value}
                    checked={answers[row.key] === option.value}
                    onChange={() => setAnswers((prev) => ({ ...prev, [row.key]: option.value }))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {tried && !complete && <p role="alert" className="text-sm text-destructive">{TEXT.answerEach}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {editing ? (
          <Button onClick={save} disabled={resolve.isPending}>{resolve.isPending ? TEXT.saving : TEXT.save}</Button>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p aria-live="polite" className="text-sm">{TEXT.saved}</p>
            <Button variant="outline" onClick={() => setEditing(true)}>{TEXT.change}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
