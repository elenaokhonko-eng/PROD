// The FIDReC pack update, assembled (Lane 6). Elena's three conditions (24 Nov 2026):
// A. A switch for the new sections, off by default (FIDREC_UPDATE_SECTIONS_ENABLED, server-side, off in check-env-set
//    for every environment). With it off, no new section, line or model-prompt change is visible in any pack.
// B. Records never go into the model's prompt: built for each synthetic case with the switch on, the prompt holds no
//    device or token reference, device label, IP address, IP lookup result or raw record line.
// C. Current packs unchanged: tests/contracts/fidrec-pack.test.ts and bank-pack.test.ts are not edited and pass.
// Then the four synthetic cases end to end through the assembled pack with a fake model, with snapshots of the
// printed sections (tests/fixtures/fidrec-update/snapshots; set UPDATE_FIDREC_SNAPSHOTS=1 to rewrite them).
// The bank pack's lines are in fidrec-pack-update-bank.test.ts. All data is synthetic.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import {
  argumentClauseIdFailures,
  assembleFidrecPack,
  buildFidrecPackInput,
  documentExcerpts,
  evidenceIdFailures,
  FIDREC_UPDATE_PROMPT,
  fidrecPackChecks,
  fidrecPackFallback,
  type FidrecPackProse,
  fidrecPackSystem,
  fidrecPackTexts,
  fidrecRouteFromFacts,
  mapFidrecPackProse,
  modelDocumentExcerpts,
  parseFidrecPackProse,
  produceChecked,
} from '../../lib/facts'
import { NO_OUTCOME_LINE_KINDS, SECTION_IDS } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { redactServerOnly, serverOnlyValues, VERDICT_WORDING, verdictFailures, withoutQuotations } from '../../supabase/functions/_shared/facts/update/model-guard.ts'
import { printedText } from '../../supabase/functions/_shared/facts/update/render.ts'
import { FIDREC_UPDATE_SECTIONS_ENV, fidrecUpdateSectionsEnabled } from '../../supabase/functions/_shared/facts/update/switch.ts'
import { checkEnvironmentSet, type EnvFile } from '../../scripts/check-env-set.ts'
import { FIDREC_UPDATE_CASES, type FidrecUpdateCase } from '../fixtures/fidrec-update/index.ts'
import { documents, evidenceIndex, GENERATED_ON, prompt, recordValues, snapshotFacts, story, update } from './fidrec-pack-update-cases.ts'

// ---------------------------------------------------------------------------------------------------------------
// Condition A: the switch
// ---------------------------------------------------------------------------------------------------------------

