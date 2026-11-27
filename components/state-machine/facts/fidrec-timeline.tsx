'use client'

/**
 * CR-2 (27 Nov 2026): the timeline questionnaire, the first step after buying the FIDReC pack, and what a waiting pack
 * shows. The two waiting messages are Elena's approved wording (lib/journey/fidrec-timeline.ts).
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FidrecPackCheck } from '@/lib/facts'
import { FIDREC_NOT_COMPLAINED, fidrecWaitingText, singaporeToday, type FidrecTimeline } from '@/lib/journey/fidrec-timeline'

type Choice = boolean | null

function YesNo({ legend, name, value, no = 'No', onChange }: {
  legend: string
  name: string
  value: Choice
  no?: string
  onChange: (value: boolean) => void
}) {
  return (
    <fieldset className="space-y-2" data-timeline-question={name}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      {[true, false].map((option) => (
        <label key={String(option)} className="flex min-h-11 items-center gap-3 rounded-control border px-3 text-sm">
          <input type="radio" name={name} value={option ? 'yes' : 'no'} checked={value === option} onChange={() => onChange(option)} />
          {option ? 'Yes' : no}
        </label>
      ))}
    </fieldset>
  )
}

function DateField({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type="date"
        name={name}
        className="block min-h-11 rounded-control border px-3"
        max={singaporeToday()}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= singaporeToday()

export function FidrecTimelineForm({ initial, onSave }: { initial: FidrecTimeline | null; onSave: (timeline: FidrecTimeline) => Promise<void> }) {
  const [complained, setComplained] = useState<Choice>(initial?.complained ?? null)
  const [complaintDate, setComplaintDate] = useState(initial?.complaintDate ?? '')
  const [answered, setAnswered] = useState<Choice>(initial?.answered ?? null)
  const [final, setFinal] = useState<Choice>(initial?.final ?? null)
  const [replyDate, setReplyDate] = useState(initial?.replyDate ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const complete =
      complained === false ||
      (complained === true && isDate(complaintDate) && (answered === false || (answered === true && final !== null && isDate(replyDate))))
    if (!complete || complained === null) {
      setError('Please answer each question and enter the date.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const replied = complained && answered === true
      await onSave({
        complained,
        complaintDate: complained ? complaintDate : null,
        answered: complained ? answered : null,
        replyDate: replied ? replyDate : null,
        final: replied ? final : null,
      })
    } catch {
      setError('We couldn’t save that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card data-fidrec-timeline>
      <CardHeader>
        <CardTitle className="text-lg">Your timeline with your bank</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <YesNo legend="Have you complained to your bank in writing?" name="complained" value={complained} no="Not yet" onChange={setComplained} />
          {complained ? (
            <>
              <DateField label="Date of your written complaint" name="complaint-date" value={complaintDate} onChange={setComplaintDate} />
              <YesNo legend="Has your bank answered your complaint?" name="answered" value={answered} no="No, not yet" onChange={setAnswered} />
            </>
          ) : null}
          {complained && answered ? (
            <>
              <YesNo legend="Does the reply say it is your bank’s final reply?" name="final" value={final} onChange={setFinal} />
              <DateField label={final ? 'Date of the final reply' : 'Date of the bank’s answer'} name="reply-date" value={replyDate} onChange={setReplyDate} />
            </>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="min-h-11" disabled={complained === null || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/** What a pack that can't be generated yet says. Nothing for one that can. */
export function FidrecWaiting({ check, onChange }: { check: FidrecPackCheck; onChange?: () => void }) {
  // Narrowed by the field itself: the app compiles without strict null checks.
  if (!('reason' in check)) return null
  const text =
    check.reason === 'complaint_not_raised'
      ? FIDREC_NOT_COMPLAINED
      : 'complaintDate' in check && check.complaintDate && check.availableFrom
        ? fidrecWaitingText(check.complaintDate, check.availableFrom)
        : null
  return (
    <div role="status" className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm" data-fidrec-waiting={check.reason}>
      {text ? <p>{text}</p> : null}
      {onChange ? (
        <button type="button" className="min-h-11 underline" onClick={onChange}>
          Change my answers
        </button>
      ) : null}
    </div>
  )
}
