'use client'

/**
 * Layer 3 node `L3-waitlist-form` (SM Diagram 4 / IS §9.9 + §10.5).
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
import { StateMachineLoading } from '@/components/state-machine/loading-state'

export interface WaitlistFormValues {
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

export interface WaitlistFormProps {
  caseId: string
  initialValues?: Partial<WaitlistFormValues>
  isSubmitting?: boolean
  errorMessage?: string | null
  onSubmit: (values: WaitlistFormValues & { case_id: string }) => void
}

const EMPLOYMENT_STATUSES: Array<WaitlistFormValues['employment_status']> = [
  'professional',
  'retiree',
  'student',
  'other',
]

export function WaitlistForm({
  caseId,
  initialValues,
  isSubmitting = false,
  errorMessage,
  onSubmit,
}: WaitlistFormProps) {
  const [values, setValues] = useState<WaitlistFormValues>({
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

  function setField<K extends keyof WaitlistFormValues>(key: K, value: WaitlistFormValues[K]) {
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
          Tell us where you are in the bank complaint process. We will follow up within one business
          day.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <Input
                value={values.first_name}
                onChange={(e) => setField('first_name', e.target.value)}
                required
                disabled={isSubmitting}
              />
            </Field>
            <Field label="Last name" required>
              <Input
                value={values.last_name}
                onChange={(e) => setField('last_name', e.target.value)}
                required
                disabled={isSubmitting}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" required>
              <Input
                type="email"
                value={values.email}
                onChange={(e) => setField('email', e.target.value)}
                required
                disabled={isSubmitting}
              />
            </Field>
            <Field label="Phone" required>
              <Input
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
            <Field label="Age" required>
              <Input
                type="number"
                min={13}
                max={120}
                value={values.age}
                onChange={(e) => setField('age', e.target.value)}
                required
                disabled={isSubmitting}
              />
            </Field>
            <Field label="Employment status" required>
              <select
                value={values.employment_status}
                onChange={(e) =>
                  setField('employment_status', e.target.value as WaitlistFormValues['employment_status'])
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

          <Field label="Has it been at least 30 days since the FI's last reply?" required>
            <div className="flex gap-3">
              <Button
                type="button"
                variant={values.thirty_days_since_last_fi_reply ? 'default' : 'outline'}
                onClick={() => setField('thirty_days_since_last_fi_reply', true)}
                disabled={isSubmitting}
              >
                Yes
              </Button>
              <Button
                type="button"
                variant={!values.thirty_days_since_last_fi_reply ? 'default' : 'outline'}
                onClick={() => setField('thirty_days_since_last_fi_reply', false)}
                disabled={isSubmitting}
              >
                No
              </Button>
            </div>
          </Field>

          <Field label="Has the FI issued a final response?" required>
            <div className="flex gap-3">
              <Button
                type="button"
                variant={values.fi_issued_final_response ? 'default' : 'outline'}
                onClick={() => setField('fi_issued_final_response', true)}
                disabled={isSubmitting}
              >
                Yes
              </Button>
              <Button
                type="button"
                variant={!values.fi_issued_final_response ? 'default' : 'outline'}
                onClick={() => setField('fi_issued_final_response', false)}
                disabled={isSubmitting}
              >
                No
              </Button>
            </div>
          </Field>

          <Field label="Anything else we should know? (optional)">
            <Input
              value={values.message}
              onChange={(e) => setField('message', e.target.value)}
              disabled={isSubmitting}
              placeholder="Brief context for our specialist"
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
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  )
}