test('condition A: the switch is off unless set to exactly "true", and is read server-side by the FIDReC pack function', () => {
  assert.equal(FIDREC_UPDATE_SECTIONS_ENV, 'FIDREC_UPDATE_SECTIONS_ENABLED')
  const env = (value: string | undefined) => (name: string) => (name === FIDREC_UPDATE_SECTIONS_ENV ? value : undefined)
  for (const off of [undefined, '', 'false', '1', 'yes', 'on', 'TRUE!']) assert.equal(fidrecUpdateSectionsEnabled(env(off)), false, String(off))
  for (const on of ['true', ' TRUE ', 'True']) assert.equal(fidrecUpdateSectionsEnabled(env(on)), true, on)
  for (const file of ['supabase/functions/run_fidrec_pack_v1/index.ts']) {
    const fn = readFileSync(file, 'utf8')
    assert.match(fn, /const UPDATE_SECTIONS = fidrecUpdateSectionsEnabled\(\(name\) => Deno\.env\.get\(name\)\);/, file)
    assert.match(fn, /if \(UPDATE_SECTIONS\) \{/, file)
    // Every new call is behind the switch: the update is null unless the switch is on.
    assert.match(fn, /let update: \w+ \| null = null;/, file)
  }
  assert.doesNotMatch(readFileSync('supabase/functions/_shared/facts/update/switch.ts', 'utf8'), /NEXT_PUBLIC_FIDREC|process\.env/)
})

test('condition A: check-env-set knows the switch and passes it only when off, in every environment', () => {
  const file = (values: Record<string, string>): EnvFile => ({ values, duplicates: [], malformedLines: [] })
  for (const environment of ['staging', 'production'] as const) {
    const finding = (values: Record<string, string>) =>
      checkEnvironmentSet(environment, file(values)).find((f) => f.check === 'FIDREC_UPDATE_SECTIONS_ENABLED is off')
    assert.equal(finding({})?.status, 'PASS', environment)
    assert.equal(finding({ FIDREC_UPDATE_SECTIONS_ENABLED: 'false' })?.status, 'PASS', environment)
    assert.equal(finding({ FIDREC_UPDATE_SECTIONS_ENABLED: 'true' })?.status, 'FAIL', environment)
    assert.equal(finding({ FIDREC_UPDATE_SECTIONS_ENABLED: 'yes' })?.status, 'FAIL', environment)
    const unknown = checkEnvironmentSet(environment, file({ FIDREC_UPDATE_SECTIONS_ENABLED: 'false' })).find((f) => f.check === 'unrecognised variables')
    assert.ok(!unknown?.detail?.includes('FIDREC_UPDATE_SECTIONS_ENABLED'), 'a known variable')
  }
})

test('condition A: with the switch off the prompt, the model input, the parsed answer and the report are exactly as before', async () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const facts = snapshotFacts(c)
    const index = evidenceIndex(c)
    // The prompt: no new block, same text with or without the empty options.
    const system = fidrecPackSystem(null)
    assert.equal(fidrecPackSystem(null, {}), system)
    assert.equal(fidrecPackSystem(null, { updateSections: false }), system)
    assert.ok(!system.includes('SERVER-WRITTEN SECTIONS'))
    assert.ok(!system.includes('clause_ids": []'))
    // The documents and the input: no record is withheld or replaced, no new key.
    assert.deepEqual(modelDocumentExcerpts(index, documents(c), null), documentExcerpts(index, documents(c)))
    const before = buildFidrecPackInput({ facts, findings: [], storyText: story(c), finalReplyText: 'Letter.', evidenceIndex: index })
    assert.deepEqual(buildFidrecPackInput({ facts, findings: [], storyText: story(c), finalReplyText: 'Letter.', evidenceIndex: index, update: null }), before)
    assert.ok(!('server_sections' in before) && !('server_clauses' in before))
    // The report: no update_* key, and the same report as without the argument.
    const route = fidrecRouteFromFacts(facts, GENERATED_ON)
    const base = { prose: fidrecPackFallback(facts), source: 'fallback' as const, facts, findings: [], evidenceIndex: index, route, finalReplyUsed: false }
    const fidrec = assembleFidrecPack({ ...base, update: null })
    assert.deepEqual(fidrec, assembleFidrecPack(base))
    assert.deepEqual(Object.keys(fidrec).filter((k) => k.startsWith('update_')), [], c.id)
  }
  // The answer: no clause_ids unless asked for.
  const answer = { title: 't', executive_summary: 's', claimant_position: 'c', institution_position: 'i', arguments_for_claimant: [{ text: 'x', evidence_ids: ['E1'], clause_ids: ['R1'] }], arguments_for_institution: [] }
  assert.deepEqual(parseFidrecPackProse(answer)?.arguments_for_claimant, [{ text: 'x', evidence_ids: ['E1'] }])
  assert.deepEqual(parseFidrecPackProse(answer, { clauseIds: true })?.arguments_for_claimant, [{ text: 'x', evidence_ids: ['E1'], clause_ids: ['R1'] }])
})

test('condition A: with the switch on the prompt gains the 4h block and the answer format names clause_ids', () => {
  const on = fidrecPackSystem(null, { updateSections: true })
  assert.ok(on.includes(FIDREC_UPDATE_PROMPT))
  assert.ok(on.indexOf('SERVER-WRITTEN SECTIONS') < on.indexOf('OUTPUT\n'))
  assert.match(on, /"arguments_for_claimant": \[\{ "text": "one point", "evidence_ids": \["E1"\], "clause_ids": \[\] \}\]/)
  assert.match(on, /correct credentials or a one-time code were used/)
  assert.match(on, /customer-fault term it relies on appears in its terms or the code/)
  assert.ok(!on.includes("including the institution's own records of logins, devices, IP addresses"))
  assert.match(fidrecPackSystem('- E9 unknown', { updateSections: true }), /PREVIOUS ANSWER WAS REJECTED[\s\S]*E9/)
})

