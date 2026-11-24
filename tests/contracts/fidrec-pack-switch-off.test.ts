// The FIDReC update with its switch off (Elena, 24 Nov 2026):
// (a) the device question, and every other fact of the update, sits behind the one switch the pack functions read (FIDREC_UPDATE_SECTIONS_ENABLED, one
//     helper on both sides): with it off, no device question on the facts screen or the dashboard's paid confirm step,
//     and the device_recognition finding never blocks confirmation or reaches a snapshot;
// (b) device answers never reach the model in either pack; the access-record document's text is as on main.
// Synthetic cases only.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildBankPackInput,
  buildFidrecPackInput,
  type CurrentFinding,
  FIDREC_UPDATE_SECTIONS_ENV,
  type FactCandidate,
  fidrecUpdateSectionsEnabled,
  reconcile,
  type ReconciledFinding,
  type SnapshotFacts,
} from '../../lib/facts'
import { updateFactsOn, findingsForStage, stageSnapshot } from '../../lib/server/facts/facts-service'
import { fidrecUpdateSectionsEnabled as edgeSwitch } from '../../supabase/functions/_shared/facts/update/switch.ts'
import type { AccessEvent, DeviceRecognition } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { accountSrfCase, FIDREC_UPDATE_CASES } from '../fixtures/fidrec-update/index.ts'
import { factExtraction } from '../../lib/server/facts/run-reconcile'
import * as extractionV3 from '../../supabase/functions/_shared/facts/extraction-v3.ts'
import { buildFactExtractionPrompt, FACT_EXTRACTION_PROMPT_VERSION, PAID_STAGE_ONLY_FACT_KEYS } from '../../lib/facts'

const record = (factKey: string, v: unknown): FactCandidate =>
  ({ factKey, value: v, sourceType: 'document', sourceRef: { sourceKey: 'document:d1', documentId: 'd1', documentType: 'bank_access_record', confidence: 0.9, context: false } }) as FactCandidate
const current = (findings: ReconciledFinding[]): CurrentFinding[] =>
  findings.map((f, i) => ({
    id: `f${i}`,
    factKey: f.factKey,
    findingType: f.findingType,
    values: f.values,
    status: f.findingType === 'agreed' ? 'resolved' : 'open',
    resolution: f.findingType === 'agreed' ? { kind: 'agreed' } : null,
  }))

test('(a) one setting: the web app and the pack functions read the same name through the same helper, and agree', () => {
  assert.equal(fidrecUpdateSectionsEnabled, edgeSwitch, 'lib/facts re-exports the edge helper itself')
  for (const value of [undefined, '', 'false', 'yes', 'true', ' TRUE ']) {
    const env = { [FIDREC_UPDATE_SECTIONS_ENV]: value }
    assert.equal(updateFactsOn(env), edgeSwitch((name) => env[name]), String(value))
  }
  assert.equal(updateFactsOn({}), false, 'off by default')
  for (const file of ['supabase/functions/run_fidrec_pack_v1/index.ts', 'supabase/functions/run_bank_pack_v1/index.ts']) {
    assert.ok(readFileSync(file, 'utf8').includes('fidrecUpdateSectionsEnabled((name) => Deno.env.get(name))'), file)
  }
})

test('(a) switch off: the device finding is left out, so it is not counted, never blocks confirmation and is not in the snapshot', async () => {
  const findings = current(await reconcile([record('access_events', accountSrfCase.data.facts.access_events!.value as AccessEvent[])]))
  assert.ok(findings.some((f) => f.factKey === 'device_recognition'), 'the record lists devices')
  for (const stage of ['bank', 'fidrec'] as const) {
    assert.ok(!findingsForStage(findings, stage, { updateFacts: false }).some((f) => f.factKey === 'device_recognition'), stage)
    const off = stageSnapshot(findings, stage, { updateFacts: false })
    assert.ok(!off.blocks.some((b) => b.factKey === 'device_recognition'), `${stage}: no block`)
    assert.equal(off.facts.device_recognition, undefined, stage)
    // On (and with nothing passed, as Lane 2's tests call it) the question is asked, as before.
    assert.ok(stageSnapshot(findings, stage, { updateFacts: true }).blocks.some((b) => b.factKey === 'device_recognition'), stage)
  }
})

test('(a) switch off: neither the facts screen nor the dashboard paid confirm step shows the device question', () => {
  const service = readFileSync('lib/server/facts/facts-service.ts', 'utf8')
  // Every place the service builds a stage's findings or snapshot passes the switch.
  assert.equal((service.match(/stageSnapshot\(findings, stage, \{ updateFacts/g) ?? []).length, 3)
  assert.ok(service.includes('const findings = findingsForStage(all, stage, { updateFacts })'))
  // The view's device step comes from those findings: with the switch off it is null.
  assert.ok(service.includes('devices: deviceStep(relevant)'))
  // Both screens show the question only through DeviceConfirmation, which renders nothing without a device step.
  const screen = readFileSync('app/(case)/app/case/[id]/facts/_components/device-confirmation.tsx', 'utf8')
  assert.match(screen, /const step = view\?\.devices \?\? null\s*\n\s*if \(!step\) return null/)
  assert.match(readFileSync('app/(case)/app/case/[id]/facts/_components/facts-client.tsx', 'utf8'), /<DeviceConfirmation /)
  assert.match(readFileSync('components/state-machine/facts/confirm-and-evaluate.tsx', 'utf8'), /<DeviceConfirmation /)
  for (const file of ['app/(case)/app/case/[id]/facts/_components/facts-client.tsx', 'components/state-machine/facts/confirm-and-evaluate.tsx']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /view\.devices|deviceStep|device_recognition/, `${file}: no other route to the question`)
  }
})

test('(b) switch off: device answers never reach the model in either pack', () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const facts = c.data.facts as unknown as SnapshotFacts
    const answers = (c.data.facts.device_recognition?.value ?? []) as DeviceRecognition[]
    for (const input of [
      buildFidrecPackInput({ facts, findings: [], storyText: null, finalReplyText: null, evidenceIndex: [] }),
      buildBankPackInput({ facts, findings: [], storyText: null }),
    ]) {
      assert.ok(!('device_recognition' in input.confirmed_facts), c.id)
      assert.ok(!input.facts_without_document.some((f: string) => f.startsWith('device_recognition')), c.id)
      const text = JSON.stringify(input)
      for (const d of answers) {
        if (d.deviceRef) assert.ok(!text.includes(d.deviceRef), `${c.id}: ${d.deviceRef}`)
      }
      assert.doesNotMatch(text, /is not theirs|not_mine|not sure whether/, c.id)
    }
  }
})

