import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { guideAction, isOfficialSource, loadGuides, loadPublishedGuides, publishProblems } from '../../lib/guides/guides'
import { publishedGuideFiles } from '../../lib/guides/guide-files.mjs'
import { PUBLISHED_GUIDES } from '../../lib/guides/published.mjs'
import { resourcesOrGuides } from '../../lib/navigation'
import { articleJsonLd, breadcrumbJsonLd } from '../../lib/seo/structured-data'
import { publishedModule } from '../../scripts/build-guide-index.mjs'

// Brief W1 §O (Release 5): the Guides scaffolding. The site ships with zero guides; these tests use synthetic fixtures.

const FIXTURES = 'tests/fixtures/guides'

test('§O: the site ships with zero guides, and the committed index matches content/guides', () => {
  assert.deepEqual(publishedGuideFiles(), [])
  assert.deepEqual(PUBLISHED_GUIDES, [])
  assert.equal(readFileSync('lib/guides/published.mjs', 'utf8').replace(/\r\n/g, '\n'), publishedModule(publishedGuideFiles()))
  assert.match(readFileSync('package.json', 'utf8'), /"build": "node scripts\/build-guide-index\.mjs && next build/)
})

test('§O: a guide is parsed from its header and body: links, sub-headings and numbered lists', () => {
  const [draft, published] = loadGuides(FIXTURES)
  assert.equal(draft.status, 'draft')
  assert.equal(published.slug, 'example-published')
  assert.equal(published.stage, 'reported')
  assert.equal(published.reviewedBy, 'Test Reviewer')
  assert.deepEqual(published.sources.map((s) => s.url), ['https://www.scamshield.gov.sg/', 'https://www.fidrec.com.sg/'])
  assert.deepEqual(published.blocks.map((b) => b.kind === 'heading' ? `h${b.level}` : b.kind === 'list' ? (b.ordered ? 'ol' : 'ul') : 'p'), ['h2', 'p', 'h3', 'ol', 'ul'])
  const paragraph = published.blocks[1]
  assert.ok(paragraph.kind === 'paragraph')
  assert.deepEqual(paragraph.inlines, [
    { text: 'A paragraph with ' },
    { text: 'bold', bold: true },
    { text: ' text and a ' },
    { text: 'link to Resources', href: '/resources' },
    { text: '.' },
  ])
})

test('§O: only published guides are shown; drafts are never routable or listed', () => {
  assert.deepEqual(loadPublishedGuides(FIXTURES).map((g) => g.slug), ['example-published'])
  assert.deepEqual(publishedGuideFiles(FIXTURES).map((g) => g.slug), ['example-published'])
})

test('§O: a published guide without a reviewer, a date or an official source stops the build', () => {
  const [broken] = loadGuides('tests/fixtures/guides-broken')
  assert.deepEqual(publishProblems(broken), [
    'reviewed_by is empty',
    'reviewed_on is not a date (YYYY-MM-DD)',
    'no source on an official site',
    'source is not an official site: https://example.com/post',
  ])
  assert.throws(() => loadPublishedGuides('tests/fixtures/guides-broken'), /Published guides are incomplete/)
  assert.ok(isOfficialSource('https://www.police.gov.sg/'))
  assert.ok(isOfficialSource('https://www.dbs.com.sg/personal/contact-us'))
  assert.ok(!isOfficialSource('http://www.scamshield.gov.sg/'), 'https only')
  assert.ok(!isOfficialSource('https://gov.sg.example.com/'))
})

test('§O, §E3: the call to action follows the stage and the pack state', () => {
  assert.deepEqual(guideAction('reported', false), { kind: 'evaluation' })
  assert.deepEqual(guideAction('reported', true), { kind: 'pack', label: 'Prepare my bank complaint', href: '/sign-in?intent=bank' })
  assert.deepEqual(guideAction('final-reply', true), { kind: 'pack', label: 'Prepare my FIDReC case', href: '/sign-in?intent=fidrec' })
  assert.deepEqual(guideAction('just-happened', true), { kind: 'evaluation' })
})

test('§O: Article and BreadcrumbList structured data; Guides replaces Resources in the menu only once published', () => {
  const [, guide] = loadGuides(FIXTURES)
  const article = articleJsonLd(guide)
  assert.equal(article['@type'], 'Article')
  assert.equal(article.url, 'https://guidebuoyai.sg/guides/example-published')
  assert.deepEqual(article.reviewedBy, { '@type': 'Person', name: 'Test Reviewer' })
  const crumbs = breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Guides', path: '/guides' }])
  assert.equal(crumbs['@type'], 'BreadcrumbList')
  assert.equal((crumbs.itemListElement as { position: number }[])[1].position, 2)
  assert.deepEqual(resourcesOrGuides(0), { href: '/resources', label: 'Resources' })
  assert.deepEqual(resourcesOrGuides(1), { href: '/guides', label: 'Guides' })
  const page = readFileSync('app/(marketing)/guides/[slug]/page.tsx', 'utf8')
  for (const part of ['>Sources<', 'Last reviewed', '<WhatGuideBuoyIs', 'articleJsonLd(guide)', 'breadcrumbJsonLd(']) assert.ok(page.includes(part), part)
})
