import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { FOUNDER_NOTE, visibleTeam, type TeamMember } from '../../lib/content/team'
import { MARKDOWN_COPIES } from '../../lib/seo/public-routes.mjs'
import { indexNowKey, routesForChangedFiles, submission } from '../../scripts/indexnow-submit'

// Brief W1 §G, §L6, §L8 (Release 4).

const about = readFileSync('app/(marketing)/about/page.tsx', 'utf8')

test('§G: the founder note is word for word, and About ends with the primary button', () => {
  assert.equal(
    FOUNDER_NOTE,
    'I started GuideBuoy after helping friends through almost identical scam and fraud cases, one after another. I have also had to find my own way through a confusing system, and it felt stacked against the person who was harmed. GuideBuoy is my attempt to level the playing field a little.',
  )
  assert.match(about, />Why GuideBuoy exists\.</)
  assert.match(about, /\{FOUNDER_NOTE\}/)
  assert.equal(about.match(/<WhatGuideBuoyIs /g)?.length, 1, 'one "What GuideBuoy is" block')
  assert.ok(about.lastIndexOf('<StartEvaluationButton />') > about.indexOf('<ContactCard />'), 'primary button at the end')
})

test('§G: only people who gave their OK are shown, in order', () => {
  const member = (name: string, consent: boolean, order: number): TeamMember =>
    ({ name, title: 't', line: '', photo: null, linkedin: null, consent, order })
  assert.deepEqual(
    visibleTeam([member('B', true, 2), member('C', false, 1), member('A', true, 1)]).map((m) => m.name),
    ['A', 'B'],
  )
  assert.match(about, /const team = visibleTeam\(\)/)
})

test('§G: "Check this company" names the company, UEN and address, with the BizFile check', () => {
  assert.match(about, />Check this company</)
  assert.match(about, /\{COMPANY\.legalName\} · UEN \{COMPANY\.uen\} · \{COMPANY\.address\.display\}/)
  assert.match(about, /<UenCheck \/>/)
})

// §L6: every indexable page has its own preview metadata and a 1200 × 630 image showing its headline.
const PAGE_FILES: Record<string, string> = {
  '/': '', '/how-it-works': 'how-it-works/', '/pricing': 'pricing/', '/resources': 'resources/', '/about': 'about/',
  '/faq': 'faq/', '/marketplace': 'marketplace/', '/terms': 'terms/', '/privacy': 'privacy/',
}

test('§L6: every indexable page has its own preview and preview image', () => {
  assert.deepEqual(Object.keys(PAGE_FILES).sort(), MARKDOWN_COPIES.map((c) => c.route).sort())
  for (const [route, dir] of Object.entries(PAGE_FILES)) {
    const page = readFileSync(`app/(marketing)/${dir}page.tsx`, 'utf8')
    assert.match(page, new RegExp(`\\.\\.\\.pagePreview\\('${route.replace('/', '\\/')}', `), route)
    const image = `app/(marketing)/${dir}opengraph-image.tsx`
    assert.ok(existsSync(image), image)
    const source = readFileSync(image, 'utf8')
    assert.match(source, /export const size = \{ width: 1200, height: 630 \}/, image)
    const headline = source.match(/export const alt = '(.*)'/)?.[1]
    assert.ok(headline && (page.includes(headline) || /^(Terms of Service|Privacy Policy)$/.test(headline)), `${image}: the page's own headline`)
  }
  assert.doesNotMatch(readFileSync('app/layout.tsx', 'utf8'), /lumi-buoy\.jpg/, 'no square avatar as the site-wide preview')
  assert.match(readFileSync('lib/seo/og-image.tsx', 'utf8'), /fontSize: 40/)
  assert.doesNotMatch(readFileSync('lib/seo/og-image.tsx', 'utf8'), /fontSize: ([0-3]\d|\d)\b/, 'no text below 40 px')
})

test('§L8: IndexNow submits only indexable public pages', () => {
  const key = indexNowKey()
  assert.match(key, /^[0-9a-f]{32}$/)
  const body = submission(['/', '/faq'], key)
  assert.deepEqual(body, {
    host: 'guidebuoyai.sg',
    key,
    keyLocation: `https://guidebuoyai.sg/${key}.txt`,
    urlList: ['https://guidebuoyai.sg/', 'https://guidebuoyai.sg/faq'],
  })
  for (const route of ['/app', '/sign-in', '/api/cases/bootstrap', '/router', '/analytics']) {
    assert.throws(() => submission([route], key), /not an indexable public page/, route)
  }
})

test('§L8: changed files map to the public pages they affect', () => {
  assert.deepEqual(routesForChangedFiles(['app/(marketing)/faq/page.tsx', 'docs/legal/privacy-policy.md']), ['/faq', '/privacy'])
  assert.deepEqual(routesForChangedFiles(['app/(marketing)/page.tsx']), ['/'])
  assert.deepEqual(routesForChangedFiles(['supabase/migrations/x.sql', 'app/(case)/app/page.tsx', 'tests/x.ts']), [])
  assert.equal(routesForChangedFiles(['components/harbor/public-footer.tsx']).length, MARKDOWN_COPIES.length)
})
