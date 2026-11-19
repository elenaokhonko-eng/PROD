import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { SAMPLE_BANNER, assertSampleIsFictional, loadSampleRows, sampleBundle, type SampleRow } from '../../lib/samples/free-evaluation'

// Brief W1 §H (Release 5): the free-evaluation sample of the fictional case (Elena, 19 Nov). The bank and FIDReC pack
// samples wait for the paid packs.

const row = (text: string, narrative_type = 'tier0_summary'): SampleRow =>
  ({ narrative_type, title: null, text_content: text, created_at: '2026-11-19T00:00:00Z', version: 1, language: 'en', audience: null })

test('§H: the banner is word for word, and the page is not indexed until Elena approves it', () => {
  assert.equal(SAMPLE_BANNER, 'Sample. A fictional case. Names, dates, amounts and institutions are invented.')
  const page = readFileSync('app/(marketing)/sample/evaluation/page.tsx', 'utf8')
  assert.match(page, /\{SAMPLE_BANNER\}/)
  assert.match(page, /robots: NOINDEX/)
  assert.doesNotMatch(page, /onRefresh|footerSlot|factsHref/, 'read-only: no refresh, next-step or edit controls')
})

test('§H: the sample must be fictional: Harbourline, no real institution, no email, no ID', () => {
  assert.doesNotThrow(() => assertSampleIsFictional([row('Harbourline Bank refused to refund Mei Ling Tan.')]))
  for (const text of [
    'Harbourline and DBS both said no.',
    'Harbourline Bank. Contact mei.ling@example.com.',
    'Harbourline case 3986abc4-24e7-4bf0-adff-8fe0236a9835.',
    'The bank refused.',
  ]) assert.throws(() => assertSampleIsFictional([row(text)]), undefined, text)
  assert.throws(() => assertSampleIsFictional([row('Harbourline', 'tier0_evidence_checklist')]), /no free-evaluation summary/)
})

test('§H: the sample offers no download, because it has no case behind it', () => {
  const bundle = sampleBundle([row('Harbourline Bank refused.'), row('Checklist', 'tier0_evidence_checklist')])
  assert.equal(bundle.tier0_summary?.case_id, '')
  assert.equal(bundle.tier0_evidence_checklist?.text_content, 'Checklist')
  const stored = loadSampleRows()
  if (stored) assert.ok(stored.length > 0, 'the frozen sample passes the fictional check')
})

test('§H: the generator runs only against staging and never in CI', () => {
  const config = readFileSync('tests/e2e/playwright.samples.config.ts', 'utf8')
  assert.match(config, /must be the staging site/)
  assert.match(config, /testDir: '\.\/samples'/)
  for (const name of readdirSync('tests/e2e').filter((f) => /^playwright\..*config\.ts$/.test(f) && f !== 'playwright.samples.config.ts')) {
    assert.doesNotMatch(readFileSync(`tests/e2e/${name}`, 'utf8'), /samples/, `${name} does not run the sample generator`)
  }
  assert.doesNotMatch(readFileSync('tests/e2e/config.ts', 'utf8'), /['"]samples['"]/)
})
