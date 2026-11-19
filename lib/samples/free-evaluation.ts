import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BANK_HOTLINES } from '@/lib/resources/official-help'
import type { CaseNarrativeRow, Tier0DraftBundle } from '@/lib/types/narratives'

// Brief W1 §H: the free-evaluation sample, the real output of the fictional case (content/samples/fictional-case.md)
// run on staging by tests/e2e/samples/free-evaluation-sample.spec.ts and frozen here. No database is read to show it.

export const SAMPLE_FILE = 'lib/samples/free-evaluation.json'
export const SAMPLE_BANNER = 'Sample. A fictional case. Names, dates, amounts and institutions are invented.'

export type SampleRow = Pick<CaseNarrativeRow, 'narrative_type' | 'title' | 'text_content' | 'created_at' | 'version' | 'language' | 'audience'>

type NarrativeRecord = { [K in keyof SampleRow]?: unknown }

export function toSampleRows(rows: readonly NarrativeRecord[]): SampleRow[] {
  return rows.map((row) => ({
    narrative_type: String(row.narrative_type),
    title: row.title == null ? null : String(row.title),
    text_content: String(row.text_content ?? ''),
    created_at: String(row.created_at),
    version: typeof row.version === 'number' ? row.version : null,
    language: row.language == null ? null : String(row.language),
    audience: row.audience == null ? null : String(row.audience),
  }))
}

// Real institutions and real-looking identifiers must never appear in the sample.
const REAL_BANKS = [
  ...BANK_HOTLINES.flatMap((line) => line.bank.split(' / ')),
  'Synthetic Bank', 'Bank of Singapore', 'HL Bank', 'Hong Leong', 'RHB', 'SBI', 'Citi ',
]

export function assertSampleIsFictional(rows: readonly SampleRow[]) {
  const text = rows.map((row) => `${row.title ?? ''}\n${row.text_content}`).join('\n')
  if (!rows.some((row) => row.narrative_type === 'tier0_summary')) throw new Error('The sample has no free-evaluation summary.')
  if (!/Harbourline/.test(text)) throw new Error('The sample does not name the fictional bank.')
  for (const bank of REAL_BANKS) {
    if (new RegExp(`\\b${bank.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) throw new Error(`The sample names a real institution: ${bank.trim()}`)
  }
  if (/@[a-z0-9-]+\.[a-z]/i.test(text)) throw new Error('The sample contains an email address.')
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text)) throw new Error('The sample contains an ID.')
}

export function loadSampleRows(): SampleRow[] | null {
  const file = join(process.cwd(), SAMPLE_FILE)
  if (!existsSync(file)) return null
  const rows = JSON.parse(readFileSync(file, 'utf8')) as SampleRow[]
  assertSampleIsFictional(rows)
  return rows
}

// The bundle the in-app view renders. case_id is empty, so the view offers no PDF download.
export function sampleBundle(rows: readonly SampleRow[]): Tier0DraftBundle {
  const full = rows.map((row, index): CaseNarrativeRow => ({
    ...row,
    id: `sample-${index + 1}`,
    case_id: '',
    source_ref: null,
    intake_id: null,
    extract_run_id: null,
    decision_run_id: null,
  }))
  const byType = (type: string) => full.find((row) => row.narrative_type === type) ?? null
  return {
    tier0_summary: byType('tier0_summary'),
    tier0_evidence_checklist: byType('tier0_evidence_checklist'),
    tier0_srf_signal: byType('tier0_srf_signal'),
    other: full.filter((row) => !['tier0_summary', 'tier0_evidence_checklist', 'tier0_srf_signal'].includes(row.narrative_type)),
  }
}
