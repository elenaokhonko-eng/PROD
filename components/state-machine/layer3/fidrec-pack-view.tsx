'use client'

/**
 * The stored FIDReC pack (report_type fidrec_pack_v1, run_fidrec_pack_v1): every section from the saved pack, in the
 * same order as its PDF (lib/server/facts/fidrec-pack-pdf.ts). Pure presentational.
 */

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PAID_PACK_NOTICE } from '@/lib/legal/automated-output-notice'
import type { FidrecPackJson } from '@/lib/types/report'

export interface FidrecPackViewProps {
  pack: FidrecPackJson
  createdAt: string | null
  onDownload: () => void
}

export function FidrecPackView({ pack, createdAt, onDownload }: FidrecPackViewProps) {
  const generated = createdAt
    ? new Date(createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null
  return (
    <div className="space-y-4" data-fidrec-pack>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{pack.title ?? 'Your FIDReC pack'}</h2>
          <p className="text-sm text-muted-foreground">{generated ? `Generated ${generated}` : 'Generation date unavailable'}</p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={onDownload}>
          <Download className="mr-2 h-4 w-4" aria-hidden />
          Download PDF
        </Button>
      </div>

      <p className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground" role="note">
        {PAID_PACK_NOTICE}
      </p>

      {pack.executive_summary ? <Section title="Executive summary"><Prose>{pack.executive_summary}</Prose></Section> : null}
      {pack.route ? <Section title="Filing with FIDReC"><Prose>{pack.route}</Prose></Section> : null}

      {pack.timeline?.length ? (
        <Section title="Chronology">
          <ol className="space-y-2">
            {pack.timeline.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm">
                {item.date ? <span className="w-28 shrink-0 text-muted-foreground">{item.date}</span> : null}
                <span className="flex-1">{item.event}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {pack.disputed_transactions?.length ? (
        <Section title="Disputed transactions">
          <ul className="space-y-1 text-sm">
            {pack.disputed_transactions.map((row, i) => (
              <li key={i}>{Object.entries(row).map(([column, cell]) => `${column.replace(/_/g, ' ')}: ${String(cell)}`).join(' · ')}</li>
            ))}
          </ul>
          {pack.total_loss ? <p className="mt-3 text-sm"><span className="font-medium">Amount lost: </span>{pack.total_loss}</p> : null}
        </Section>
      ) : null}

      {pack.claimant_position ? <Section title="The complainant’s position"><Prose>{pack.claimant_position}</Prose></Section> : null}
      {pack.institution_position ? <Section title="The institution’s position"><Prose>{pack.institution_position}</Prose></Section> : null}

      <Arguments title="Points for the complainant" items={pack.arguments_for_claimant} />
      <Arguments title="Points for the institution" items={pack.arguments_for_institution} />

      {pack.institution_duties?.length ? (
        <Section title="The institution’s duties and what the records show">
          {pack.duties_note ? <p className="mb-3 text-sm" data-duties-note>{pack.duties_note}</p> : null}
          <ul className="ml-4 list-disc space-y-2 text-sm">
            {pack.institution_duties.map((duty, i) => (
              <li key={i}>
                {duty.text}
                <span className="text-muted-foreground"> ({[...duty.clause_ids, ...duty.evidence_ids].join(', ')})</span>
              </li>
            ))}
          </ul>
          {pack.regulatory_sources?.length ? (
            <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
              {pack.regulatory_sources.map((source) => (
                <div key={source.id}>
                  <dt className="inline font-medium">{source.id}: </dt>
                  <dd className="inline">{[source.source, source.clause_ref, source.title].filter(Boolean).join(', ')}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Section>
      ) : null}

      {pack.evidence_index?.length ? (
        <Section title="Evidence index">
          <ul className="space-y-1 text-sm">
            {pack.evidence_index.map((item) => (
              <li key={item.id}><span className="font-medium">{item.id}</span>: {item.document}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {pack.rules_assessment ? <Section title="How the rules may apply"><Prose>{pack.rules_assessment}</Prose></Section> : null}

      {pack.evidence_checklist?.length ? (
        <Section title="Evidence checklist">
          <ul className="space-y-1 text-sm">
            {pack.evidence_checklist.map((item, i) => (
              <li key={i} className={item.present ? '' : 'text-muted-foreground'}>{item.present ? 'Shown' : 'Missing'}: {item.label}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}

function Arguments({ title, items }: { title: string; items?: Array<{ text: string; evidence_ids: string[] }> }) {
  if (!items?.length) return null
  return (
    <Section title={title}>
      <ul className="ml-4 list-disc space-y-2 text-sm">
        {items.map((item, i) => (
          <li key={i}>
            {item.text}
            {item.evidence_ids.length ? <span className="text-muted-foreground"> ({item.evidence_ids.join(', ')})</span> : null}
          </li>
        ))}
      </ul>
    </Section>
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
  return <div className="whitespace-pre-wrap text-sm leading-relaxed">{children}</div>
}
