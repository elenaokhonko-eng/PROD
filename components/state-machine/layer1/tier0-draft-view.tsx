'use client'

/**
 * Layer 1 Tier-0 free draft screen. State Machine node `S1-Tier0Draft`.
 *
 * SM R6 / IS §9.5: render whichever narrative rows exist. Do NOT block the
 * screen waiting for a specific count. All three panels are independent.
 *
 * Pure presentational. The parent passes the resolved narrative bundle.
 */

import { FileCheck, FileText, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Tier0DraftBundle } from '@/lib/types/narratives'

export interface Tier0DraftViewProps {
  narratives: Tier0DraftBundle
  isRefreshing?: boolean
  /** Called when the user hits "Refresh draft". If omitted, button is hidden. */
  onRefresh?: () => void
  /** CTA shown at the bottom — typically the transition into Layer 2. */
  footerSlot?: React.ReactNode
}

export function Tier0DraftView({
  narratives,
  isRefreshing = false,
  onRefresh,
  footerSlot,
}: Tier0DraftViewProps) {
  const { tier0_summary, tier0_evidence_checklist, tier0_srf_signal, other } = narratives

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Your free triage draft</h2>
          <p className="text-sm text-muted-foreground">
            A summary of your case based on everything you&apos;ve shared.
          </p>
        </div>
        {onRefresh ? (
          <Button variant="outline" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? 'Refreshing...' : 'Refresh draft'}
          </Button>
        ) : null}
      </div>

      <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground" role="note">
        Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
      </p>

      {tier0_summary ? (
        <NarrativePanel
          icon={<FileText className="h-5 w-5" aria-hidden />}
          title={tier0_summary.title ?? 'Case summary'}
          description="A narrative summary of what happened."
          content={tier0_summary.text_content}
        />
      ) : null}

      {tier0_evidence_checklist ? (
        <NarrativePanel
          icon={<FileCheck className="h-5 w-5" aria-hidden />}
          title={tier0_evidence_checklist.title ?? 'Evidence checklist'}
          description="Documents we've seen and what's still missing."
          content={tier0_evidence_checklist.text_content}
        />
      ) : null}

      {tier0_srf_signal ? (
        <NarrativePanel
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
          title={tier0_srf_signal.title ?? 'Shared-responsibility signal'}
          description="Early view of how Singapore's Shared Responsibility Framework may apply."
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
}: {
  icon: React.ReactNode
  title: string
  description: string | null
  content: string
  accent?: boolean
}) {
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
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
          {content}
        </div>
      </CardContent>
    </Card>
  )
}
