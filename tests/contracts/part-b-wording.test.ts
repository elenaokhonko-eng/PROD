import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Wording from the Part B walk-through register (docs/release/part-b-walkthrough-2026-11-25.md), approved by Elena on
// 25 Nov 2026.
const read = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ')
const DASHBOARD = 'app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx'

test('PB-3: after confirming, the paid step names what is still missing', () => {
  const evidence = read('components/state-machine/facts/pack-evidence.tsx')
  assert.ok(evidence.includes('police_report: \'your police report\''))
  assert.ok(evidence.includes('const sentence = `Add ${list} to generate your ${PACK_NAMES[product]}.`'))
  const step = read('components/state-machine/facts/confirm-and-evaluate.tsx')
  assert.ok(step.includes('? addMissingEvidenceText(stage, missingEvidence)'))
  const dashboard = read(DASHBOARD)
  assert.ok(dashboard.includes('missingEvidence={packEvidence.bank.missing}'))
  assert.ok(dashboard.includes('missingEvidence={packEvidence.fidrec.missing}'))
})

test('PB-4: the bank pack offer names the SRF and the EUPG', () => {
  assert.ok(read('components/state-machine/transition/buy-report-cta.tsx').includes(
    'A structured complaint report organised against Singapore&apos;s Shared Responsibility Framework (SRF) and the MAS E-Payments User Protection Guidelines (EUPG), ready for you to review before sending.',
  ))
})

test('PB-6: no "Consultation unavailable" button anywhere; the booking line stays', () => {
  for (const path of [DASHBOARD, 'components/state-machine/layer3/consult-cta.tsx', 'components/state-machine/layer3/specialist-card.tsx']) {
    const text = read(path)
    assert.ok(!text.includes('Consultation unavailable'), path)
    assert.ok(text.includes('Email info@guidebuoyai.sg to book.'), path)
  }
})

test('PB-16: every pack button on the pricing cards is filled', () => {
  const cards = read('components/harbor/pack-comparison.tsx')
  assert.ok(cards.includes('<Button asChild variant="default" className="w-full text-base font-semibold">'))
  assert.ok(!cards.includes("card.paid ? 'outline'"))
})

test('PB-21: a document read as none of the items says so on the police report row', () => {
  const evidence = read('components/state-machine/facts/pack-evidence.tsx')
  assert.ok(evidence.includes(
    'We read this document, but it does not look like a police report. If it is one, choose it below and press “This is my police report”.',
  ))
  assert.ok(evidence.includes("unrecognised={status.item === 'police_report' && !status.added ? unrecognisedDocuments(ready) : []}"))
  assert.ok(evidence.includes('!d.complainant_item && !(d.verified_document_type && KNOWN_TYPES.has(d.verified_document_type))'))
})
