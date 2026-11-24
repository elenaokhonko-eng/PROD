// Shared set-up for the FIDReC update's assembled-pack tests (Lane 6): each synthetic case as the pack sees a real
// case: its evidence index, its documents (the two technical records, and a letter and a story that repeat record
// values), the prompt run_fidrec_pack_v1 sends, and every record value that must never reach the model. Synthetic only.

import {
  buildFidrecPackInput,
  type CaseDocument,
  type EvidenceIndexEntry,
  fidrecPackSystem,
  modelDocumentExcerpts,
  type SnapshotFacts,
} from '../../lib/facts'
import { buildFidrecUpdate } from '../../supabase/functions/_shared/facts/update/assemble.ts'
import {
  type AccessEvent,
  type CardAuthEvent,
  createFakeClauseProvider,
  type DeviceRecognition,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import type { FidrecUpdateCase } from '../fixtures/fidrec-update/index.ts'
import { H, lane4Corpus, sha, statement } from './sequence-fault-corpus.ts'

// ---------------------------------------------------------------------------------------------------------------
// Shared set-up: each synthetic case as the pack sees a real case
// ---------------------------------------------------------------------------------------------------------------

export const GENERATED_ON = '2026-11-24'

/** Lane 4's corpus with the two definition statements approved, so the 12-hour block prints reviewed wording. */
export const corpus = lane4Corpus([
  statement('srf.highrisk.definition', 'srf', [['mas.srf/4.2.1', sha('e')]]),
  statement('eupg.highrisk.definition', 'eupg', [['mas.eupg/4.7', H.eupg47a]]),
])

export const snapshotFacts = (c: FidrecUpdateCase) => c.data.facts as unknown as SnapshotFacts

/** The pack's evidence index for the case: one document per E-number the fixture names, with the facts it supports. */
export function evidenceIndex(c: FidrecUpdateCase): EvidenceIndexEntry[] {
  const byId = new Map<string, EvidenceIndexEntry>()
  for (const [fact, ids] of Object.entries(c.data.evidenceIds)) {
    for (const id of ids ?? []) {
      const entry = byId.get(id) ?? { id, documentId: `doc-${id}`, label: 'an uploaded document', facts: [] }
      entry.facts.push(fact as EvidenceIndexEntry['facts'][number])
      byId.set(id, entry)
    }
  }
  return [...byId.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
}

export const access = (c: FidrecUpdateCase) => (c.data.facts.access_events?.value ?? []) as AccessEvent[]
export const cards = (c: FidrecUpdateCase) => (c.data.facts.card_auth_events?.value ?? []) as CardAuthEvent[]
export const devices = (c: FidrecUpdateCase) => (c.data.facts.device_recognition?.value ?? []) as DeviceRecognition[]

/** The raw record lines, as an institution's record might print them (synthetic). */
export const accessLines = (c: FidrecUpdateCase) =>
  access(c).map((e) => `${e.timestamp} ${e.kind} device ${e.deviceLabel ?? '-'} ref ${e.deviceRef ?? '-'} ip ${e.ip ?? '-'} token ${e.tokenRef ?? '-'}`)
export const cardLines = (c: FidrecUpdateCase) =>
  cards(c).map((e) => `${e.timestamp} ${e.authentication} device ${e.deviceLabel ?? '-'} ref ${e.deviceRef ?? '-'} token ${e.tokenRef ?? '-'} wallet ${e.walletDeviceLabel ?? '-'}`)

/** The case's documents: the two technical records, and a letter and a story that repeat record values. */
export function documents(c: FidrecUpdateCase): CaseDocument[] {
  const first = access(c).find((e) => e.ip) ?? null
  const card = cards(c).find((e) => e.tokenRef) ?? null
  const letter = [
    'Synthetic letter from the institution.',
    first ? `Our records show a login from IP ${first.ip} on device ${first.deviceRef} (${first.deviceLabel}).` : '',
    card ? `The payments were approved with token ${card.tokenRef}.` : '',
    'A further session came from 2001:db8::7:1 at 21:06:30.',
  ].join(' ')
  const out: CaseDocument[] = []
  for (const entry of evidenceIndex(c)) {
    if (entry.facts.includes('access_events' as never)) out.push({ id: entry.documentId, evidenceType: 'RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA', text: accessLines(c).join('\n') })
    else if (entry.facts.includes('card_auth_events' as never)) out.push({ id: entry.documentId, evidenceType: 'CARD_AUTHENTICATION_RECORD', text: cardLines(c).join('\n') })
    else if (entry.facts.includes('bank_reply' as never)) out.push({ id: entry.documentId, evidenceType: 'BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY', text: letter })
    else out.push({ id: entry.documentId, evidenceType: 'BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS', text: 'Synthetic statement of the disputed payments.' })
  }
  // A letter with no fact behind it, so it is in the index after the others.
  out.push({ id: 'doc-extra-letter', evidenceType: 'BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL', text: letter })
  return out
}

export const story = (c: FidrecUpdateCase) => {
  const first = access(c).find((e) => e.ip)
  return `Synthetic story. ${first ? `The bank told me the login came from ${first.ip} on ${first.deviceLabel}.` : 'No record was given to me.'}`
}

export async function update(c: FidrecUpdateCase, firstClauseNumber = 1) {
  return buildFidrecUpdate({
    facts: snapshotFacts(c),
    evidenceIndex: evidenceIndex(c),
    institutionCode: c.data.institution?.code ?? null,
    ipLocations: c.data.ipLocations,
    provider: createFakeClauseProvider(corpus),
    generatedOn: GENERATED_ON,
    firstClauseNumber,
  })
}

/** Exactly what run_fidrec_pack_v1 sends the model, for the case (system prompt and user message). */
export async function prompt(c: FidrecUpdateCase, on: boolean) {
  const facts = snapshotFacts(c)
  const index = [...evidenceIndex(c), { id: `E${evidenceIndex(c).length + 1}`, documentId: 'doc-extra-letter', label: 'a letter or email from your bank (uploaded)', facts: [] }]
  const u = on ? await update(c) : null
  const excerpts = modelDocumentExcerpts(index, documents(c), u?.prompt ?? null)
  const letter = documents(c).find((d) => d.id === 'doc-extra-letter')!.text
  const input = buildFidrecPackInput({ facts, findings: [], storyText: story(c), finalReplyText: letter, evidenceIndex: index, documents: excerpts, update: u?.prompt ?? null })
  return { system: fidrecPackSystem(null, { updateSections: on }), user: `INPUT JSON:\n${JSON.stringify(input, null, 2)}`, update: u }
}

/** Every record value of the case that must never reach the model (listed here, not taken from model-guard.ts). */
export function recordValues(c: FidrecUpdateCase): string[] {
  const values = new Set<string>()
  const add = (v: string | number | null | undefined) => { if (v !== null && v !== undefined && String(v).trim()) values.add(String(v)) }
  for (const e of access(c)) [e.deviceRef, e.deviceLabel, e.ip, e.tokenRef].forEach(add)
  for (const e of cards(c)) [e.deviceRef, e.deviceLabel, e.tokenRef, e.walletDeviceLabel].forEach(add)
  for (const d of devices(c)) [d.deviceRef, d.deviceLabel].forEach(add)
  for (const l of c.data.ipLocations) {
    ;[l.ip, l.city, l.region, l.organisation].forEach(add)
    if (l.asn) add(`AS${l.asn}`)
  }
  for (const line of [...accessLines(c), ...cardLines(c)]) add(line)
  add('2001:db8::7:1')
  return [...values]
}