// ---------------------------------------------------------------------------------------------------------------
// Condition B: records never go into the model's prompt
// ---------------------------------------------------------------------------------------------------------------

test('condition B: for each synthetic case with the switch on, the prompt holds no device, token, IP, lookup or record line', async () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const { system, user, update: u } = await prompt(c, true)
    const text = `${system}\n${user}`
    for (const value of recordValues(c)) assert.ok(!text.includes(value), `${c.id}: the prompt holds "${value}"`)
    assert.doesNotMatch(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b/, `${c.id}: an IPv4 address`)
    const input = JSON.parse(user.slice('INPUT JSON:\n'.length))
    for (const key of ['access_events', 'card_auth_events', 'device_recognition']) assert.ok(!(key in input.confirmed_facts), `${c.id}: ${key}`)
    assert.ok(input.documents.every((d: { excerpt: string }) => !d.excerpt.includes(' ref ')), `${c.id}: no record document excerpted`)
    // The model is told which sections and clause IDs exist, never their lines.
    assert.deepEqual(input.server_sections.map((s: { id: string }) => s.id), u!.rendered.sections.map((s) => s.id))
    assert.deepEqual(input.server_clauses.map((s: { id: string }) => s.id), u!.rendered.citations.map((s) => s.id))
  }
})

test('condition B: the server prints those records itself, and the switch-off prompt is unchanged (records included, as before)', async () => {
  const card = FIDREC_UPDATE_CASES.find((c) => c.id === 'card-only')!
  const u = await update(card)
  const printed = printedText(u.rendered).join('\n')
  for (const value of ['dev-ex-0102', 'tok-ex-0102', '198.51.100.40', 'Example Broadband', 'Phone model EX-300']) assert.ok(printed.includes(value), value)
  const off = await prompt(card, false)
  // Before the update the record document was excerpted for the model; with the switch off it still is (condition A).
  assert.ok(off.user.includes('dev-ex-0102'))
})

test('condition B: record values and IP shapes are replaced; clock times and amounts are not', () => {
  const values = ['dev-ex-0102', '64503', 'Example Broadband']
  const out = redactServerOnly('Login 21:06 and 21:06:30 from 198.51.100.40 / 2001:db8::7:1 on DEV-EX-0102 (AS64503, Example Broadband) for S$64,503 or 64503.', values)
  assert.equal(out, 'Login 21:06 and 21:06:30 from [record detail] / [record detail] on [record detail] (AS[record detail], [record detail]) for S$64,503 or [record detail].')
  assert.deepEqual(serverOnlyValues({}, []), [])
})

// ---------------------------------------------------------------------------------------------------------------
// The verdict guard (brief section 4, 4h)
// ---------------------------------------------------------------------------------------------------------------

test('the verdict guard rejects verdict wording as a finding and allows the documents\' terms in quotation marks', () => {
  for (const bad of [
    'The institution breached its duty to send an alert.',
    'The bank failed to comply with the cooling-off period.',
    'The complainant was grossly negligent.',
    'The institution is liable for the loss.',
    'The complainant acted recklessly.',
    'This is a violation of paragraph 4.7.',
    'The bank did not comply with the notice.',
  ]) assert.equal(verdictFailures([bad]).length, 1, bad)
  for (const fine of [
    'The institution\'s letter calls the complainant "grossly negligent".',
    'The institution relies on the term \'gross negligence\' in its card terms.',
    "The institution's terms use “recklessness”.",
    'The complainant reported the payments the next day.',
  ]) assert.deepEqual(verdictFailures([fine]), [], fine)
  assert.equal(withoutQuotations("the bank's 'term' here"), "the bank's '' here")
  assert.match('was negligent', VERDICT_WORDING)
})

