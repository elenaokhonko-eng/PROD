// Lane 4 test helper: the Step 0 synthetic corpus extended with the documents and approved statements the sequence,
// definitions and conduct sections read. Every text is a placeholder, not any document's wording; hashes are stand-ins.
// CLAUDE.md: synthetic only.

import {
  type FakeCorpus,
  type FakeCorpusClause,
  type FakeCorpusVersion,
  type FakeStatement,
  type StatementFramework,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { syntheticCorpus } from '../fixtures/fidrec-update/index.ts'

export const sha = (c: string) => c.repeat(64)

/** Clause hashes of the extra clauses. */
export const H = {
  eupg52: sha('b'), // from the Step 0 corpus, unchanged between EUPG A and B
  eupg47a: sha('a'),
  eupg47b: sha('c'),
  fn20: sha('2'),
  abs5: sha('3'),
  reply: sha('4'),
  visa: sha('5'),
  mastercard: sha('6'),
  srf31: sha('7'),
}

const srf31: FakeCorpusClause = {
  clause_id: 'cl-srf-3.1',
  clause_key: 'mas.srf/3.1',
  clause_ref: '3.1',
  text_content: 'Placeholder text of SRF 3.1.',
  text_sha256: H.srf31,
}

const fn20: FakeCorpusClause = {
  clause_id: 'cl-eupg-fn20',
  clause_key: 'mas.eupg/fn20',
  clause_ref: 'fn20',
  text_content: 'Placeholder text of footnote 20.',
  text_sha256: H.fn20,
  instrument_scope: ['account_transfer', 'ewallet'],
}

const version = (v: Partial<FakeCorpusVersion> & Pick<FakeCorpusVersion, 'version_id' | 'document_key' | 'clauses'>): FakeCorpusVersion => ({
  title: `Synthetic ${v.document_key}`,
  publisher: 'Synthetic publisher',
  binding_level: 'industry_code',
  institution: null,
  card_scheme: null,
  document_instrument_scope: ['sg_card'],
  version_label: '2024 edition',
  effective_from: '2024-01-01',
  effective_to: null,
  status: 'verified',
  source_url: `https://example.com/${v.document_key}.pdf`,
  coverage: 'full',
  ...v,
})

export const extraVersions: FakeCorpusVersion[] = [
  version({
    version_id: 'ver-abs',
    document_key: 'abs.card_code',
    title: 'Synthetic card code',
    clauses: [{ clause_id: 'cl-abs-5', clause_key: 'abs.card_code/5', clause_ref: '5', text_content: 'Placeholder text of card code 5.', text_sha256: H.abs5 }],
  }),
  version({
    version_id: 'ver-reply',
    document_key: 'mas.reply.20250107',
    title: 'Synthetic written reply',
    binding_level: 'announcement',
    effective_from: '2025-01-07',
    // Decision 6: a MAS reply is read whatever the event date.
    as_of_rule: 'any_date',
    clauses: [{ clause_id: 'cl-reply', clause_key: 'mas.reply.20250107/3(a).3ds', clause_ref: '3(a)', text_content: 'Placeholder text of the reply.', text_sha256: H.reply }],
  }),
  version({
    version_id: 'ver-visa',
    document_key: 'visa.core_rules',
    title: 'Synthetic scheme rules V',
    binding_level: 'scheme_rule',
    card_scheme: 'visa',
    version_label: 'Synthetic edition',
    effective_from: '2025-03-01',
    coverage: 'selected_sections',
    clauses: [{ clause_id: 'cl-visa-11.8.5', clause_key: 'visa.core_rules/11.8.5', clause_ref: '11.8.5', text_content: 'Placeholder section.', text_sha256: H.visa }],
  }),
  version({
    version_id: 'ver-mc',
    document_key: 'mastercard.chargeback_guide',
    title: 'Synthetic scheme rules M',
    binding_level: 'scheme_rule',
    card_scheme: 'mastercard',
    version_label: 'Synthetic edition',
    effective_from: '2025-03-01',
    coverage: 'selected_sections',
    clauses: [{
      clause_id: 'cl-mc-4837',
      clause_key: 'mastercard.chargeback_guide/dms.4837.issuer-chargeback',
      clause_ref: '4837',
      text_content: 'Placeholder section.',
      text_sha256: H.mastercard,
    }],
  }),
]

let n = 0
export function statement(
  key: string,
  framework: StatementFramework,
  wording: Array<[string, string]>,
  opts: { revision?: number; status?: FakeStatement['status']; text?: string } = {},
): FakeStatement {
  n += 1
  const revision = opts.revision ?? 1
  return {
    statement_id: `st-lane4-${n}`,
    statement_key: key,
    revision,
    framework,
    applies_to_instrument: ['account_transfer', 'sg_card', 'ewallet'],
    text: opts.text ?? `Synthetic wording of ${key}, revision ${revision}.`,
    clause_keys: wording.map(([k]) => k),
    status: opts.status ?? 'approved',
    clauses_as_of: '2025-01-01',
    approved_by: 'synthetic-reviewer',
    approved_at: '2025-01-02T00:00:00Z',
    checked_wording: wording.map(([clause_key, text_sha256]) => ({ clause_key, text_sha256 })),
  }
}

/**
 * The Step 0 corpus plus: EUPG footnote 20 in both EUPG versions, SRF 3.1, the card code, the MAS reply, both schemes' anchor
 * sections, and the given statements. The Step 0 statements stay as they are.
 */
export function lane4Corpus(statements: FakeStatement[] = [], opts: { versions?: FakeCorpusVersion[] } = {}): FakeCorpus {
  const base = syntheticCorpus.versions.map((v) =>
    v.document_key === 'mas.eupg' && v.status === 'verified'
      ? { ...v, clauses: [...v.clauses, fn20] }
      : v.document_key === 'mas.srf' && v.status === 'verified'
      ? { ...v, clauses: [...v.clauses, srf31] }
      : v
  )
  return {
    versions: [...base, ...(opts.versions ?? extraVersions)],
    statements: [...syntheticCorpus.statements, ...statements],
  }
}

/**
 * Server-written text must carry no verdict (brief section 4). The documents' own terms may appear inside quotation
 * marks, and in the fixed 4e line naming the three terms; everything else is checked.
 */
export const VERDICT = /\b(breach\w*|violat\w*|fail(ed|s)? to (meet|comply)|did not comply|(is|was|are|were) (not )?liable|negligen\w*|grossly|reckless\w*|stolen|scammer|fraudster|cannot)\b/i

export function verdictFree(text: string): boolean {
  const stripped = text
    // An opening quote follows a space or a bracket; an apostrophe ("institution's") does not.
    .replace(/(^|[\s(])'[^']*'(?=[\s.,;:)]|$)/g, "$1''")
    .replace(/"[^"]*"/g, '""')
    .replace('the terms negligence, gross negligence or recklessness', '')
  return !VERDICT.test(stripped)
}
