'use client'

/**
 * Confirm your facts (design section 7). Shown before every stage is generated: conflicts first, then claims with
 * no supporting document, then missing facts, with agreed facts collapsed. Generation stays disabled until every
 * item is resolved; the server enforces the same rule when the facts are frozen.
 */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import {
  BANK_REPLY_OPTIONS,
  FACT_ENUM_OPTIONS,
  type FactKey,
  formatFactValue,
  type Stage,
} from '@/lib/facts'
import {
  FactsRequestError,
  type FactsView,
  type ResolutionInput,
  useCaseFacts,
  useConfirmFacts,
  useResolveFinding,
} from '@/hooks/state-machine/facts/use-case-facts'

type Finding = FactsView['findings'][number]

const STAGE_NAMES: Record<Stage, string> = {
  free: 'free evaluation',
  bank: 'bank dispute pack',
  fidrec: 'FIDReC escalation pack',
}

const MONEY_KEYS: FactKey[] = ['total_loss', 'amount_recovered_or_offered']
const EVENT_KEYS: FactKey[] = ['reported_to_bank', 'reported_to_police', 'written_complaint_sent', 'fidrec_filed']
const MULTI_KEYS: FactKey[] = ['scam_type', 'account_types']

export interface ConfirmFactsPanelProps {
  caseId: string
  stage: Stage
  onConfirmed: (snapshotId: string) => void
}

export function ConfirmFactsPanel({ caseId, stage, onConfirmed }: ConfirmFactsPanelProps) {
  const facts = useCaseFacts(caseId, stage)
  const resolve = useResolveFinding(caseId, stage)
  const confirm = useConfirmFacts(caseId, stage)
  const [reviewing, setReviewing] = useState(false)

  if (facts.isPending || (facts.data && 'inProgress' in facts.data)) {
    return (
      <StateMachineLoading
        title="Checking your story against your answers and documents"
        description="This usually takes under a minute and can take up to two. You can leave this page and come back; we'll keep checking and your answers are saved."
      />
    )
  }
  if (facts.isError) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>We couldn’t check your facts just now</CardTitle>
          <CardDescription>Nothing has been lost. Please try again in a moment.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => facts.refetch()}>Try again</Button>
        </CardContent>
      </Card>
    )
  }

  const view = facts.data as FactsView
  const stageName = STAGE_NAMES[stage]
  const agreed = view.findings.filter((f) => f.findingType === 'agreed')
  const groups: Array<{ type: Finding['findingType']; title: string }> = [
    { type: 'conflict', title: 'Different answers' },
    { type: 'unsupported', title: 'No supporting document' },
    { type: 'missing', title: 'Still needed' },
  ]
  const canContinue = view.openCount === 0 && view.documentsProcessing === 0 && view.consistencyIssues.length === 0

  async function handleConfirm() {
    const result = await confirm.mutateAsync()
    onConfirmed(result.snapshotId)
  }

  if (view.latestSnapshot?.unchanged && view.openCount === 0 && !reviewing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your facts haven’t changed</CardTitle>
          <CardDescription>
            Nothing has changed since you confirmed your facts on {new Date(view.latestSnapshot.createdAt).toLocaleDateString('en-SG')}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setReviewing(true)}>Review my facts</Button>
          <Button onClick={handleConfirm} disabled={confirm.isPending}>Continue</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Confirm your facts</CardTitle>
          <CardDescription>
            Before we prepare your {stageName}, please check what we found in your story, your answers and your
            documents. Your report will use only the facts you confirm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p aria-live="polite" className="text-sm font-medium">
            {view.openCount === 0 ? 'Everything is confirmed.' : `${view.openCount} ${view.openCount === 1 ? 'item' : 'items'} left to check.`}
          </p>
          {view.documentsProcessing > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {view.documentsProcessing} {view.documentsProcessing === 1 ? 'document is' : 'documents are'} still being
              read. Check back in a minute; we’ll include {view.documentsProcessing === 1 ? 'it' : 'them'} here.
            </p>
          )}
        </CardContent>
      </Card>

      {view.consistencyIssues.length > 0 && (
        <Card role="alert">
          <CardHeader>
            <CardTitle>Two answers don’t fit together</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {view.consistencyIssues.map((issue) => <p key={issue}>{issue}</p>)}
            <p className="text-muted-foreground">Use “Change” on the item below that isn’t right.</p>
          </CardContent>
        </Card>
      )}

      {agreed.length > 0 && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">Facts that agree ({agreed.length})</summary>
          <dl className="mt-3 space-y-2 text-sm">
            {agreed.map((f) => (
              <div key={f.id}>
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd>{f.values[0]?.display ?? 'Not known'}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {groups.map((group) => {
        const items = view.findings.filter((f) => f.findingType === group.type)
        if (!items.length) return null
        return (
          <section key={group.type} aria-labelledby={`facts-${group.type}`} className="space-y-4">
            <h2 id={`facts-${group.type}`} className="text-lg font-semibold">{group.title}</h2>
            {items.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                stageName={stageName}
                saving={resolve.isPending && resolve.variables?.findingId === finding.id}
                error={resolve.isError && resolve.variables?.findingId === finding.id ? errorText(resolve.error) : null}
                onResolve={(resolution) => resolve.mutate({ findingId: finding.id, resolution })}
              />
            ))}
          </section>
        )
      })}

      <div className="flex flex-col gap-2">
        {confirm.isError && <p role="alert" className="text-sm text-destructive">{errorText(confirm.error)}</p>}
        <Button size="lg" onClick={handleConfirm} disabled={!canContinue || confirm.isPending}>
          {confirm.isPending ? 'Saving…' : `Confirm and continue to your ${stageName}`}
        </Button>
        {!canContinue && (
          <p className="text-sm text-muted-foreground">
            {view.consistencyIssues.length ? 'You can continue once your answers fit together.' : 'You can continue once every item above is answered.'}
          </p>
        )}
      </div>
    </div>
  )
}

