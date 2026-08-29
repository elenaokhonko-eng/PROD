'use client'

/**
 * Layer 1 (Tier 0) intake form. State Machine node `S1-IntakeForm` → `S1-Submitting`.
 *
 * Pure presentational — accepts initial values and an `onSubmit` callback,
 * owns only transient form state. No data-fetching here (that comes from
 * `useSubmitIntake` in Slice 4A).
 *
 * The seven intake fields mirror the existing dashboard intake (see
 * `app/app/case/[id]/dashboard/_components/dashboard-client.tsx` line 19) so
 * the backend's `run_case_extract_v4` continues to find the keys it expects.
 */

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { StateMachineLoading } from '@/components/state-machine/loading-state'

export type IntakeFieldKey =
  | 'institution_name'
  | 'account_details'
  | 'incident_summary'
  | 'financial_impact'
  | 'desired_outcome'
  | 'previous_contact'
  | 'contact_details'

interface IntakeField {
  key: IntakeFieldKey
  question: string
  type: 'text' | 'textarea' | 'radio'
  required: boolean
  placeholder?: string
  options?: readonly string[]
  showIf?: { key: IntakeFieldKey; value: string }
}

export const INTAKE_FIELDS: readonly IntakeField[] = [
  {
    key: 'institution_name',
    question: 'What is the name of the financial institution?',
    type: 'text',
    required: true,
    placeholder: 'e.g., DBS Bank, OCBC Bank, Great Eastern',
  },
  {
    key: 'account_details',
    question: 'What are your account / policy details?',
    type: 'textarea',
    required: true,
    placeholder: 'Account number, policy number, or other identifiers',
  },
  {
    key: 'incident_summary',
    question: 'Describe what happened in detail',
    type: 'textarea',
    required: true,
    placeholder:
      'A chronological account of events, including dates, amounts, and key interactions',
  },
  {
    key: 'financial_impact',
    question: 'What is the financial impact?',
    type: 'textarea',
    required: true,
    placeholder: 'Losses, damages, or financial harm you have experienced',
  },
  {
    key: 'desired_outcome',
    question: 'What outcome are you seeking?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., reversal of charges, a written response, or policy reinstatement',
  },
  {
    key: 'previous_contact',
    question: 'Have you contacted the institution about this issue?',
    type: 'radio',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    key: 'contact_details',
    question: 'Describe your previous contact attempts',
    type: 'textarea',
    required: false,
    placeholder: 'When did you contact them? What was their response?',
    showIf: { key: 'previous_contact', value: 'Yes' },
  },
] as const
export type IntakeAnswers = Partial<Record<IntakeFieldKey, string>>

export interface IntakeFormProps {
  initialAnswers?: IntakeAnswers
  isSubmitting?: boolean
  submitLabel?: string
  errorMessage?: string | null
  onSubmit: (answers: IntakeAnswers) => void
}

export function IntakeForm({
  initialAnswers,
  isSubmitting = false,
  submitLabel = 'Continue',
  errorMessage,
  onSubmit,
}: IntakeFormProps) {
  const [answers, setAnswers] = useState<IntakeAnswers>(initialAnswers ?? {})

  function setField(key: IntakeFieldKey, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    onSubmit(answers)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tell us about your complaint</CardTitle>
        <CardDescription>
          A few questions so we can understand the case. This is the free triage — no charge.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={handleSubmit} noValidate>
          {INTAKE_FIELDS.map((field) => {
            if (field.showIf) {
              const dep = answers[field.showIf.key as IntakeFieldKey]
              if (dep !== field.showIf.value) return null
            }

            const value = answers[field.key] ?? ''
            const fieldId = `intake-${field.key}`

            return (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={fieldId}>
                  {field.question}
                  {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>

                {field.type === 'text' ? (
                  <Input
                    id={fieldId}
                    value={value}
                    required={field.required}
                    placeholder={'placeholder' in field ? field.placeholder : undefined}
                    onChange={(e) => setField(field.key, e.target.value)}
                    disabled={isSubmitting}
                  />
                ) : null}

                {field.type === 'textarea' ? (
                  <Textarea
                    id={fieldId}
                    value={value}
                    required={field.required}
                    placeholder={'placeholder' in field ? field.placeholder : undefined}
                    onChange={(e) => setField(field.key, e.target.value)}
                    disabled={isSubmitting}
                    rows={4}
                  />
                ) : null}

                {field.type === 'radio' && 'options' in field ? (
                  <RadioGroup
                    value={value}
                    onValueChange={(v) => setField(field.key, v)}
                    className="flex gap-4"
                  >
                    {field.options.map((opt) => (
                      <label
                        key={opt}
                        className="flex items-center gap-2 text-sm"
                        htmlFor={`${fieldId}-${opt}`}
                      >
                        <RadioGroupItem value={opt} id={`${fieldId}-${opt}`} />
                        {opt}
                      </label>
                    ))}
                  </RadioGroup>
                ) : null}
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
              <StateMachineLoading size="inline" title="Analysing your story..." />
            ) : null}
            <Button type="submit" disabled={isSubmitting} size="lg">
              {submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