test('the ladder regenerates a verdict, then uses fixed wording; clause IDs must be ones the pack prints', async () => {
  const c = FIDREC_UPDATE_CASES.find((x) => x.id === 'account-srf')!
  const facts = snapshotFacts(c)
  const index = evidenceIndex(c)
  const u = await update(c)
  const verdict = { ...cannedProse(c), arguments_for_claimant: [{ text: 'The institution breached its duty.', evidence_ids: ['E1'], clause_ids: [] }] }
  const calls: Array<string | null> = []
  const result = await produceChecked({
    facts,
    options: fidrecPackChecks([]),
    generate: async (previous) => { calls.push(previous); return verdict },
    mapText: mapFidrecPackProse,
    texts: fidrecPackTexts,
    fallback: fidrecPackFallback,
    extraChecks: (prose) => [...evidenceIdFailures(prose, index), ...verdictFailures(fidrecPackTexts(prose)), ...argumentClauseIdFailures(prose, u.rendered.citations.map((x) => x.id))],
  })
  assert.equal(result.source, 'fallback')
  assert.match(calls[1] ?? '', /FIDReC decides/)
  const unknownClause = { ...cannedProse(c), arguments_for_claimant: [{ text: 'A point.', evidence_ids: ['E1'], clause_ids: ['R99'] }] }
  assert.deepEqual(argumentClauseIdFailures(unknownClause, ['R1']).map((f) => f.detail), ['clause IDs not in the pack: R99'])
})

// ---------------------------------------------------------------------------------------------------------------
// End to end: the four synthetic cases through the assembled pack with a fake model
// ---------------------------------------------------------------------------------------------------------------

function cannedProse(c: FidrecUpdateCase): FidrecPackProse {
  const filler = Array.from({ length: 300 }, () => 'details').join(' ')
  return {
    title: 'Disputed payments after a scam',
    executive_summary: `The complainant disputes payments made after a scam and asks FIDReC to review them. ${filler}.`,
    claimant_position: 'The complainant asks FIDReC to review the disputed payments on the confirmed facts and the records.',
    institution_position: 'The institution declined the claim in its reply.',
    arguments_for_claimant: [{ text: 'The complainant points to the sequence the records show, set out by GuideBuoy.', evidence_ids: [evidenceIndex(c)[0].id], clause_ids: [] }],
    arguments_for_institution: [{ text: 'The institution says the payments were made with the correct credentials.', evidence_ids: [evidenceIndex(c)[0].id], clause_ids: [] }],
    institution_duties: [],
  }
}

async function assembled(c: FidrecUpdateCase) {
  const facts = snapshotFacts(c)
  const index = evidenceIndex(c)
  const u = await update(c)
  const result = await produceChecked({
    facts,
    options: fidrecPackChecks([]),
    generate: async () => parseFidrecPackProse(JSON.parse(JSON.stringify(cannedProse(c))), { clauseIds: true })!,
    mapText: mapFidrecPackProse,
    texts: fidrecPackTexts,
    fallback: fidrecPackFallback,
    extraChecks: (prose) => [...evidenceIdFailures(prose, index), ...verdictFailures(fidrecPackTexts(prose)), ...argumentClauseIdFailures(prose, u.rendered.citations.map((x) => x.id))],
  })
  const route = fidrecRouteFromFacts(facts, GENERATED_ON)
  const report = assembleFidrecPack({ prose: result.output, source: result.source, facts, findings: [], evidenceIndex: index, route, finalReplyUsed: false, update: u.rendered })
  return { report, result, u }
}

const SNAPSHOTS = 'tests/fixtures/fidrec-update/snapshots'

function snapshotOf(report: Awaited<ReturnType<typeof assembled>>['report']): string {
  const lines: string[] = []
  for (const s of report.update_sections ?? []) {
    lines.push(`## ${s.id}: ${s.heading}`)
    for (const l of s.lines) lines.push(`${l.kind === 'heading' ? '### ' : l.kind === 'bullet' ? '- ' : ''}${l.text}`)
  }
  lines.push('## citations')
  for (const c of report.update_citations ?? []) lines.push(`${c.id} ${c.clauseKey} version ${c.versionLabel} on ${c.onDates.join(', ')}`)
  lines.push('## statements')
  for (const s of report.update_statements ?? []) lines.push(`${s.sectionId} ${s.statementKey} r${s.revision} on ${s.onDate}`)
  lines.push('## flags')
  for (const f of report.update_flags ?? []) lines.push(`${f.sectionId} ${f.code} ${f.key} ${f.onDate}`)
  return `${lines.join('\n')}\n`
}

