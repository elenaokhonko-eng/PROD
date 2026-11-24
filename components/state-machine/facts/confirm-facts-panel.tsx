'use client'

/**
 * Confirm your facts (design section 7; stage 1 demo review, findings A1-A9). Shown before every stage is
 * generated. One card per fact: the values found are boxes, and choosing a box is the answer. Below the boxes there
 * are always two more options, "Something else" and "I'm not sure". Facts that can have several values (accounts,
 * amounts, institutions, payments) let the user tick several boxes. Generation stays disabled until every card is
 * answered; the server enforces the same rule when the facts are frozen.
 */

import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import {
  ACCOUNT_CATEGORIES,
  BANK_REPLY_OPTIONS,
  FACT_ENUM_OPTIONS,
  type FactKey,
  formatFactValue,
  MULTI_SELECT_FACT_KEYS,
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

const EVENT_KEYS: FactKey[] = ['reported_to_bank', 'reported_to_police', 'written_complaint_sent', 'fidrec_filed']
const ACCOUNT_LABELS = new Map((FACT_ENUM_OPTIONS.account_types ?? []).map((o) => [o.value, o.label]))
// Fixed lists where "Something else" is a valid answer (stored as "other").
const OTHER_ALLOWED: FactKey[] = ['scam_type', 'phishing_channel', 'account_types']

export interface ConfirmFactsPanelProps {
  caseId: string
  stage: Stage
  onConfirmed: (snapshotId: string) => void
  // The dashboard shows its own heading for this step (finding A9).
  showIntro?: boolean
}

export function ConfirmFactsPanel({ caseId, stage, onConfirmed, showIntro = true }: ConfirmFactsPanelProps) {
  const facts = useCaseFacts(caseId, stage)
  const resolve = useResolveFinding(caseId, stage)
  const confirm = useConfirmFacts(caseId, stage)
  const [reviewing, setReviewing] = useState(false)
  // A double-click lands before the button re-renders as disabled; without this guard it froze the facts twice and
  // started two generations (hardening item 4, 8 Nov).
  const confirming = useRef(false)

  if (facts.isPending || (facts.data && 'inProgress' in facts.data)) {
    return (
      <StateMachineLoading
        title="Checking your story against your answers and documents"
        description="This usually takes under a minute and can take up to two. You can leave this page and come back; we'll keep checking and your answers are saved."
      />
    )
  }
  if (facts.isError) {
    // The daily model budget is used up (cost-controls spec §5 B4): say so calmly; nothing is lost.
    const paused = facts.error instanceof FactsRequestError && facts.error.reason === 'daily_limit'
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>{paused ? 'We’ve paused new checks for today' : 'We couldn’t check your facts just now'}</CardTitle>
          <CardDescription>
            {paused
              ? 'Your story and documents are saved. Please come back tomorrow, or email info@guidebuoyai.sg and we’ll let you know when it’s ready.'
              : 'Nothing has been lost. Please try again in a moment.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => facts.refetch()}>Try again</Button>
        </CardContent>
      </Card>
    )
  }

  const view = facts.data as FactsView
  const stageName = STAGE_NAMES[stage]
  // Facts named by an answer that doesn't fit with another: shown first, highlighted, each with what it clashes
  // with, even when the sources agreed on it (walkthrough 7 Nov).
  const labelOf = (key: FactKey) => view.findings.find((f) => f.factKey === key)?.label ?? key
  const clashes = new Map<FactKey, string>()
  for (const issue of view.consistencyIssues) {
    for (const key of issue.factKeys) {
      const others = issue.factKeys.filter((k) => k !== key).map(labelOf).join(', ')
      clashes.set(key, `Doesn’t fit with: ${others}`)
    }
  }
  const clashing = view.findings.filter((f) => clashes.has(f.factKey))
  const agreed = view.findings.filter((f) => f.findingType === 'agreed' && !clashes.has(f.factKey))
  const toCheck = view.findings.filter((f) => f.findingType !== 'agreed')
  const groups: Array<{ type: Finding['findingType']; title: string }> = [
    { type: 'conflict', title: 'Different answers' },
    { type: 'unsupported', title: 'No supporting document' },
    { type: 'missing', title: 'Still needed' },
  ]
  const canContinue = view.openCount === 0 && view.documentsProcessing === 0 && view.consistencyIssues.length === 0
  // While the facts reload in the background (a document just finished, an answer was saved) the list on screen may be
  // out of date, and the server refuses a confirmation made then (facts_in_progress; 24 Nov 2026 gate run).
  const refreshing = facts.isFetching

  async function handleConfirm() {
    if (confirming.current) return
    confirming.current = true
    try {
      const result = await confirm.mutateAsync()
      onConfirmed(result.snapshotId)
    } finally {
      confirming.current = false
    }
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
          <Button onClick={handleConfirm} disabled={confirm.isPending || refreshing}>Continue</Button>
        </CardContent>
      </Card>
    )
  }

  const checked = toCheck.length - view.openCount
  return (
    <div className="space-y-6">
      {showIntro && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm your facts</CardTitle>
            <CardDescription>
              Before we prepare your {stageName}, please check what we found in your story, your answers and your
              documents. Your report will use only the facts you confirm.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Finding A8: the count stays in view while the user works down the cards (top on small screens, right-hand
          pill on wide ones). One element, so the count is never shown twice. */}
      <div data-facts-progress className="sticky top-[4.5rem] z-30 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur lg:ml-auto lg:w-80">
        <p aria-live="polite" className="text-sm font-medium">
          {view.openCount === 0 ? 'Everything is confirmed.' : `${view.openCount} ${view.openCount === 1 ? 'fact' : 'facts'} left to check.`}
        </p>
        {toCheck.length > 0 && (
          <div
            role="progressbar"
            aria-label="Facts checked"
            aria-valuemin={0}
            aria-valuemax={toCheck.length}
            aria-valuenow={checked}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(checked / toCheck.length) * 100}%` }} />
          </div>
        )}
        {view.documentsProcessing > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            {view.documentsProcessing} {view.documentsProcessing === 1 ? 'document is' : 'documents are'} still being
            read. Check back in a minute; we’ll include {view.documentsProcessing === 1 ? 'it' : 'them'} here.
          </p>
        )}
      </div>

      {view.consistencyIssues.length > 0 && (
        <Card role="alert">
          <CardHeader>
            <CardTitle>Two answers don’t fit together</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {view.consistencyIssues.map((issue) => (
              <div key={issue.message} className="space-y-1">
                <p>{issue.message}</p>
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  {issue.factKeys.map((key) => {
                    const target = view.findings.find((f) => f.factKey === key)
                    return target ? (
                      <a key={key} href={`#finding-${target.id}`} className="font-medium underline">Change: {target.label}</a>
                    ) : null
                  })}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {clashing.length > 0 && (
        <section aria-labelledby="facts-clashing" className="space-y-4">
          <h2 id="facts-clashing" className="text-lg font-semibold">Answers to check</h2>
          {clashing.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              stageName={stageName}
              highlight={clashes.get(finding.factKey) ?? null}
              saving={resolve.isPending && resolve.variables?.findingId === finding.id}
              error={resolve.isError && resolve.variables?.findingId === finding.id ? errorText(resolve.error) : null}
              onResolve={(resolution) => resolve.mutate({ findingId: finding.id, resolution })}
            />
          ))}
        </section>
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
        const items = view.findings.filter((f) => f.findingType === group.type && !clashes.has(f.factKey))
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
        <Button size="lg" onClick={handleConfirm} disabled={!canContinue || confirm.isPending || refreshing}>
          {confirm.isPending ? 'Saving…' : `Confirm and continue to your ${stageName}`}
        </Button>
        {!canContinue && (
          <p className="text-sm text-muted-foreground">
            {view.consistencyIssues.length ? 'You can continue once your answers fit together.' : 'You can continue once every fact above is answered.'}
          </p>
        )}
      </div>
    </div>
  )
}

