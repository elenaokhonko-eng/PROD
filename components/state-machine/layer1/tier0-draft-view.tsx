'use client'

/**
 * The free evaluation screen. State Machine node `S1-Tier0Draft`.
 *
 * SM R6 / IS §9.5: render whichever narrative rows exist. Do NOT block the
 * screen waiting for a specific count. All three panels are independent.
 *
 * Pure presentational. The parent passes the resolved narrative bundle.
 */

import { Download, FileCheck, FileText, PhoneCall, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EVIDENCE_MISSING_HEADING, EVIDENCE_SHOWN_HEADING } from '@/lib/facts'
import type { Tier0DraftBundle } from '@/lib/types/narratives'

export interface Tier0DraftViewProps {
  narratives: Tier0DraftBundle
  isRefreshing?: boolean
  /** Called when the user hits "Refresh draft". If omitted, button is hidden. */
  onRefresh?: () => void
  /** CTA shown at the bottom — typically the transition into Layer 2. */
  footerSlot?: React.ReactNode
  /** Set when the facts changed after this evaluation (edge cases, 8 Nov): links back to confirm them again. */
  outOfDateHref?: string | null
}

export function Tier0DraftView({
  narratives,
  isRefreshing = false,
  onRefresh,
  footerSlot,
  outOfDateHref = null,
}: Tier0DraftViewProps) {
  const { tier0_summary, tier0_evidence_checklist, tier0_srf_signal } = narratives
  // "Report it now" (C4) sits straight after the summary: it is what to do first.
  const reportNow = narratives.other.find((n) => n.narrative_type === 'tier0_report_now') ?? null
  const other = narratives.other.filter((n) => n !== reportNow)
  const caseId = tier0_summary?.case_id ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Your free evaluation</h2>
          <p className="text-sm text-muted-foreground">
            An assessment of your case based on the facts you confirmed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {caseId ? (
            // Finding C5: the same evaluation as a PDF.
            <Button asChild variant="outline">
              <a href={`/api/cases/${caseId}/free-evaluation/pdf`} download>
                <Download className="h-4 w-4" aria-hidden /> Download your free evaluation (PDF)
              </a>
            </Button>
          ) : null}
          {onRefresh ? (
            <Button variant="outline" onClick={onRefresh} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing...' : 'Refresh draft'}
            </Button>
          ) : null}
        </div>
      </div>

      {outOfDateHref ? (
        <div role="status" data-evaluation-out-of-date className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">Your facts changed since this evaluation.</p>
          <p className="mt-1">
            This evaluation was prepared from your earlier answers.{' '}
            <a className="font-medium underline" href={outOfDateHref}>Check your facts again</a> to get an updated evaluation.
          </p>
        </div>
      ) : null}

      <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground" role="note">
        Generated automatically by GuideBuoy AI using a pre-built workflow. It has not been reviewed by a person. For a human review, book a consultation (S$99 / 30 min).
      </p>

      {tier0_summary ? (
        <NarrativePanel
          icon={<FileText className="h-5 w-5" aria-hidden />}
          title={tier0_summary.title ?? 'Free evaluation summary'}
          description="What happened, from the facts you confirmed."
          content={tier0_summary.text_content}
        />
      ) : null}

      {reportNow ? (
        <NarrativePanel
          icon={<PhoneCall className="h-5 w-5" aria-hidden />}
          title={reportNow.title ?? 'Report it now'}
          description={null}
          content={reportNow.text_content}
          accent
        />
      ) : null}

      {tier0_evidence_checklist ? (
        <NarrativePanel
          icon={<FileCheck className="h-5 w-5" aria-hidden />}
          title={tier0_evidence_checklist.title ?? 'Evidence checklist'}
          description="What your documents show, and what would help to add."
          content={tier0_evidence_checklist.text_content}
          twoLists
        />
      ) : null}

      {tier0_srf_signal ? (
        <NarrativePanel
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
          title={tier0_srf_signal.title ?? 'Shared-responsibility signal'}
          description="An early view of which Singapore rules may apply to your losses."
          content={tier0_srf_signal.text_content}
          accent
        />
      ) : null}

      {other.map((n) => (
        <NarrativePanel
          key={n.id}
          icon={<FileText className="h-5 w-5" aria-hidden />}
          title={n.title ?? n.narrative_type}
          description={null}
          content={n.text_content}
        />
      ))}

      {footerSlot ? <div className="pt-2">{footerSlot}</div> : null}
    </div>
  )
}

function NarrativePanel({
  icon,
  title,
  description,
  content,
  accent = false,
  twoLists = false,
}: {
  icon: React.ReactNode
  title: string
  description: string | null
  content: string
  accent?: boolean
  // The server's evidence checklist (C2): "What you've shown us" and "What's still missing", side by side.
  twoLists?: boolean
}) {
  const lists = twoLists ? splitLists(content) : null
  return (
    <Card className={accent ? 'border-primary/40 bg-primary/5' : undefined}>
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="mt-1 rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
        <div className="flex-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
      </CardHeader>
      <CardContent>
        {lists ? (
          <div className="grid gap-6 md:grid-cols-2">
            {lists.map((list) => (
              <div key={list.heading}>
                <h3 className="text-sm font-semibold">{list.heading}</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                  {list.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
            {content}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Older evaluations hold the model's free-text checklist; only the server's two-list text is split.
function splitLists(content: string): Array<{ heading: string; items: string[] }> | null {
  const sections = content.split(/\n\s*\n/).map((block) => block.split('\n'))
  const lists = sections
    .filter(([heading]) => heading === EVIDENCE_SHOWN_HEADING || heading === EVIDENCE_MISSING_HEADING)
    .map(([heading, ...items]) => ({ heading, items: items.map((i) => i.replace(/^- /, '')).filter(Boolean) }))
  return lists.length === 2 ? lists : null
}