const storySays = (factKey: string, v: unknown): FactCandidate =>
  ({ factKey, value: v, sourceType: 'story', sourceRef: { sourceKey: 'story:r1' } }) as FactCandidate

test("(a) switch off: none of the update's facts reaches a paid stage, so the paid snapshot and its hash are as on main", async () => {
  const candidates = [
    record('access_events', accountSrfCase.data.facts.access_events!.value as AccessEvent[]),
    storySays('card_dispute_requested', { value: 'yes', date: '2025-07-05', reference: null, channel: 'email' }),
  ]
  const findings = current(await reconcile(candidates))
  assert.ok(findings.some((f) => PAID_STAGE_ONLY_FACT_KEYS.has(f.factKey)), 'the case has update facts')
  for (const stage of ['bank', 'fidrec'] as const) {
    const off = stageSnapshot(findings, stage, { updateFacts: false })
    assert.deepEqual(Object.keys(off.facts).filter((k) => PAID_STAGE_ONLY_FACT_KEYS.has(k as never)), [], stage)
    assert.ok(!off.blocks.some((b) => PAID_STAGE_ONLY_FACT_KEYS.has(b.factKey as never)), stage)
    // Exactly the snapshot of the same case with no update facts at all (as main builds it).
    const without = findings.filter((f) => !PAID_STAGE_ONLY_FACT_KEYS.has(f.factKey))
    assert.deepEqual(off.facts, stageSnapshot(without, stage).facts, stage)
  }
})

test("(a) switch off: fact extraction stays on main's fact-extract-v3, so no case is re-extracted and no document is read as a record", () => {
  const off = factExtraction({})
  assert.equal(off.version, 'fact-extract-v3')
  assert.equal(off.version, extractionV3.FACT_EXTRACTION_PROMPT_VERSION)
  const prompt = off.buildPrompt('document', 'Synthetic document text.')
  assert.equal(prompt, extractionV3.buildFactExtractionPrompt('document', 'Synthetic document text.'))
  assert.doesNotMatch(prompt, /bank_access_record|card_authentication_record|credit_bureau_report|access_events/)
  const on = factExtraction({ [FIDREC_UPDATE_SECTIONS_ENV]: 'true' })
  assert.equal(on.version, FACT_EXTRACTION_PROMPT_VERSION)
  assert.equal(on.version, 'fact-extract-v4')
  assert.equal(on.buildPrompt('document', 'x'), buildFactExtractionPrompt('document', 'x'))
  // run-reconcile reads the version, the prompt and the parser only through factExtraction.
  const source = readFileSync('lib/server/facts/run-reconcile.ts', 'utf8')
  assert.equal((source.match(/FACT_EXTRACTION_PROMPT_VERSION_V4|buildFactExtractionPromptV4|parseFactExtractionV4/g) ?? []).length, 6, 'imported and used once each, in factExtraction')
  assert.ok(source.includes('const extraction = factExtraction()'))
  assert.ok(source.includes('factExtraction().version,'), 'the input hash uses the same version')
})

test('switch off: document classification keeps main\'s types and definitions (no card authentication record or bureau report type)', () => {
  const fn = readFileSync('supabase/functions/evidence_processed_v2/index.ts', 'utf8')
  assert.ok(fn.includes('const UPDATE_SECTIONS = fidrecUpdateSectionsEnabled((name) => Deno.env.get(name));'))
  assert.ok(fn.includes('const ACTIVE_EVIDENCE_TYPES = UPDATE_SECTIONS ? EVIDENCE_TYPES : EVIDENCE_TYPES.filter((t) => !UPDATE_EVIDENCE_TYPES.has(t));'))
  assert.ok(fn.includes('const ALLOWED_TYPES = new Set(ACTIVE_EVIDENCE_TYPES);'))
  assert.ok(fn.includes('return ACTIVE_EVIDENCE_TYPES.join('), 'the prompt lists only the active types')
  assert.ok(fn.includes('return mapped && ALLOWED_TYPES.has(mapped) ? mapped : null;'), 'a declared new type is not accepted with the switch off')
  assert.ok(fn.includes('return UPDATE_SECTIONS ? evidenceDefinitionsUpdate() : evidenceDefinitionsMain();'))
  assert.ok(fn.includes('"- RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA: raw login logs, IP logs, session/device information."'), "main's definition")
  assert.equal((fn.match(/(?<!ACTIVE_)EVIDENCE_TYPES\.join|new Set\(EVIDENCE_TYPES\)/g) ?? []).length, 0, 'nothing reads the full list directly')
})
