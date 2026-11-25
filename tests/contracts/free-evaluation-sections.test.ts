import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assessSrf,
  EVIDENCE_MISSING_HEADING,
  EVIDENCE_SHOWN_HEADING,
  evidenceListsText,
  reportItNowText,
  srfAssessmentText,
  srfFactsFromSnapshot,
} from '../../lib/facts'
import { buildFreeEvaluationPdf } from '../../lib/server/facts/free-evaluation-pdf'

// Stage 1 demo review, 6 Nov 2026 (findings C2-C5). All values are synthetic.

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const yes = { value: 'yes', date: '2026-10-03', reference: null, channel: null }
const no = { value: 'no', date: null, reference: null, channel: null }

test('C2: the evidence checklist is two lists: what documents show, and what has no document yet with examples', () => {
  const facts = {
    total_loss: { value: { ...sgd(2400), account: 'savings_or_current' }, label: 'confirmed' as const },
    reported_to_police: { value: yes, label: 'claimant_only' as const },
    reported_to_bank: { value: no, label: 'confirmed' as const },
  }
  const findings = [
    {
      factKey: 'total_loss' as const,
      values: [{ value: facts.total_loss.value, sources: [{ sourceType: 'document' as const, sourceRef: { documentName: '17. Synthetic Person statement.pdf', documentType: 'bank_statement' } }] }],
      resolution: { kind: 'agreed' as const },
    },
    {
      factKey: 'reported_to_police' as const,
      values: [{ value: yes, sources: [{ sourceType: 'story' as const, sourceRef: {} }] }],
      resolution: { kind: 'acknowledged' as const },
    },
  ]
  const text = evidenceListsText(facts, findings)
  const [shown, missing] = text.split('\n\n')
  assert.ok(shown.startsWith(EVIDENCE_SHOWN_HEADING))
  assert.match(shown, /Amount lost: Bank account: S\$2,400\. Shown by your bank statement \(uploaded\)\./)
  assert.doesNotMatch(text, /Synthetic Person|\.pdf/, 'documents are named by kind, never by file name (walkthrough, 8 Nov)')
  assert.ok(missing.startsWith(EVIDENCE_MISSING_HEADING))
  assert.match(missing, /Whether you reported this to the police: Yes, 3 Oct 2026\. No document yet; for example the police report/)
  assert.doesNotMatch(text, /Whether you told your bank/, '"No" needs no document')
})

test('C4: "Report it now" appears only while the bank or the police have not been told, and lists no phone numbers for banks', () => {
  const bankOnly = reportItNowText({ reported_to_bank: { value: no, label: 'confirmed' }, reported_to_police: { value: yes, label: 'confirmed' } })!
  assert.match(bankOnly, /24-hour fraud hotline/)
  assert.doesNotMatch(bankOnly, /police report online/)
  assert.match(bankOnly, /ScamShield Helpline on 1799/)
  assert.doesNotMatch(bankOnly.replace('1799', ''), /\d{4}/, 'no bank phone numbers that could go out of date')
  assert.equal(reportItNowText({ reported_to_bank: { value: yes, label: 'confirmed' }, reported_to_police: { value: yes, label: 'confirmed' } }), null)
})

test('C3: each part of the loss is assessed under the rules that apply to it, with the terms explained', () => {
  const facts = srfFactsFromSnapshot({
    scam_type: { value: ['phishing_sms_or_message'], label: 'confirmed' },
    phishing_channel: { value: 'sms', label: 'confirmed' },
    credentials_or_otp_shared: { value: 'entered_on_fake_site_or_app', label: 'confirmed' },
    impersonated_entity_type: { value: 'bank_or_fi', label: 'confirmed' },
    total_loss: {
      value: { ...sgd(3500), account: null, portions: [{ account: 'savings_or_current', amount: sgd(2400) }, { account: 'credit_card', amount: sgd(1100) }] },
      label: 'confirmed',
    },
  })
  const text = srfAssessmentText(assessSrf(facts))
  // Labelled by what the portion holds: here a bank account only (walkthrough, 8 Nov).
  assert.match(text, /^Bank account payments \(S\$2,400\): Likely covered by the SRF$/m)
  assert.doesNotMatch(text, /e-wallet payments \(/)
  assert.match(text, /^Card payments \(S\$1,100\): Card rules apply, not the SRF$/m)
  assert.match(text, /E-Payments User Protection Guidelines \(EUPG\)/)
  assert.match(text, /chargeback/)
  // Cards (Elena, 8 Nov): the ABS card code and a chargeback decide card losses; the EUPG only adds issuer duties.
  assert.match(text, /ABS Code of Practice for Banks – Credit Cards/)
  assert.match(text, /capped at S\$100, unless you acted fraudulently or with gross negligence, or did not tell the issuer as soon as reasonably practicable \(5\(a\)\)/)
  assert.match(text, /you are not liable \(6\(a\)\)/)
  assert.match(text, /do not decide card losses \(1\.2, 5\.1\)/)
  assert.doesNotMatch(text, /card transactions are assessed under the MAS E-Payments/i)
  assert.doesNotMatch(text, /your bank or card issuer/)
  for (const term of ['SRF', 'EUPG', 'MAS', 'IMDA', 'FIDReC']) assert.match(text, new RegExp(`^- ${term}: `, 'm'), term)
  assert.doesNotMatch(text, /Shared Responsibility Framework \(SRF\): an early view/, 'the heading is not repeated inside the section')
})

// Rules review, 25 Nov (row 8, wording chosen by Elena): the EUPG's rule for payments the account user knew of, and
// FIDReC's wider assessment as MAS's SRF workflow states it. Before, "not covered by a liability framework" had no source.
test('C3: payments made knowingly are told the EUPG rule for them and what FIDReC assesses, with sources', () => {
  const a = assessSrf({ scamTypes: ['investment'], channel: 'social_media', credentials: 'not_shared', impersonated: 'other_business', transactions: null, losses: null })
  const text = srfAssessmentText(a)
  assert.ok(text.includes('Under the EUPG, the account holder is liable for payments an account user knew of and consented to, up to the agreed limits (paragraph 5.3).'))
  // The next step stays (rules review, 25 Nov): the person can still complain to the bank.
  assert.ok(text.includes('(paragraph 5.3). You can complain to your bank in writing. MAS'))
  assert.ok(text.includes("MAS's workflow for the SRF states that FIDReC's assessment includes obligations outside the SRF, for example under statute, common law or the EUPG."))
  assert.doesNotMatch(text, /not covered by a liability framework/)
  assert.equal(a.remedies!.cite, 'E para 5.3; W (mas.srf.workflow/recourse.fidrec); R para 6.11(d)')
})

test('C5: the free evaluation downloads as a PDF with the notice, even with characters the PDF fonts lack', async () => {
  const pdf = await buildFreeEvaluationPdf([
    { narrative_type: 'tier0_summary', title: 'Free evaluation summary', text_content: 'You received an SMS on 3 Oct 2026 — “urgent” ✓', created_at: '2026-11-07T00:00:00Z' },
    { narrative_type: 'tier0_srf_signal', title: 'How the rules may apply', text_content: 'Line one\nLine two', created_at: '2026-11-07T00:00:00Z' },
  ])
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-')
  const route = readFileSync('app/api/cases/[caseId]/free-evaluation/pdf/route.ts', 'utf8')
  assert.match(route, /const access = await factsCaseAccess\(caseId\)\s*if \(access instanceof NextResponse\) return access/)
  assert.match(route, /const supabase = await createUserClient\(\)/, 'read with the user’s own client (RLS)')
})