for (const c of FIDREC_UPDATE_CASES) {
  test(`end to end (${c.id}): the assembled pack prints the sections in order, matching the snapshot`, async () => {
    const { report, result } = await assembled(c)
    assert.equal(result.source, 'model', 'the fake model\'s answer passes every check')
    assert.equal(report.report_version, 'fidrec_pack_v1')
    const ids = (report.update_sections ?? []).map((s) => s.id)
    assert.deepEqual(ids, SECTION_IDS.filter((id) => ids.includes(id)), 'contract order')
    assert.ok(!ids.includes('standards'), 'Phase 5 is a stub')
    const text = snapshotOf(report)
    const file = `${SNAPSHOTS}/${c.id}.txt`
    if (process.env.UPDATE_FIDREC_SNAPSHOTS === '1' || !existsSync(file)) {
      mkdirSync(SNAPSHOTS, { recursive: true })
      writeFileSync(file, text)
    }
    assert.equal(text, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `printed sections differ from ${file}`)
    // The report keeps the existing sections exactly; the new ones are added beside them.
    for (const key of ['timeline', 'disputed_transactions', 'evidence_index', 'route', 'rules_assessment', 'arguments_for_claimant']) assert.ok(key in report, key)
  })
}

test('end to end: the decided lines (Decisions 1, 4, Lane 3 issue 6) come out as decided', async () => {
  const byId = Object.fromEntries(await Promise.all(FIDREC_UPDATE_CASES.map(async (c) => [c.id, (await assembled(c)).report] as const)))
  const section = (id: string, s: string) => byId[id].update_sections?.find((x) => x.id === s)?.lines.map((l) => l.text) ?? []
  // Decision 4: the card-only case prints the block with the wallet line (22 minutes) and the three card payments in
  // group 2; the account case prints the payee in group 1; a case with no token activation prints no block.
  const cardBlock = section('card-only', 'duty_time_checks')
  const other = cardBlock.indexOf('Other activities the record shows in the 12 hours')
  assert.ok(cardBlock.slice(other).some((t) => /22 minutes after\): Card added to a mobile wallet/.test(t)))
  assert.equal(cardBlock.slice(other).filter((t) => /: Card payment at /.test(t)).length, 3)
  const accountBlock = section('account-srf', 'duty_time_checks')
  const named = accountBlock.indexOf('Activities the definitions name')
  assert.match(accountBlock[named + 1], /Payee added/)
  assert.ok(!section('no-technical-records', 'duty_time_checks').includes('The 12 hours after the digital token was activated'))
  // The block carries no comparison ending.
  const block = cardBlock.slice(cardBlock.indexOf('The 12 hours after the digital token was activated'), cardBlock.findIndex((t) => t.startsWith('Record: ')))
  assert.ok(block.every((t) => !t.startsWith('Side by side:')))
  // Decision 1: no conduct line carries an outcome or an ending.
  for (const id of Object.keys(byId)) {
    for (const t of section(id, 'customer_conduct_comparison')) {
      assert.doesNotMatch(t, /matches|as the document expects|differs|^Side by side:/, `${id}: ${t}`)
    }
  }
  assert.deepEqual([...NO_OUTCOME_LINE_KINDS], ['conduct', 'twelve_hours', 'quotation'])
  // Lane 3 issue 6: an SRF line and an EUPG line on the same record print once, with two clause references.
  const duty = section('account-srf', 'duty_time_checks')
  const pair = duty.findIndex((t, i) => t.startsWith('Expected: Paragraph 4.2.1') && duty[i + 1]?.startsWith('Expected: Paragraph 4.7'))
  assert.ok(pair > 0, 'one record, two Expected lines')
  assert.match(duty[pair + 2], /^Side by side: The documents expect what paragraph 4\.2\.1 of .* and paragraph 4\.7 of .* \(R\d+, R\d+\) set out\./)
  // Neutral pronouns and no verdict wording anywhere the server prints.
  for (const id of Object.keys(byId)) {
    for (const t of printedText({ sections: byId[id].update_sections ?? [] })) {
      assert.doesNotMatch(t, /\b(she|her|hers|he|him|his)\b/i, `${id}: ${t}`)
      assert.equal(verdictFailures([t]).length, 0, `${id}: ${t}`)
    }
  }
})

