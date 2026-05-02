'use client'

/**
 * Layer 1 gap-question loop. State Machine nodes `GL-Idle` /
 * `GL-AnsweringGap` / `GL-Submitting`.
 *
 * Reads `questions_to_user` from a `case_validation_runs` row (fetched via
 * the two-step read in `use-validation-run.ts`, Slice 4A) and renders one
 * input per question. On submit, calls `onSave(answers)`. Backend then
 * re-fires `run_case_extract_v4` and a fresh validation row lands.
 *
 * Pure presentational.
 */

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import type { ValidationQuestion } from '@/lib/types/validation'

export interface GapQuestionPanelProps {
  questions: ValidationQuestion[]
  isSubmitting?: boolean
  errorMessage?: string | null
  onSave: (answers: Record<string, string>) => void
  /** Optional copy that sits above the question list — explains why we're asking. */
  intro?: string
}

export function GapQuestionPanel({
  questions,
  isSubmitting = false,
  errorMessage,
  onSave,
  intro,
}: GapQuestionPanelProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})

  function setAnswer(key: string, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    const nonEmpty = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => v && v.trim().length > 0),
    )
    onSave(nonEmpty)
  }

  if (questions.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>A few more details</CardTitle>
        <CardDescription>
          {intro ??
            "We need a few more details to finish your free triage. Answer what you can — you can come back and add more later."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          {questions.map((q, index) => {
            const fieldId = `gap-${q.key ?? index}`
            const isLong =
              q.field_type === 'textarea' ||
              q.field_type === 'long_text' ||
              (q.question ?? '').length > 120

            return (
              <div key={fieldId} className="space-y-2">
                <Label htmlFor={fieldId}>
                  {q.question}
                  {q.required ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>
                {isLong ? (
                  <Textarea
                    id={fieldId}
                    value={answers[q.key] ?? ''}
                    onChange={(e) => setAnswer(q.key, e.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                  />
                ) : (
                  <Input
                    id={fieldId}
                    value={answers[q.key] ?? ''}
                    onChange={(e) => setAnswer(q.key, e.target.value)}
                    disabled={isSubmitting}
                  />
                )}
              </div>
            )
          })}

          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            {isSubmitting ? (
              <StateMachineLoading size="inline" title="Re-analysing with your answers..." />
            ) : null}
            <Button type="submit" disabled={isSubmitting}>
              Save answers
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