function errorText(error: unknown): string {
  if (error instanceof FactsRequestError) {
    if (error.reason === 'invalid_value') return 'That value could not be read. Please check it and try again.'
    if (error.reason === 'mixed_currencies') return 'Those amounts are in different currencies. Please choose amounts in one currency, or enter the total.'
    if (error.reason === 'finding_outdated') return 'Your facts changed while you were answering. Please review this fact again.'
    if (error.reason === 'facts_unconfirmed') return 'Some facts still need an answer.'
    if (error.reason === 'documents_processing') return 'A document is still being read. Please try again in a minute.'
    // A document added on this step makes the facts be read again; confirming during that was "Something went wrong"
    // (24 Nov 2026 gate run). Wording awaiting Elena's approval.
    if (error.reason === 'facts_in_progress') return 'Your facts are being checked again with your latest document. Please try again in a minute.'
  }
  return 'Something went wrong. Please try again.'
}

function intro(finding: Finding, stageName: string, multi: boolean): string {
  if (finding.findingType === 'missing') return `We need this for your ${stageName}. Choose the right answer, or tell us if you're not sure.`
  if (finding.findingType === 'unsupported') {
    return "We couldn't find a document that shows this. Choose it to keep it as your own account, or upload a document from your case page."
  }
  if (finding.findingType === 'agreed') return 'Is this right? Choose it to keep it, or enter the correct answer.'
  return multi
    ? 'Your sources give different answers; they’re highlighted below. Choose every one that is correct.'
    : 'Your sources give different answers; they’re highlighted below. Choose the one that is correct.'
}

