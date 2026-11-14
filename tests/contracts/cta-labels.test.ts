import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { NO_CARD_LINE, START_EVALUATION, STORY_ANCHOR, SUBMIT_STORY } from '../../lib/harbor/cta'

// Brief W1 §A3: one label for one action. Public pages and their components may use only these two labels for
// starting the free evaluation; the retired variants must not come back.

const RETIRED = [
  'Start free',
  'Start organising — free',
  'Start organising for free',
  'Start free — no card required',
  'Start with the free evaluation',
  'Start your free report',
]

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })

test('the approved labels are the brief\'s wording', () => {
  assert.equal(START_EVALUATION, 'Start my free evaluation')
  assert.equal(SUBMIT_STORY, 'Get my free evaluation')
  assert.equal(STORY_ANCHOR, '/#tell-your-story')
  assert.equal(NO_CARD_LINE, 'Free. No card needed.')
})

test('no public page or component uses a retired start label', () => {
  const sources = ['app/(marketing)', 'components/harbor', 'components/landing'].flatMap(files)
  const offenders = sources.flatMap((path) => {
    const text = readFileSync(path, 'utf8')
    return RETIRED.filter((label) => new RegExp(`['">]${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.'"<]`).test(text)).map(
      (label) => `${path}: "${label}"`,
    )
  })
  // The FAQ answer and the Resources heading are rewritten in their own Batch steps (§J, §K); they are prose, not buttons.
  const allowedProse = ['components/harbor/faq-explorer.tsx: "Start organising for free"', 'app/(marketing)/resources/page.tsx: "Start with the free evaluation"']
  assert.deepEqual(offenders.map((o) => o.replace(/\\/g, '/')).filter((o) => !allowedProse.includes(o)), [])
})

test('the header, the hero and the story form use the shared labels', () => {
  assert.match(readFileSync('components/harbor/public-header.tsx', 'utf8'), /\{START_EVALUATION\}/)
  assert.match(readFileSync('components/harbor/start-evaluation-button.tsx', 'utf8'), /\{START_EVALUATION\}/)
  assert.match(readFileSync('components/landing/narrative-capture.tsx', 'utf8'), /: SUBMIT_STORY\}/)
})
