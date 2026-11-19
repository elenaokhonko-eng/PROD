import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { FOUNDER, FOUNDER_NOTE, PENDING_LABEL, TEAM, teamGroup } from '../../lib/content/team'
import { founderJsonLd } from '../../lib/seo/structured-data'
import { MARKDOWN_COPIES } from '../../lib/seo/public-routes.mjs'
import { indexNowKey, routesForChangedFiles, submission } from '../../scripts/indexnow-submit'
import { OG_PAGES } from '../../scripts/render-og-images'

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

test('§G: the team and advisers follow Elena’s order, each with a photo and LinkedIn (inputs approved 19 Nov)', () => {
  assert.deepEqual(teamGroup('team').map((m) => m.name), ['Elena Okhonko', 'Maria Baranova', 'Stepan Kropachev', 'Federico Folcia', 'Nick (Ng Yuin Harng)'])
  assert.deepEqual(teamGroup('adviser').map((m) => m.name), ['Sergey Anosov', 'Greg Woolf', 'Viviene Sandhu'])
  for (const member of TEAM) {
    assert.ok(existsSync(`public${member.photo}`), `${member.name}: photo`)
    const jpeg = readFileSync(`public${member.photo}`)
    assert.equal(jpeg.readUInt16BE(0), 0xffd8, `${member.name}: a JPEG`)
    assert.match(member.linkedin, /^https:\/\/www\.linkedin\.com\/in\/[\w-]+\/$/, member.name)
    assert.ok(member.title && member.line, member.name)
  }
  assert.equal(FOUNDER?.name, 'Elena Okhonko')
  assert.equal(FOUNDER?.title, 'Founder & CEO')
  assert.match(about, /— \{FOUNDER\.name\}, founder/, 'the brief’s sign-off, word for word')
})

test('§G: a pending card is greyed out, labelled and has no LinkedIn link, and is not in structured data', () => {
  assert.deepEqual(TEAM.filter((m) => m.status === 'pending').map((m) => m.name), ['Viviene Sandhu'])
  assert.equal(PENDING_LABEL, 'Pending finalisation')
  assert.match(about, /pending && 'opacity-60 grayscale'/)
  assert.match(about, /\{pending \? \(\s*<p[^>]*>\{PENDING_LABEL\}<\/p>/)
  assert.match(about, /\{pending \? null : \(\s*<a href=\{member\.linkedin\}/)
  const person = founderJsonLd()!
  assert.equal(person.image, 'https://guidebuoyai.sg/assets/team/elena.jpg')
  assert.deepEqual(person.sameAs, ['https://www.linkedin.com/in/elenaokhonko/'])
  assert.doesNotMatch(readFileSync('lib/seo/structured-data.ts', 'utf8'), /TEAM\b|teamGroup/, 'only the founder is published as a Person')
})

test('§V5: the mascot is the transparent cut-out everywhere except the in-app chat', () => {
  const uses = execFileSync('git', ['grep', '-l', 'lumi-buoy.jpg', '--', 'app', 'components', 'lib'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  assert.deepEqual(uses, ['components/lumi-chat.tsx'], 'only the in-app chat keeps the old square image (out of scope)')
  for (const size of [72, 192, 320]) {
    const png = readFileSync(`public/assets/harbor/lumi-${size}.png`)
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [size, size], `lumi-${size}.png`)
    assert.equal(png[25], 6, `lumi-${size}.png has an alpha channel (RGBA)`)
    assert.ok(existsSync(`public/assets/harbor/lumi-${size}.webp`), `lumi-${size}.webp`)
  }
})

test('§G: "Check this company" names the company, UEN and address, with the BizFile check', () => {
  assert.match(about, />Check this company</)
  assert.match(about, /\{COMPANY\.legalName\} · UEN \{COMPANY\.uen\} · \{COMPANY\.address\.display\}/)
  assert.match(about, /<UenCheck \/>/)
})

// §L6: every indexable page has its own preview metadata and a 1200 × 630 image showing its headline.
const PAGE_FILES: Record<string, string> = {
  '/': '', '/how-it-works': 'how-it-works/', '/pricing': 'pricing/', '/resources': 'resources/', '/about': 'about/',
  '/faq': 'faq/', '/marketplace': 'marketplace/', '/terms': 'terms/', '/privacy': 'privacy/', '/sample/evaluation': 'sample/evaluation/',
}

test('§L6: every indexable page has its own preview and preview image', () => {
  assert.deepEqual(Object.keys(PAGE_FILES).sort(), MARKDOWN_COPIES.map((c) => c.route).sort())
  for (const [route, dir] of Object.entries(PAGE_FILES)) {
    const page = readFileSync(`app/(marketing)/${dir}page.tsx`, 'utf8')
    assert.match(page, new RegExp(`\\.\\.\\.pagePreview\\('${route.replace('/', '\\/')}', `), route)
    // Static images rendered by scripts/render-og-images.tsx (next/og cannot run on Windows in Next 14).
    const image = `app/(marketing)/${dir}opengraph-image.png`
    assert.ok(existsSync(image), image)
    const png = readFileSync(image)
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630], image)
    const headline = readFileSync(`app/(marketing)/${dir}opengraph-image.alt.txt`, 'utf8')
    assert.equal(headline, OG_PAGES[dir], `${image}: rendered from the script's headline`)
    assert.ok(page.includes(headline) || /^(Terms of Service|Privacy Policy)$/.test(headline), `${image}: the page's own headline`)
  }
  assert.deepEqual(Object.keys(OG_PAGES).sort(), Object.values(PAGE_FILES).sort())
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
