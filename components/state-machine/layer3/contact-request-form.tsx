'use client'

/**
 * Layer 3 node `L3-contact-request-form` (SM Diagram 4 / IS §9.9 + §10.5).
 *
 * The "Escalation Pack" is not shipped; this in-app, auto-filled form
 * captures everything a specialist needs to triage the case. All visible
 * fields are editable. `case_id` is hidden, and `user_id` is injected
 * server-side (column default is `auth.uid()` per §10.5).
 *
 * On submit, the parent POSTs to `/api/contact-requests` (Slice 5.3).
 * This component is pure presentational — no fetch inside it.
 */

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { StateMachineLoading } from '@/components/state-machine/loading-state'

export interface ContactRequestFormValues {
  first_name: string
  last_name: string
  email: string
  phone: string
  age: string
  employment_status: 'professional' | 'retiree' | 'student' | 'other'
  thirty_days_since_last_fi_reply: boolean
  fi_issued_final_response: boolean
  message: string
}

export interface ContactRequestFormProps {
  caseId: string
  initialValues?: Partial<ContactRequestFormValues>
  isSubmitting?: boolean
  errorMessage?: string | null
  onSubmit: (values: ContactRequestFormValues & { case_id: string }) => void
}

const EMPLOYMENT_STATUSES: Array<ContactRequestFormValues['employment_status']> = [
  'professional',
  'retiree',
  'student',
  'other',
]

export function ContactRequestForm({
  caseId,
  initialValues,
  isSubmitting = false,
  errorMessage,
  onSubmit,
}: ContactRequestFormProps) {
  const [values, setValues] = useState<ContactRequestFormValues>({
    first_name: initialValues?.first_name ?? '',
    last_name: initialValues?.last_name ?? '',
    email: initialValues?.email ?? '',
    phone: initialValues?.phone ?? '',
    age: initialValues?.age ?? '',
    employment_status: initialValues?.employment_status ?? 'professional',
    thirty_days_since_last_fi_reply: initialValues?.thirty_days_since_last_fi_reply ?? false,
    fi_issued_final_response: initialValues?.fi_issued_final_response ?? false,
    message: initialValues?.message ?? '',
  })

  function setField<K extends keyof ContactRequestFormValues>(key: K, value: ContactRequestFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    onSubmit({ ...values, case_id: caseId })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request specialist support</CardTitle>
        <CardDescription>
          Tell us where you are in the complaint process. Submission records a request only; it does not include a response-time commitment.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="first_name" label="First name" required>
              <Input
                id="first_name"
                value={values.first_name}
                onChange={(e) => setField('first_name', e.target.value)}
                required
                disabled={isSubmitting}
              />
            </Field>
            <Field id="last_name" label="Last name" required>
              <Input
                id="last_name"
                value={values.last_name}
                onChange={(e) => setField('last_name', e.target.value)}
                required
                disabled={isSubmitting}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="email" label="Email" required>
              <Input
                id="email"
                type="email"
                value={values.email}
                onChange={(e) => setField('email', e.target.value)}
                required
                disabled={isSubmitting}
              />
            </Field>
            <Field id="phone" label="Phone" required>
              <Input
                id="phone"
                type="tel"
                value={values.phone}
                onChange={(e) => setField('phone', e.target.value)}
                required
                disabled={isSubmitting}
                placeholder="+65 9123 4567"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="age" label="Age" required>
              <Input
                id="age"
                type="number"
                min={13}
                max={120}
                value={values.age}
                onChange={(e) => setField('age', e.target.value)}
                required
                disabled={isSubmitting}
              />
            </Field>
            <Field id="employment_status" label="Employment status" required>
              <select
                id="employment_status"
                value={values.employment_status}
                onChange={(e) =>
                  setField('employment_status', e.target.value as ContactRequestFormValues['employment_status'])
                }
                disabled={isSubmitting}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {EMPLOYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <BooleanField
            id="thirty_days_since_last_fi_reply"
            label="Has it been at least 30 days since the FI's last reply?"
            checked={values.thirty_days_since_last_fi_reply}
            onCheckedChange={(checked) => setField('thirty_days_since_last_fi_reply', checked)}
            disabled={isSubmitting}
          />

          <BooleanField
            id="fi_issued_final_response"
            label="Has the FI issued a final response?"
            checked={values.fi_issued_final_response}
            onCheckedChange={(checked) => setField('fi_issued_final_response', checked)}
            disabled={isSubmitting}
          />

          <Field id="message" label="Anything else we should know? (optional)">
            <Input
              id="message"
              value={values.message}
              onChange={(e) => setField('message', e.target.value)}
              disabled={isSubmitting}
              placeholder="Brief context for this request"
            />
          </Field>

          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            {isSubmitting ? (
              <StateMachineLoading size="inline" title="Submitting..." />
            ) : null}
            <Button type="submit" disabled={isSubmitting} size="lg">
              Submit request
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  )
}

function BooleanField({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">Required</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  )
}