test('pinned citations: every R-number printed is pinned with its clause id, text hash and version; numbering follows the duties section', async () => {
  const c = FIDREC_UPDATE_CASES.find((x) => x.id === 'account-srf')!
  const u = await update(c, 4)
  assert.ok(u.rendered.citations.length > 0)
  assert.equal(u.rendered.citations[0].id, 'R4', 'after R1-R3 of the duties section')
  for (const p of u.rendered.citations) assert.ok(p.clauseId && p.textSha256 && p.versionId && p.versionLabel && p.onDates.length, p.id)
  const printed = printedText(u.rendered).join('\n')
  for (const ref of printed.matchAll(/\bR(\d+)\b/g)) assert.ok(u.rendered.citations.some((p) => p.id === `R${ref[1]}`), `R${ref[1]} is pinned`)
  // Statement revisions printed are pinned too; one under review is not.
  assert.ok(u.rendered.statements.some((s) => s.statementKey === 'srf.highrisk.definition' && s.revision === 1))
  assert.ok(u.rendered.flags.some((f) => f.code === 'statement_under_review'))
})

// ---------------------------------------------------------------------------------------------------------------
// The PDF
// ---------------------------------------------------------------------------------------------------------------

test('the PDF prints the update only when the report has it (Unicode fonts, every line kind)', async () => {
  const { buildFidrecPackPdf } = await import('../../lib/server/facts/fidrec-pack-pdf.ts')
  const c = FIDREC_UPDATE_CASES.find((x) => x.id === 'card-only')!
  const { report } = await assembled(c)
  const { update_sections: _s, update_citations: _c, update_statements: _t, update_flags: _f, update_generated_on: _g, ...without } = report
  const withUpdate = await buildFidrecPackPdf(report, '2026-11-24T00:00:00Z')
  const plain = await buildFidrecPackPdf(without, '2026-11-24T00:00:00Z')
  assert.ok(withUpdate.length > plain.length)
  // The PDF prints the sections between the positions and the points for each side (brief 4i).
  const source = readFileSync('lib/server/facts/fidrec-pack-pdf.ts', 'utf8')
  assert.ok(source.indexOf('pack.update_sections') > source.indexOf('"The institution’s position"'))
  assert.ok(source.indexOf('pack.update_sections') < source.indexOf('"Points for the complainant"'))
})

test('record rows: every field a section prints has a label (card dispute rows in the contract names), and no "SGD n" amount', async () => {
  const { RECORD_FIELD_LABELS } = await import('../../supabase/functions/_shared/facts/update/render.ts')
  const card = FIDREC_UPDATE_CASES.find((x) => x.id === 'card-only')!
  const u = await update(card)
  const labels = new Set(Object.values(RECORD_FIELD_LABELS))
  let rows = 0
  for (const r of u.results) {
    for (const line of r.lines) {
      if (line.kind !== 'record') continue
      rows += 1
      for (const [key, value] of Object.entries(line.fields)) {
        if (value !== null && value !== '') assert.ok(key in RECORD_FIELD_LABELS, `${r.sectionId}: no label for ${key}`)
      }
    }
  }
  assert.ok(rows > 0)
  const printed = printedText(u.rendered)
  const cardRows = u.rendered.sections.find((s) => s.id === 'card_dispute_comparison')!.lines.filter((l) => l.kind === 'bullet')
  assert.ok(cardRows.length >= 3)
  for (const row of cardRows) {
    for (const part of row.text.replace(/ \(E[\d, E]+\)$/, '').split('; ')) assert.ok(labels.has(part.split(': ')[0]), `unlabelled: ${part}`)
    assert.match(row.text, /^Date: \d+ \w+ 2025; Payment: S\$[\d,]+; /)
    assert.match(row.text, /Card ending: 0001/)
  }
  for (const t of printed) {
    assert.doesNotMatch(t, /\bSGD \d/, t)
    assert.doesNotMatch(t, /\b(?:cardScheme|entryMode|authenticationResult|deviceLabel|last4)\b/, t)
  }
})