function errorText(error: unknown): string {
  if (error instanceof FactsRequestError) {
    if (error.reason === 'invalid_value') return 'That value could not be read. Please check it and try again.'
    if (error.reason === 'finding_outdated') return 'Your facts changed while you were answering. Please review this item again.'
    if (error.reason === 'facts_unconfirmed') return 'Some items still need an answer.'
    if (error.reason === 'documents_processing') return 'A document is still being read. Please try again in a minute.'
  }
  return 'Something went wrong. Please try again.'
}

const INTRO: Record<Finding['findingType'], string> = {
  conflict: 'We found two different answers. Please tell us which is correct.',
  unsupported: "We couldn't find a document that shows this. You can upload one from your case page, or keep it as your own account.",
  missing: 'We need this for your report.',
  agreed: '',
}

function resolvedText(finding: Finding): string | null {
  const r = finding.resolution
  if (!r || finding.status === 'open') return null
  switch (r.kind) {
    case 'choice':
      return finding.values[r.index]?.display ?? null
    case 'value':
      return formatFactValue(finding.factKey, r.value)
    case 'not_sure':
      return "I'm not sure"
    case 'not_known':
      return 'Not known'
    case 'acknowledged':
      return `${finding.values[0]?.display ?? ''} (no supporting document)`
    default:
      return null
  }
}