function resolvedText(finding: Finding): string | null {
  const r = finding.resolution
  if (!r || finding.status === 'open') return null
  switch (r.kind) {
    case 'choice':
      return finding.values[r.index]?.display ?? null
    case 'choices':
      return r.indices.map((i) => finding.values[i]?.display).filter(Boolean).join('; ')
    case 'value':
      return formatFactValue(finding.factKey, r.value)
    case 'not_sure':
      return "I'm not sure"
    case 'not_known':
      return 'Not known'
    case 'acknowledged':
      return `${finding.values[0]?.display ?? ''} (no supporting document)`
    case 'agreed':
      return finding.values[0]?.display ?? null
    default:
      return null
  }
}

interface Box {
  id: string
  label: string
  sources: Array<{ label: string; quote: string | null }>
}

// The boxes for one fact. A fact with a fixed list of values (scam type, first contact, accounts, credentials)
// always shows the whole list, marking where each value was found; any other fact shows the values found.
function boxesFor(finding: Finding): { boxes: Box[]; fixedList: boolean } {
  const options = FACT_ENUM_OPTIONS[finding.factKey]
  const sourcesOf = (v: Finding['values'][number]) => v.sources.map((s) => ({ label: s.label, quote: s.quotes[0] ?? null }))
  if (options) {
    return {
      fixedList: true,
      boxes: options.map((o) => ({
        id: o.value,
        label: o.label,
        sources: finding.values
          .filter((v) => (Array.isArray(v.value) ? (v.value as unknown[]).includes(o.value) : v.value === o.value))
          .flatMap(sourcesOf),
      })),
    }
  }
  return { fixedList: false, boxes: finding.values.map((v, i) => ({ id: String(i), label: v.display, sources: sourcesOf(v) })) }
}

