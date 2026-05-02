'use client'

/**
 * Layer 1 gap-question loop. Renders normalized validation gaps from
 * `v_case_validation_gap_items`, with `questions_to_user` JSON as fallback.
 */

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import {
  isAnsweredValidationValue,
  normalizeAnswerOptions,
} from '@/lib/validation-gaps'
import type { ValidationAnswerValue, ValidationQuestion } from '@/lib/types/validation'

export interface GapQuestionPanelProps {
  questions: ValidationQuestion[]
  isSubmitting?: boolean
  errorMessage?: string | null
  onSave: (answers: Record<string, ValidationAnswerValue>) => void
  /** Optional copy that sits above the question list and explains why we're asking. */
  intro?: string
}

export function GapQuestionPanel({
  questions,
  isSubmitting = false,
  errorMessage,
  onSave,
  intro,
}: GapQuestionPanelProps) {
  const [answers, setAnswers] = useState<Record<string, ValidationAnswerValue>>({})

  function setAnswer(key: string, value: ValidationAnswerValue) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  function toggleMultiAnswer(key: string, optionValue: string, checked: boolean) {
    setAnswers((prev) => {
      const current = Array.isArray(prev[key]) ? prev[key] : []
      return {
        ...prev,
        [key]: checked
          ? Array.from(new Set([...current, optionValue]))
          : current.filter((value) => value !== optionValue),
      }
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    const nonEmpty = Object.fromEntries(
      Object.entries(answers).filter(([, value]) => isAnsweredValidationValue(value)),
    ) as Record<string, ValidationAnswerValue>
    onSave(nonEmpty)
  }

  if (questions.length === 0) {
    if (!errorMessage) return null

    return (
      <Card>
        <CardHeader>
          <CardTitle>Validation needs attention</CardTitle>
          <CardDescription>
            We could not prepare the follow-up questions for this case.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>A few more details</CardTitle>
        <CardDescription>
          {intro ??
            "We need a few more details to finish your free triage. Answer what you can - you can come back and add more later."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          {questions.map((q, index) => {
            const fieldId = `gap-${q.key || index}`
            const answerType = typeof q.field_type === 'string' ? q.field_type : 'text'
            const choices = normalizeAnswerOptions(q.options)
            const currentAnswer = answers[q.key]
            const textValue: string = typeof currentAnswer === 'string' ? currentAnswer : ''
            const multiValue: string[] = Array.isArray(currentAnswer) ? currentAnswer : []
            const booleanValue = typeof currentAnswer === 'boolean' ? String(currentAnswer) : undefined
            const isLong =
              answerType === 'textarea' ||
              answerType === 'long_text' ||
              (q.question ?? '').length > 120
            const inputType =
              answerType === 'date'
                ? 'date'
                : answerType === 'datetime'
                  ? 'datetime-local'
                  : answerType === 'money' || answerType === 'number'
                    ? 'number'
                    : 'text'

            return (
              <div key={fieldId} className="space-y-2">
                <Label htmlFor={fieldId}>
                  {q.question}
                  {q.required ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>
                {q.help_text ? (
                  <p className="text-sm text-muted-foreground">{q.help_text}</p>
                ) : null}

                {answerType === 'file_upload' ? (
                  <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                    Upload supporting evidence in the evidence step.
                  </p>
                ) : answerType === 'boolean' ? (
                  <RadioGroup
                    value={booleanValue}
                    onValueChange={(value) => setAnswer(q.key, value === 'true')}
                    disabled={isSubmitting}
                    className="grid grid-cols-2 gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id={`${fieldId}-yes`} value="true" />
                      <Label htmlFor={`${fieldId}-yes`} className="font-normal">
                        Yes
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id={`${fieldId}-no`} value="false" />
                      <Label htmlFor={`${fieldId}-no`} className="font-normal">
                        No
                      </Label>
                    </div>
                  </RadioGroup>
                ) : answerType === 'single_choice' && choices.length > 0 ? (
                  <RadioGroup
                    value={textValue || undefined}
                    onValueChange={(value) => setAnswer(q.key, value)}
                    disabled={isSubmitting}
                  >
                    {choices.map((option, optionIndex) => {
                      const optionId = `${fieldId}-option-${optionIndex}`
                      return (
                        <div key={option.value} className="flex items-center gap-2">
                          <RadioGroupItem id={optionId} value={option.value} />
                          <Label htmlFor={optionId} className="font-normal">
                            {option.label}
                          </Label>
                        </div>
                      )
                    })}
                  </RadioGroup>
                ) : answerType === 'multi_choice' && choices.length > 0 ? (
                  <div className="space-y-3">
                    {choices.map((option, optionIndex) => {
                      const optionId = `${fieldId}-option-${optionIndex}`
                      return (
                        <div key={option.value} className="flex items-center gap-2">
                          <Checkbox
                            id={optionId}
                            checked={multiValue.includes(option.value)}
                            onCheckedChange={(checked) =>
                              toggleMultiAnswer(q.key, option.value, checked === true)
                            }
                            disabled={isSubmitting}
                          />
                          <Label htmlFor={optionId} className="font-normal">
                            {option.label}
                          </Label>
                        </div>
                      )
                    })}
                  </div>
                ) : isLong ? (
                  <Textarea
                    id={fieldId}
                    value={textValue}
                    onChange={(event) => setAnswer(q.key, event.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                  />
                ) : (
                  <Input
                    id={fieldId}
                    type={inputType}
                    inputMode={answerType === 'money' || answerType === 'number' ? 'decimal' : undefined}
                    step={answerType === 'money' ? '0.01' : answerType === 'number' ? 'any' : undefined}
                    value={textValue}
                    onChange={(event) => setAnswer(q.key, event.target.value)}
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