// Review follow-up (#81, #82): a credit bureau report showing the card account only overdue. creditBureauReportRead is
// left unwired (false) until the "account overdue" fact exists, so 8.3 and 8.4(a) never print "matches" here.
test('end to end: a bureau report showing the account overdue never makes 8.3 or 8.4(a) "matches" in the assembled pack', async () => {
  const { createHash } = await import('node:crypto')
  const { parseFactExtraction } = await import('../../lib/facts')
  const { CLAUSE_KEYS, createFakeClauseProvider } = await import('../../supabase/functions/_shared/facts/update/contract.ts')
  const { SECTION_8_CLAUSES, SECTION_8_FROM } = await import('../../supabase/functions/_shared/facts/rules/dispute-charges-checks.ts')
  const { buildFidrecUpdate } = await import('../../supabase/functions/_shared/facts/update/assemble.ts')
  const { corpus } = await import('./fidrec-pack-update-cases.ts')
  const overdue = await import('../fixtures/evidence/credit-bureau-overdue.ts')
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  // Section 8 held from 16 June 2025, so the rows compare against held text (synthetic placeholders).
  const held = structuredClone(corpus)
  for (const v of held.versions.filter((x) => x.document_key === 'mas.eupg' && x.status === 'verified')) {
    for (const key of CLAUSE_KEYS.disputed_amount_charges) {
      const text = key === SECTION_8_CLAUSES.p8_4
        ? 'Synthetic 8.4: during the following periods: (a) from the investigation up to 30 calendar days after the outcome is given; and (b) after FIDReC completes or closes the case.'
        : `Placeholder text of ${key}.`
      v.clauses.push({ clause_id: `e2e-${v.version_id}-${key}`, clause_key: key, clause_ref: key.split('/')[1], text_content: text, text_sha256: sha(text), ...(v.effective_from! < SECTION_8_FROM ? { effective_from_override: SECTION_8_FROM } : {}) })
    }
  }
  const card = FIDREC_UPDATE_CASES.find((c) => c.id === 'card-only')!
  const docRef = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:cb-1', documentId: 'cb-1' } }
  for (const output of [overdue.MODEL_OUTPUT_AS_PROMPTED, overdue.MODEL_OUTPUT_OVER_READ]) {
    const reports = parseFactExtraction(output, overdue.CREDIT_BUREAU_OVERDUE_TEXT, docRef).filter((c) => c.factKey === 'credit_bureau_reports').flatMap((c) => c.value as unknown[])
    const facts = { ...snapshotFacts(card), credit_bureau_reports: { value: reports, label: 'confirmed' } } as unknown as Parameters<typeof buildFidrecUpdate>[0]['facts']
    const u = await buildFidrecUpdate({
      facts,
      evidenceIndex: [...evidenceIndex(card), { id: 'E7', facts: ['credit_bureau_reports'] }],
      institutionCode: card.data.institution?.code ?? null,
      ipLocations: card.data.ipLocations,
      provider: createFakeClauseProvider(held),
      generatedOn: GENERATED_ON,
      firstClauseNumber: 1,
    })
    const section8 = u.results.find((r) => r.sectionId === 'disputed_amount_charges')!
    const rows = section8.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))
    for (const key of [SECTION_8_CLAUSES.p8_3, SECTION_8_CLAUSES.p8_4]) {
      assert.ok(rows.some((c) => c.clauseKey === key), `${key} prints a row`)
      for (const c of rows.filter((x) => x.clauseKey === key)) assert.notEqual(c.outcome, 'matches', `${key}: ${c.record}`)
    }
    const printed = u.rendered.sections.find((s) => s.id === 'disputed_amount_charges')!.lines.map((l) => l.text)
    assert.ok(!printed.some((t) => /as the documents? expects?/.test(t)), printed.join('\n'))
  }
})
