'use client'

/**
 * Layer 3 Tier 2 ready state (Slice 8).
 *
 * Rendered once `case_entitlements.plan = 'escalation_pack'`. Shows the
 * generated FIDReC submission pack: executive summary + chronology, with
 * PDF and Markdown download actions.
 */

import { FileDown, FileText, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StateMachineLoading } from '@/components/state-machine/loading-state'
import type { FidrecSubmissionPack } from '@/lib/types/fidrec-case-pack'

export interface Tier2PackViewProps {
  pack?: FidrecSubmissionPack
  isLoading?: boolean
  errorMessage?: string | null
  onRefresh?: () => void
  onDownloadPdf: () => void
  onDownloadMd: () => void
}

export function Tier2PackView({
  pack,
  isLoading = false,
  errorMessage,
  onRefresh,
  onDownloadPdf,
  onDownloadMd,
}: Tier2PackViewProps) {
  if (isLoading && !pack) {
    return (
      <Card className="border-harbor-success/40 bg-harbor-success-tint">
        <CardHeader>
          <CardTitle>Preparing your FIDReC Tier 2 pack</CardTitle>
          <CardDescription>Generating the executive summary and chronology.</CardDescription>
        </CardHeader>
        <CardContent>
          <StateMachineLoading title="Preparing pack..." />
        </CardContent>
      </Card>
    )
  }

  if (!pack) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>FIDReC Tier 2 pack is not ready</CardTitle>
          <CardDescription>
            {errorMessage ?? 'We could not load the generated case pack yet.'}
          </CardDescription>
        </CardHeader>
        {onRefresh ? (
          <CardContent>
            <Button variant="outline" onClick={onRefresh}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              Try again
            </Button>
          </CardContent>
        ) : null}
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-harbor-success/40 bg-harbor-success-tint">
        <CardHeader className="flex flex-row items-start gap-3">
          <div className="flex-1">
            <CardTitle>FIDReC Tier 2 pack is ready</CardTitle>
            <CardDescription>
              Generated {pack.generated_at ? new Date(pack.generated_at).toLocaleString() : 'just now'} ·{' '}
              {pack.pack_version}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-lg border bg-background/70 p-3 text-sm text-muted-foreground" role="note">
            Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
          </p>
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onDownloadPdf} disabled={isLoading}>
              <FileDown className="mr-2 h-4 w-4" aria-hidden />
              Download PDF
            </Button>
            <Button variant="outline" onClick={onDownloadMd} disabled={isLoading}>
              <FileText className="mr-2 h-4 w-4" aria-hidden />
              Download Markdown
            </Button>
            {onRefresh ? (
              <Button variant="ghost" onClick={onRefresh} disabled={isLoading}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                Refresh
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Executive summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Prose>{pack.executive_summary.narrative || 'No executive summary available.'}</Prose>
        </CardContent>
      </Card>

      {pack.chronology_of_events && pack.chronology_of_events.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Chronology of events</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {pack.chronology_of_events.map((event, index) => (
                <li key={index} className="flex gap-3 text-sm">
                  <span className="w-28 shrink-0 text-muted-foreground">
                    {event.event_datetime
                      ? new Date(event.event_datetime).toLocaleDateString()
                      : 'Unknown date'}
                  </span>
                  <span className="flex-1">{event.event_text}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="prose prose-sm max-w-none dark:prose-invert">{children}</div>
}
