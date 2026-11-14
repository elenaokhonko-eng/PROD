import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// Stage 1 demo review, 6 Nov 2026: copy rules for every user-facing surface of the free path.

const ROOTS = ['app', 'components', 'lib/harbor', 'supabase/functions/bright-function', 'supabase/functions/_shared/facts']

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(tsx?|ts)$/.test(name) ? [path] : []
  })
}

// Code comments may use internal names; only the text a person can see is checked.
function visible(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const sources = ROOTS.flatMap(files).map((path) => ({ path, text: visible(readFileSync(path, 'utf8')) }))

function offenders(pattern: RegExp): string[] {
  return sources.filter((s) => pattern.test(s.text)).map((s) => s.path)
}

test('E1: one name. "Lumi" never appears as text (component and asset names may keep it)', () => {
  assert.deepEqual(offenders(/(?<![A-Za-z/_-])Lumi(?![A-Za-z])/), [])
})

test('D2: consultation is offered by email, never "not currently available"', () => {
  assert.deepEqual(offenders(/consultation[^'"`]{0,40}not currently available/i), [])
})

test('D1: paid packs say "Coming shortly" (Elena, 14 Nov), never a date', () => {
  assert.deepEqual(offenders(/Available from/), [])
})

test('C1/D4: no internal names in titles and copy: Tier-0, "the server confirms"', () => {
  assert.deepEqual(offenders(/\(Tier-0\)|title: "[^"]*Tier/), [])
  assert.deepEqual(offenders(/the server confirms/i), [])
})

test('D3: the automated-output notice carries the consultation offer wherever it appears', () => {
  const old = /Generated automatically by GuideBuoy AI\. It has not been reviewed by a person\./
  assert.deepEqual(offenders(old), [])
})

test('D3 / Terms 2.2: every output, on screen and in every download, shows the automated-output notice', () => {
  const notice = 'Generated automatically by GuideBuoy AI using a pre-built workflow. It has not been reviewed by a person. For a human review, book a consultation (S$99 / 30 min).'
  assert.equal(readFileSync('lib/legal/automated-output-notice.ts', 'utf8').includes(notice), true)
  const outputs = [
    'components/state-machine/layer1/tier0-draft-view.tsx',
    'components/state-machine/layer2/report-view.tsx',
    'components/state-machine/layer3/tier2-pack-view.tsx',
    'lib/server/facts/free-evaluation-pdf.ts',
    'lib/server/fidrec/build-case-pack-pdf.ts',
    'lib/server/fidrec/build-case-pack-markdown.ts',
  ]
  const missing = outputs.filter((path) => {
    const text = readFileSync(path, 'utf8')
    return !text.includes(notice) && !/(addParagraph|lines\.push)\(AUTOMATED_OUTPUT_NOTICE\)/.test(text)
  })
  assert.deepEqual(missing, [])
})

test('B1/E1 (Elena, 7 Nov): the story box shows the worked example; the about page uses "Tell us once", not the buoy metaphor', () => {
  const capture = readFileSync('components/landing/narrative-capture.tsx', 'utf8')
  // Addendum V §V4 (Elena, 14 Nov): the same worked example, shown as text under the box; the placeholder is one line.
  assert.match(capture, /STORY_EXAMPLE =\s*"For example: On 12 March 2026, at about 9 pm, I received an email that looked like it came from my bank\./)
  assert.match(capture, /<blockquote[^>]*>\{STORY_EXAMPLE\}<\/blockquote>/)
  assert.match(capture, /STORY_PLACEHOLDER = 'Start anywhere\. You can edit it before you continue\.'/)
  assert.match(capture, /placeholder=\{STORY_PLACEHOLDER\}/)
  assert.match(capture, /In total about S\$9,800 was taken from my savings account and S\$3,100 charged to my credit card\./)
  const about = readFileSync('app/(marketing)/about/page.tsx', 'utf8')
  assert.match(about, /Tell us once\./)
  assert.match(about, /You stay in control of every fact and every document you share\./)
  assert.doesNotMatch(about, /A buoy does not pull you out of the water/)
})

test('The free product is called the free evaluation, never "Free Case Pack"', () => {
  assert.deepEqual(offenders(/Free Case Pack/i), [])
})

test('The unfinished story is described as kept in the browser tab, matching sessionStorage (Elena, 7 Nov)', () => {
  assert.match(readFileSync('components/landing/hero-capture.tsx', 'utf8'), /sessionStorage\.setItem\(STORAGE_KEY/)
  assert.match(readFileSync('components/landing/narrative-capture.tsx', 'utf8'), /It is deleted when you close the tab\./)
  assert.match(readFileSync('docs/legal/privacy-policy.md', 'utf8'), /it is deleted when you close the tab\./)
  assert.deepEqual(offenders(/(stays on|restored from|retained in) this (device|browser so)/), [])
})

test('C6 / E12: the FIDReC fee for an individual is S$50 at adjudication (ToR Annex 1 6.6), never S$250', () => {
  // One value, quoted from the ToR clause, used by the card (walkthrough, 8 Nov: the config still said S$250).
  const { FIDREC_RULES } = require('../../lib/facts') as typeof import('../../lib/facts')
  assert.deepEqual(FIDREC_RULES.adjudicationFeeSgd, { individual: 50, charityOrSmallBusiness: 250, cite: 'Annex 1, 6.6' })
  const card = readFileSync('components/state-machine/facts/next-steps.tsx', 'utf8')
  assert.match(card, /if your case goes to adjudication, FIDReC charges individuals a S\$\$\{FIDREC_RULES\.adjudicationFeeSgd\.individual\} case fee\./)
  assert.equal(card.match(/within 6 months of your bank’s final reply/g)?.length, 1, 'the general timing is written once, shown only without a case note')
  assert.match(card, /\{note \? \([\s\S]*?\) : card\.product === 'fidrec_pack' \? \([\s\S]*?\{FIDREC_TIMING\}/)
  assert.deepEqual(offenders(/S\$250/), [])
  assert.doesNotMatch(readFileSync('supabase/functions/_shared/facts/rules/fidrec.ts', 'utf8'), /refundableSgd/)
})