function FindingCard({
  finding,
  stageName,
  saving,
  error,
  onResolve,
  highlight = null,
}: {
  finding: Finding
  stageName: string
  /** Why this fact needs another look ("Doesn't fit with: …"); the card is outlined and says so. */
  highlight?: string | null
  saving: boolean
  error: string | null
  onResolve: (resolution: ResolutionInput) => void
}) {
  const multi = MULTI_SELECT_FACT_KEYS.has(finding.factKey)
  const { boxes, fixedList } = boxesFor(finding)
  // Accounts affected: the categories the sources support start ticked (finding A3).
  const initial = fixedList && multi ? boxes.filter((b) => b.sources.length).map((b) => b.id) : []
  const [picked, setPicked] = useState<string[]>(initial)
  const [other, setOther] = useState(false)
  const [unsure, setUnsure] = useState(false)
  const [value, setValue] = useState<unknown>(null)
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(finding.status === 'open')
  const hasEditor = finding.factKey !== 'transactions'
  const answered = resolvedText(finding)
  const name = `finding-${finding.id}`

  function toggle(id: string) {
    setUnsure(false)
    if (multi) setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
    else {
      setPicked([id])
      setOther(false)
    }
  }
  function chooseOther() {
    setUnsure(false)
    if (multi) setOther((o) => !o)
    else {
      setPicked([])
      setOther(true)
    }
  }
  function chooseUnsure() {
    setPicked([])
    setOther(false)
    setUnsure(true)
  }

  const ready = unsure || (other ? value !== null : picked.length > 0)

  function submit() {
    const trimmedNote = note.trim() || undefined
    if (unsure) onResolve({ kind: finding.findingType === 'missing' ? 'not_known' : 'not_sure', note: trimmedNote })
    else if (fixedList) {
      const chosen = other ? [...picked, 'other'] : picked
      onResolve({ kind: 'value', value: multi ? chosen : chosen[0], note: trimmedNote })
    } else if (other) {
      // "Something else" adds to the ticked values on a multi-select fact; on a single-select fact it replaces them.
      const ticked = picked.map((id) => finding.values[Number(id)]?.value)
      onResolve({ kind: 'value', value: multi ? combineForEdit(finding.factKey, ticked, value) : value, note: trimmedNote })
    } else if (finding.findingType === 'unsupported') onResolve({ kind: 'acknowledged', note: trimmedNote })
    else if (multi) onResolve({ kind: 'choices', indices: picked.map(Number), note: trimmedNote })
    else onResolve({ kind: 'choice', index: Number(picked[0]), note: trimmedNote })
    setEditing(false)
  }

  const outline = highlight ? 'scroll-mt-28 border-2 border-amber-500' : 'scroll-mt-28'
  const clash = highlight ? (
    <p className="w-full text-sm font-medium text-amber-800 dark:text-amber-300"><span aria-hidden>⚠ </span>{highlight}</p>
  ) : null

  if (!editing && answered) {
    return (
      <Card id={`finding-${finding.id}`} className={outline}>
        <div data-finding={finding.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
          {clash}
          {!highlight && <span aria-hidden className="text-primary">✓</span>}
          <span className="font-medium">{finding.label}:</span>
          <span className="min-w-0 flex-1">{answered}</span>
          {!highlight && <Badge variant="secondary">Answered</Badge>}
          <Button type="button" variant={highlight ? 'default' : 'outline'} size="sm" onClick={() => setEditing(true)}>Change</Button>
        </div>
      </Card>
    )
  }

  const inputType = multi ? 'checkbox' : 'radio'
  return (
    <Card id={`finding-${finding.id}`} className={outline}>
      {/* No <form>: the button saves directly. Native inputs inside labels keep every choice named and keyboard-usable. */}
      <div data-finding={finding.id}>
        <fieldset className="space-y-4 p-6">
          <legend className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-base font-semibold">{finding.label}</span>
            <Badge variant={finding.status === 'open' || highlight ? 'destructive' : 'secondary'}>
              {finding.status === 'open' || highlight ? 'To check' : 'Answered'}
            </Badge>
          </legend>
          {clash}
          <p className="text-sm text-muted-foreground">{intro(finding, stageName, multi)}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            {boxes.map((box) => {
              const selected = picked.includes(box.id)
              // Where the sources disagree, each answer they gave is highlighted so it's clear what to choose between.
              const disputed = finding.findingType === 'conflict' && box.sources.length > 0
              return (
                <label
                  key={box.id}
                  data-disputed={disputed || undefined}
                  className={`relative flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${selected ? 'border-primary bg-primary/10' : disputed ? 'border-2 border-amber-500 bg-amber-50 hover:border-primary/60 dark:bg-amber-950/30' : 'hover:border-primary/60'}`}
                >
                  <input
                    type={inputType}
                    name={name}
                    className="sr-only"
                    checked={selected}
                    onChange={() => toggle(box.id)}
                  />
                  <span className="flex items-start justify-between gap-2 font-medium">
                    {box.label}
                    {selected && <span aria-hidden className="text-primary">✓</span>}
                  </span>
                  {disputed && <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Found in your sources; doesn’t match the other answer</span>}
                  {box.sources.length > 0 && (
                    <ul className="space-y-1 text-muted-foreground">
                      {box.sources.map((s, j) => (
                        <li key={j}>{s.label}{s.quote ? `: "${s.quote}"` : ''}</li>
                      ))}
                    </ul>
                  )}
                </label>
              )
            })}
          </div>

          <div className="space-y-2 text-sm">
            {(fixedList ? OTHER_ALLOWED.includes(finding.factKey) : hasEditor) && (
              <label className="flex cursor-pointer items-center gap-2">
                <input type={multi ? 'checkbox' : 'radio'} name={multi ? `${name}-other` : name} checked={other} onChange={chooseOther} className="accent-primary" />
                {fixedList ? 'Something else (please explain in the note)' : 'Something else: enter the correct value'}
              </label>
            )}
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name={`${name}-unsure`} checked={unsure} onChange={chooseUnsure} className="accent-primary" />
              I’m not sure
            </label>
          </div>
          {other && !fixedList && <FactValueEditor factKey={finding.factKey} idPrefix={finding.id} onChange={setValue} />}

          <div className="space-y-1">
            <Label htmlFor={`${finding.id}-note`}>Note (optional)</Label>
            <Textarea id={`${finding.id}-note`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="button" onClick={submit} disabled={!ready || saving}>
            {saving ? 'Saving…' : 'Save answer'}
          </Button>
        </fieldset>
      </div>
    </Card>
  )
}

// "Something else" on a multi-select fact keeps the ticked values and adds the one typed in.
function combineForEdit(factKey: FactKey, ticked: unknown[], typed: unknown): unknown {
  if (factKey === 'institution_names') {
    return [...ticked.flatMap((v) => (v as Array<{ name: string }>).map((i) => i.name)), typed]
  }
  if (factKey === 'total_loss') {
    const rows = ticked.flatMap((v) => {
      const loss = v as { amount: number; account?: string | null; portions?: Array<{ account: string | null; amount: { amount: number } }> }
      return loss.portions?.length
        ? loss.portions.map((p) => ({ amount: p.amount.amount, account: p.account }))
        : [{ amount: loss.amount, account: loss.account ?? null }]
    })
    return [...rows, typed]
  }
  return typed
}

function FactValueEditor({ factKey, idPrefix, onChange }: { factKey: FactKey; idPrefix: string; onChange: (value: unknown) => void }) {
  const [state, setState] = useState<Record<string, unknown>>({})
  const update = (patch: Record<string, unknown>, build: (s: Record<string, unknown>) => unknown) => {
    const next = { ...state, ...patch }
    setState(next)
    onChange(build(next))
  }

  if (factKey === 'total_loss') {
    const build = (s: Record<string, unknown>) => (s.amount ? { amount: s.amount, account: s.account || null } : null)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-amount`}>Amount in S$</Label>
          <Input id={`${idPrefix}-amount`} inputMode="decimal" onChange={(e) => update({ amount: e.target.value.trim() }, build)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-account`}>Taken from (optional)</Label>
          <select
            id={`${idPrefix}-account`}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            onChange={(e) => update({ account: e.target.value }, build)}
            defaultValue=""
          >
            <option value="">Not sure</option>
            {ACCOUNT_CATEGORIES.map((a) => <option key={a} value={a}>{ACCOUNT_LABELS.get(a) ?? a}</option>)}
          </select>
        </div>
      </div>
    )
  }
  if (factKey === 'amount_recovered_or_offered') {
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
  if (factKey === 'bank_case_reference' || factKey === 'police_report_number') {
    return (
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-reference`}>{factKey === 'bank_case_reference' ? 'Case reference' : 'Report number'}</Label>
        <Input id={`${idPrefix}-reference`} onChange={(e) => onChange(e.target.value.trim() || null)} />
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
    const build = (s: Record<string, unknown>) => (s.value ? { value: s.value, date: s.date || null } : null)
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
          <div className="space-y-1 sm:w-1/2">
            <Label htmlFor={`${idPrefix}-event-date`}>Date (optional)</Label>
            <Input id={`${idPrefix}-event-date`} type="date" onChange={(e) => update({ date: e.target.value }, build)} />
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
  return null
}
