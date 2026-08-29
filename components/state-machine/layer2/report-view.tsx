'use client'

/**
 * Layer 2 node `L2-ReportReady` (SM Diagram 3).
 *
 * Full-report renderer. Accepts a `report: ReportRow` fetched by the
 * driver via `use-latest-report` (ORDER BY created_at DESC LIMIT 1 —
 * SM R4 / IS §8.1 gotcha 7).
 *
 * Pure presentational. It renders only actions supplied by the driver.
 */

import { Check, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CaseDecisionRunRow } from '@/lib/types/decision'
import type { ReportJson, ReportRow } from '@/lib/types/report'

export interface ReportViewProps {
  report: ReportRow
  decision?: CaseDecisionRunRow | null
  onDownload?: () => void
  /** Optional — extra controls the driver wants to inject (e.g. "Add more evidence"). */
  actionsSlot?: React.ReactNode
}

export function ReportView({ report, onDownload, actionsSlot }: ReportViewProps) {
  const json: ReportJson = report.report_json ?? {}
  const createdAt = report.created_at
    ? new Date(report.created_at).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{json.title ?? 'Your complaint report'}</h2>
          <p className="text-sm text-muted-foreground">
            {createdAt ? `Generated ${createdAt}` : 'Generation date unavailable'}
          </p>
        </div>
        <div className="flex gap-2">
          {actionsSlot}
          {onDownload ? (
            <Button variant="outline" className="min-h-11" onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" aria-hidden />
              Download PDF
            </Button>
          ) : null}
        </div>
      </div>

      <p className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground" role="note">
        Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
      </p>

      {json.executive_summary ? (
        <Section title="Executive summary">
          <Prose>{json.executive_summary}</Prose>
        </Section>
      ) : null}

      {Array.isArray(json.timeline) && json.timeline.length > 0 ? (
        <Section title="Timeline">
          <ol className="space-y-2">
            {json.timeline.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm">
                {item.date ? (
                  <span className="w-28 shrink-0 text-muted-foreground">{item.date}</span>
                ) : null}
                <span className="flex-1">{item.event}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {Array.isArray(json.disputed_transactions) && json.disputed_transactions.length > 0 ? (
        <Section title="Disputed transactions">
          <div className="grid gap-3 md:hidden">
            {json.disputed_transactions.slice(0, 5).map((row, rowIndex) => (
              <dl key={rowIndex} className="rounded-control border bg-background p-4 text-sm">
                {Object.entries(row).map(([column, cell]) => (
                  <div key={column} className="grid gap-1 border-b py-2 first:pt-0 last:border-0 last:pb-0">
                    <dt className="font-medium capitalize text-muted-foreground">{column.replace(/_/g, ' ')}</dt>
                    <dd className="break-words">{String(cell)}</dd>
                  </div>
                ))}
              </dl>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {Object.keys(json.disputed_transactions[0] ?? {}).map((column) => (
                    <th key={column} className="py-2 pr-4 font-medium capitalize">
                      {column.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {json.disputed_transactions.slice(0, 5).map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b last:border-0">
                    {Object.values(row).map((cell, cellIndex) => (
                      <td key={cellIndex} className="max-w-72 break-words py-2 pr-4 align-top">
                        {String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {json.disputed_transactions.length > 5 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing first 5 of {json.disputed_transactions.length} transactions.
            </p>
          ) : null}
        </Section>
      ) : null}

      {json.requested_resolution ? (
        <Section title="Requested resolution">
          <Prose>{json.requested_resolution}</Prose>
        </Section>
      ) : null}

      {Array.isArray(json.evidence_checklist) && json.evidence_checklist.length > 0 ? (
        <Section title="Evidence checklist">
          <ul className="space-y-1.5">
            {json.evidence_checklist.map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                {item.present ? (
                  <Check className="h-4 w-4 text-harbor-sage" aria-hidden />
                ) : (
                  <X className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
                <span className={item.present ? '' : 'text-muted-foreground'}>{item.label}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {Array.isArray(json.disclaimers) && json.disclaimers.length > 0 ? (
        <Section title="Disclaimers">
          <ul className="space-y-1 text-xs text-muted-foreground">
            {json.disclaimers.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
      {children}
    </div>
  )
}