function FindingCard({
  finding,
  stageName,
  saving,
  error,
  onResolve,
}: {
  finding: Finding
  stageName: string
  saving: boolean
  error: string | null
  onResolve: (resolution: ResolutionInput) => void
}) {
  const [choice, setChoice] = useState<string>('')
  const [value, setValue] = useState<unknown>(null)
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(finding.status === 'open')
  const hasEditor = finding.factKey !== 'transactions'
  const answered = resolvedText(finding)

  const options: Array<{ id: string; label: string }> =
    finding.findingType === 'conflict'
      ? [
          ...finding.values.map((v, i) => ({ id: `choice:${i}`, label: v.display })),
          ...(hasEditor ? [{ id: 'value', label: 'Something else: enter the correct value' }] : []),
          { id: 'not_sure', label: "I'm not sure" },
        ]
      : finding.findingType === 'unsupported'
        ? [
            { id: 'acknowledged', label: "Keep it: I don't have a document for this" },
            ...(hasEditor ? [{ id: 'value', label: 'Correct it' }] : []),
            { id: 'not_sure', label: "I'm not sure" },
          ]
        : [
            ...(hasEditor ? [{ id: 'value', label: 'Enter it' }] : []),
            { id: 'not_known', label: 'Not known' },
          ]

  function submit() {
    const trimmedNote = note.trim() || undefined
    if (choice.startsWith('choice:')) onResolve({ kind: 'choice', index: Number(choice.slice(7)), note: trimmedNote })
    else if (choice === 'value') onResolve({ kind: 'value', value, note: trimmedNote })
    else if (choice === 'not_sure' || choice === 'not_known' || choice === 'acknowledged') onResolve({ kind: choice, note: trimmedNote })
    setEditing(false)
  }

  const legendId = `finding-${finding.id}`
  return (
    <Card>
      {/* No <form>: Radix controls inside one render unlabelled hidden inputs; the button saves directly. */}
      <div data-finding={finding.id}>
        <fieldset className="space-y-4 p-6">
          <legend className="flex w-full flex-wrap items-center justify-between gap-2">
            <span id={legendId} className="text-base font-semibold">{finding.label}</span>
            <Badge variant={finding.status === 'open' ? 'destructive' : 'secondary'}>
              {finding.status === 'open' ? 'To check' : 'Answered'}
            </Badge>
          </legend>
          <p className="text-sm text-muted-foreground">
            {finding.findingType === 'missing' ? `We need this for your ${stageName}.` : INTRO[finding.findingType]}
          </p>

          {finding.values.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {finding.values.map((v, i) => (
                <li key={i} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{v.display}</p>
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {v.sources.map((s, j) => (
                      <li key={j}>
                        {s.label}
                        {s.quotes[0] ? `: "${s.quotes[0]}"` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {!editing && answered ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>Your answer: <strong>{answered}</strong></span>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>Change</Button>
            </div>
          ) : (
            <>
              <RadioGroup value={choice} onValueChange={setChoice} aria-label={`Your answer for ${finding.label}`}>
                {options.map((o) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <RadioGroupItem value={o.id} id={`${finding.id}-${o.id}`} />
                    <Label htmlFor={`${finding.id}-${o.id}`}>{o.label}</Label>
                  </div>
                ))}
              </RadioGroup>
              {choice === 'value' && <FactValueEditor factKey={finding.factKey} idPrefix={finding.id} onChange={setValue} />}
              <div className="space-y-1">
                <Label htmlFor={`${finding.id}-note`}>Note (optional)</Label>
                <Textarea id={`${finding.id}-note`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={2} />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="button" onClick={submit} disabled={!choice || saving || (choice === 'value' && value === null)}>
                {saving ? 'Saving…' : 'Save answer'}
              </Button>
            </>
          )}
        </fieldset>
      </div>
    </Card>
  )
}

function FactValueEditor({ factKey, idPrefix, onChange }: { factKey: FactKey; idPrefix: string; onChange: (value: unknown) => void }) {
  const [state, setState] = useState<Record<string, unknown>>({})
  const update = (patch: Record<string, unknown>, build: (s: Record<string, unknown>) => unknown) => {
    const next = { ...state, ...patch }
    setState(next)
    onChange(build(next))
  }

  if (MONEY_KEYS.includes(factKey)) {
    return (
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-amount`}>Amount in S$</Label>
        <Input id={`${idPrefix}-amount`} inputMode="decimal" onChange={(e) => onChange(e.target.value.trim() || null)} />
      </div>
    )
  }
  if (factKey === 'institution_names') {
    return (
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-institution`}>Bank or payment provider</Label>
        <Input id={`${idPrefix}-institution`} onChange={(e) => onChange(e.target.value.trim() || null)} />
      </div>
    )
  }
  if (factKey === 'date_discovered') {
    return (
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-date`}>Date</Label>
        <Input id={`${idPrefix}-date`} type="date" onChange={(e) => onChange(e.target.value || null)} />
      </div>
    )
  }
  if (EVENT_KEYS.includes(factKey)) {
    const build = (s: Record<string, unknown>) => (s.value ? { value: s.value, date: s.date || null, reference: s.reference || null } : null)
    return (
      <div className="space-y-3">
        <RadioGroup onValueChange={(v) => update({ value: v }, build)} aria-label="Yes or no">
          {['yes', 'no'].map((v) => (
            <div key={v} className="flex items-center gap-2">
              <RadioGroupItem value={v} id={`${idPrefix}-event-${v}`} />
              <Label htmlFor={`${idPrefix}-event-${v}`}>{v === 'yes' ? 'Yes' : 'No'}</Label>
            </div>
          ))}
        </RadioGroup>
        {state.value === 'yes' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-event-date`}>Date (optional)</Label>
              <Input id={`${idPrefix}-event-date`} type="date" onChange={(e) => update({ date: e.target.value }, build)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-event-ref`}>Reference (optional)</Label>
              <Input id={`${idPrefix}-event-ref`} onChange={(e) => update({ reference: e.target.value.trim() }, build)} />
            </div>
          </div>
        )}
      </div>
    )
  }
  if (factKey === 'bank_reply') {
    const build = (s: Record<string, unknown>) =>
      s.status ? { status: s.status, date: s.date || null, qualifies: s.status === 'final_reply' ? s.qualifies ?? null : null } : null
    return (
      <div className="space-y-3">
        <RadioGroup onValueChange={(v) => update({ status: v }, build)} aria-label="The bank's reply">
          {BANK_REPLY_OPTIONS.map((o) => (
            <div key={o.value} className="flex items-center gap-2">
              <RadioGroupItem value={o.value} id={`${idPrefix}-reply-${o.value}`} />
              <Label htmlFor={`${idPrefix}-reply-${o.value}`}>{o.label}</Label>
            </div>
          ))}
        </RadioGroup>
        {state.status && state.status !== 'none' && (
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-reply-date`}>Date of the reply</Label>
            <Input id={`${idPrefix}-reply-date`} type="date" onChange={(e) => update({ date: e.target.value }, build)} />
          </div>
        )}
        {state.status === 'final_reply' && (
          <RadioGroup onValueChange={(v) => update({ qualifies: v }, build)} aria-label="Does the letter say it is the final reply and mention FIDReC?">
            <p className="text-sm">Does the letter say it is the bank’s final reply and that you can contact FIDReC within six months?</p>
            {[['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']].map(([v, label]) => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem value={v} id={`${idPrefix}-qualifies-${v}`} />
                <Label htmlFor={`${idPrefix}-qualifies-${v}`}>{label}</Label>
              </div>
            ))}
          </RadioGroup>
        )}
      </div>
    )
  }
  const options = FACT_ENUM_OPTIONS[factKey]
  if (options && MULTI_KEYS.includes(factKey)) {
    const selected = (state.values as string[] | undefined) ?? []
    return (
      <div className="space-y-2" role="group" aria-label="Choose all that apply">
        {options.map((o) => (
          <div key={o.value} className="flex items-center gap-2">
            <Checkbox
              id={`${idPrefix}-multi-${o.value}`}
              checked={selected.includes(o.value)}
              onCheckedChange={(checked) => {
                const next = checked ? [...selected, o.value] : selected.filter((v) => v !== o.value)
                update({ values: next }, (s) => ((s.values as string[]).length ? s.values : null))
              }}
            />
            <Label htmlFor={`${idPrefix}-multi-${o.value}`}>{o.label}</Label>
          </div>
        ))}
      </div>
    )
  }
  if (options) {
    return (
      <RadioGroup onValueChange={(v) => onChange(v)} aria-label="Choose one">
        {options.map((o) => (
          <div key={o.value} className="flex items-center gap-2">
            <RadioGroupItem value={o.value} id={`${idPrefix}-one-${o.value}`} />
            <Label htmlFor={`${idPrefix}-one-${o.value}`}>{o.label}</Label>
          </div>
        ))}
      </RadioGroup>
    )
  }
  return null
}
