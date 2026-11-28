'use client'

/**
 * Journey questions (spec 4.1, design section 5): where the person is with their bank. Asked once, before the intake
 * form, in the free evaluation and in a pack bought without one. The answers are saved as `journey_*` case responses
 * and take part in fact checking.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { JOURNEY_KEYS } from '@/lib/facts'
import type { FidrecTimeline } from '@/lib/journey/fidrec-timeline'
import { journeyQuestionPlan } from '@/lib/journey/journey-plan'

export interface JourneyQuestionsProps {
  isSaving?: boolean
  errorMessage?: string | null
  onSave: (answers: Record<string, string>) => void
  /** A bought FIDReC pack's timeline, whose questions are not asked again. */
  timeline?: FidrecTimeline | null
}

type Choice = { value: string; label: string }

const YES_NO: Choice[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]
const YES_NO_UNSURE: Choice[] = [...YES_NO, { value: 'not sure', label: 'Not sure' }]
const REPLY: Choice[] = [
  { value: 'none', label: 'No reply yet' },
  { value: 'acknowledged', label: 'They acknowledged it only' },
  { value: 'interim', label: 'An interim reply' },
  { value: 'final_reply', label: 'A final reply' },
]
const OUTCOME: Choice[] = [
  { value: 'rejected', label: 'They rejected my claim' },
  { value: 'partial_offer', label: 'They offered part of the money' },
  { value: 'other', label: 'Something else' },
]
const CHANNELS: Choice[] = [
  { value: 'hotline', label: 'Phone hotline' },
  { value: 'app', label: 'Banking app' },
  { value: 'branch', label: 'In a branch' },
  { value: 'email', label: 'Email or online form' },
  { value: 'other', label: 'Other' },
]
const INSTITUTIONS: Choice[] = [
  { value: 'bank', label: 'A bank' },
  { value: 'ewallet', label: 'An e-wallet or payment app' },
  { value: 'telco', label: 'A mobile operator (the scam SMS came through it)' },
  { value: 'other', label: 'Something else' },
]

function Radios({ id, legend, choices, value, onChange }: { id: string; legend: string; choices: Choice[]; value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{legend}</legend>
      <RadioGroup value={value} onValueChange={onChange} aria-label={legend}>
        {choices.map((c) => (
          <div key={c.value} className="flex items-center gap-2">
            <RadioGroupItem value={c.value} id={`${id}-${c.value}`} />
            <Label htmlFor={`${id}-${c.value}`}>{c.label}</Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  )
}

function Field({ id, label, type = 'text', value, onChange }: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export function JourneyQuestions({ isSaving = false, errorMessage, onSave, timeline = null }: JourneyQuestionsProps) {
  const plan = journeyQuestionPlan(timeline)
  const [a, setA] = useState<Record<string, string>>(plan.initial)
  const [institutions, setInstitutions] = useState<string[]>([])
  const [missing, setMissing] = useState(false)
  const set = (key: string) => (value: string) => {
    setMissing(false)
    setA((prev) => ({ ...prev, [key]: value }))
  }

  const required = [
    JOURNEY_KEYS.reportedToBank,
    ...(plan.askComplaint ? [JOURNEY_KEYS.writtenComplaint] : []),
    ...(plan.askReply ? [JOURNEY_KEYS.bankReplyStatus] : []),
    JOURNEY_KEYS.policeReport,
    JOURNEY_KEYS.fidrecFiled,
  ]
  // Numbered as shown, so a question left out leaves no gap.
  const numberOf = (key: string) => (required as string[]).indexOf(key) + 1
  const replyIsFinal = plan.replyIsFinal || a[JOURNEY_KEYS.bankReplyStatus] === 'final_reply'

  function submit() {
    if (required.some((key) => !a[key])) {
      setMissing(true)
      return
    }
    const answers = Object.fromEntries(Object.entries(a).filter(([, v]) => v.trim()))
    if (institutions.length) answers[JOURNEY_KEYS.institutionTypes] = institutions.join(',')
    onSave(answers)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where are you with your bank?</CardTitle>
        <CardDescription>
          A few quick questions about what has happened since. They help us suggest the right next step. You can
          answer “Not sure” where you don’t know.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* No <form>: Radix controls inside one render unlabelled hidden inputs; Continue saves directly. */}
        <div className="space-y-6">
          <Radios id="journey-bank" legend={`${numberOf(JOURNEY_KEYS.reportedToBank)}. Have you told your bank or payment provider?`} choices={YES_NO} value={a[JOURNEY_KEYS.reportedToBank] ?? ''} onChange={set(JOURNEY_KEYS.reportedToBank)} />
          {a[JOURNEY_KEYS.reportedToBank] === 'yes' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="journey-bank-date" label="When? (optional)" type="date" value={a[JOURNEY_KEYS.reportedToBankDate] ?? ''} onChange={set(JOURNEY_KEYS.reportedToBankDate)} />
              <Radios id="journey-bank-channel" legend="How?" choices={CHANNELS} value={a[JOURNEY_KEYS.reportedToBankChannel] ?? ''} onChange={set(JOURNEY_KEYS.reportedToBankChannel)} />
              <Field id="journey-bank-ref" label="Bank's case or reference number (optional)" value={a[JOURNEY_KEYS.reportedToBankReference] ?? ''} onChange={set(JOURNEY_KEYS.reportedToBankReference)} />
            </div>
          )}

          {plan.askComplaint && (
            <Radios id="journey-complaint" legend={`${numberOf(JOURNEY_KEYS.writtenComplaint)}. Have you sent them a full written complaint with your evidence?`} choices={YES_NO_UNSURE} value={a[JOURNEY_KEYS.writtenComplaint] ?? ''} onChange={set(JOURNEY_KEYS.writtenComplaint)} />
          )}
          {a[JOURNEY_KEYS.writtenComplaint] === 'yes' && (
            <Field id="journey-complaint-date" label="When did you send it?" type="date" value={a[JOURNEY_KEYS.writtenComplaintDate] ?? ''} onChange={set(JOURNEY_KEYS.writtenComplaintDate)} />
          )}

          {plan.askReply && (
            <Radios id="journey-reply" legend={`${numberOf(JOURNEY_KEYS.bankReplyStatus)}. Have they replied?`} choices={REPLY} value={a[JOURNEY_KEYS.bankReplyStatus] ?? ''} onChange={set(JOURNEY_KEYS.bankReplyStatus)} />
          )}
          {a[JOURNEY_KEYS.bankReplyStatus] && a[JOURNEY_KEYS.bankReplyStatus] !== 'none' && (
            <Field id="journey-reply-date" label="Date of their reply" type="date" value={a[JOURNEY_KEYS.bankReplyDate] ?? ''} onChange={set(JOURNEY_KEYS.bankReplyDate)} />
          )}
          {replyIsFinal && (
            <div className="space-y-4">
              <Radios id="journey-outcome" legend="What did the final reply say?" choices={OUTCOME} value={a[JOURNEY_KEYS.bankReplyOutcome] ?? ''} onChange={set(JOURNEY_KEYS.bankReplyOutcome)} />
              <Radios id="journey-qualifies" legend="Does the letter say it is their final reply, and that you can contact FIDReC within six months?" choices={YES_NO_UNSURE} value={a[JOURNEY_KEYS.finalReplyQualifies] ?? ''} onChange={set(JOURNEY_KEYS.finalReplyQualifies)} />
              <p className="text-sm text-muted-foreground">You can upload the letter in the next steps.</p>
            </div>
          )}

          <Radios id="journey-police" legend={`${numberOf(JOURNEY_KEYS.policeReport)}. Have you made a police report?`} choices={YES_NO} value={a[JOURNEY_KEYS.policeReport] ?? ''} onChange={set(JOURNEY_KEYS.policeReport)} />
          {a[JOURNEY_KEYS.policeReport] === 'yes' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="journey-police-date" label="When? (optional)" type="date" value={a[JOURNEY_KEYS.policeReportDate] ?? ''} onChange={set(JOURNEY_KEYS.policeReportDate)} />
              <Field id="journey-police-number" label="Report number (optional)" value={a[JOURNEY_KEYS.policeReportNumber] ?? ''} onChange={set(JOURNEY_KEYS.policeReportNumber)} />
            </div>
          )}

          <Radios id="journey-fidrec" legend={`${numberOf(JOURNEY_KEYS.fidrecFiled)}. Have you already filed with FIDReC?`} choices={YES_NO} value={a[JOURNEY_KEYS.fidrecFiled] ?? ''} onChange={set(JOURNEY_KEYS.fidrecFiled)} />
          {a[JOURNEY_KEYS.fidrecFiled] === 'yes' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="journey-fidrec-date" label="When? (optional)" type="date" value={a[JOURNEY_KEYS.fidrecDate] ?? ''} onChange={set(JOURNEY_KEYS.fidrecDate)} />
              <Field id="journey-fidrec-ref" label="Reference (optional)" value={a[JOURNEY_KEYS.fidrecReference] ?? ''} onChange={set(JOURNEY_KEYS.fidrecReference)} />
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="font-medium">{required.length + 1}. Which of these are involved? (optional, choose any)</legend>
            {INSTITUTIONS.map((c) => (
              <div key={c.value} className="flex items-center gap-2">
                <Checkbox
                  id={`journey-inst-${c.value}`}
                  checked={institutions.includes(c.value)}
                  onCheckedChange={(checked) =>
                    setInstitutions((prev) => (checked ? [...prev, c.value] : prev.filter((v) => v !== c.value)))
                  }
                />
                <Label htmlFor={`journey-inst-${c.value}`}>{c.label}</Label>
              </div>
            ))}
          </fieldset>

          {(missing || errorMessage) && (
            <p role="alert" className="text-sm text-destructive">
              {missing ? `Please answer questions 1 to ${required.length}. "Not sure" is fine where it is offered.` : errorMessage}
            </p>
          )}
          <Button type="button" onClick={submit} disabled={isSaving}>{isSaving ? 'Saving…' : 'Continue'}</Button>
        </div>
      </CardContent>
    </Card>
  )
}
