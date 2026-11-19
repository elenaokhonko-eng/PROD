import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import nextConfig from '../../next.config.mjs'
import { marketingNavLinks } from '../../lib/navigation'
import { BANK_HOTLINES, LAST_CHECKED, OFFICIAL_SOURCES } from '../../lib/resources/official-help'
import { INDEXABLE_ROUTES, MARKDOWN_COPIES } from '../../lib/seo/public-routes.mjs'

// Brief W1 §I (Release 3, navigation and page clean-up), with Elena's decisions of 18 Nov.

test('§I: the main menu is How it works, Pricing, Resources, About, FAQ', () => {
  assert.deepEqual(
    marketingNavLinks.map((link) => [link.label, link.href]),
    [
      ['How it works', '/how-it-works'],
      ['Pricing', '/pricing'],
      ['Resources', '/resources'],
      ['About', '/about'],
      ['FAQ', '/faq'],
    ],
  )
})

test('§I: /product is retired with a permanent redirect to How it works', async () => {
  const redirects = await nextConfig.redirects!()
  assert.deepEqual(
    redirects.find((r) => r.source === '/product'),
    { source: '/product', destination: '/how-it-works', permanent: true },
  )
  assert.equal(existsSync('app/(marketing)/product/page.tsx'), false)
  assert.ok(!(INDEXABLE_ROUTES as readonly string[]).includes('/product'))
  assert.ok(!MARKDOWN_COPIES.some((copy) => (copy.route as string) === '/product'))
})

test('§I: Marketplace leaves the menu, stays a public indexed page, and loses the consultation card', () => {
  assert.ok(!marketingNavLinks.some((link) => link.href === '/marketplace'))
  assert.ok((INDEXABLE_ROUTES as readonly string[]).includes('/marketplace'), 'Elena, 14 and 18 Nov: still indexed')
  const page = readFileSync('app/(marketing)/marketplace/page.tsx', 'utf8')
  assert.doesNotMatch(page, /Human consultation availability|Human consultation: S\$99|S\$99/)
})

test('§I: How it works carries the report outline, two start buttons, and no complaint-paths row', () => {
  const page = readFileSync('app/(marketing)/how-it-works/page.tsx', 'utf8')
  assert.match(page, /'Summary', 'Chronology', 'Transactions', 'Evidence', 'Open questions', 'Limitations'/)
  assert.match(page, /actionAfterStep=\{4\} action=\{<StartEvaluationButton \/>\}/)
  assert.equal(page.match(/<StartEvaluationButton \/>/g)?.length, 2)
  assert.doesNotMatch(page, /Complaint paths in plain words|PathwayChip/, 'Elena, 18 Nov: the row is removed')
})

test('§I: the not-found page links to Home, How it works and FAQ', () => {
  const page = readFileSync('app/not-found.tsx', 'utf8')
  for (const href of ['/', '/how-it-works', '/faq']) assert.match(page, new RegExp(`<Link href="${href}"`), href)
})

// Each hotline comes from the bank's own website; the check date is shown on the page.
const BANK_DOMAINS: Record<string, string> = {
  'DBS / POSB': 'dbs.com.sg',
  OCBC: 'ocbc.com',
  UOB: 'uob.com.sg',
  'Standard Chartered': 'sc.com',
  HSBC: 'hsbc.com.sg',
  Citibank: 'citibank.com.sg',
  Maybank: 'maybank2u.com.sg',
  'Bank of China': 'bankofchina.com',
  ICBC: 'icbc.com.sg',
  CIMB: 'cimb.com.sg',
  'Trust Bank': 'trustbank.sg',
  'GXS Bank': 'gxs.com.sg',
  MariBank: 'maribank.sg',
}

test('§I: every bank hotline is sourced from the bank’s own website and dialable', () => {
  assert.match(LAST_CHECKED, /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(BANK_HOTLINES.map((line) => line.bank), Object.keys(BANK_DOMAINS))
  for (const line of BANK_HOTLINES) {
    const host = new URL(line.sourceUrl).hostname
    assert.equal(new URL(line.sourceUrl).protocol, 'https:', line.bank)
    assert.ok(host === BANK_DOMAINS[line.bank] || host.endsWith(`.${BANK_DOMAINS[line.bank]}`), `${line.bank}: ${host}`)
    assert.match(line.tel, /^\+65\d{8,11}$/, line.bank)
    assert.equal(line.tel.slice(3), line.phone.replace(/\D/g, ''), `${line.bank}: tel matches the printed number`)
  }
})

test('§I: the official sources follow the brief’s order and link to official sites', () => {
  assert.deepEqual(OFFICIAL_SOURCES.map((s) => s.id), ['scamshield', 'police', 'moneysense', 'fidrec', 'mas'])
  for (const source of OFFICIAL_SOURCES) {
    assert.ok(source.line.length > 0, source.id)
    for (const url of [source.link.href, source.sourceUrl]) {
      assert.match(new URL(url).hostname, /(\.gov\.sg|fidrec\.com\.sg)$/, `${source.id}: ${url}`)
    }
  }
})

// Elena, 19 Nov: Clifford Law LLP as the first legal partner, greyed out and labelled until confirmed.
test('Marketplace shows the first legal partner as pending, with the firm’s website', async () => {
  const { PARTNERS, MARKETPLACE_INTRO } = await import('../../lib/content/partners')
  assert.equal(PARTNERS.length, 1)
  const [partner] = PARTNERS
  assert.equal(partner.heading, 'First legal partner, pending confirmation')
  assert.equal(partner.status, 'pending')
  assert.deepEqual(partner.website, { label: 'Clifford Law LLP website', href: 'https://www.cliffordlaw.sg/' })
  assert.ok(existsSync(`public${partner.photo}`))
  assert.doesNotMatch(MARKETPLACE_INTRO, /not referrals, partnerships/, 'the intro no longer denies any partnership')
  const page = readFileSync('app/(marketing)/marketplace/page.tsx', 'utf8')
  assert.match(page, /intro=\{MARKETPLACE_INTRO\}/)
  assert.match(page, /pending && 'opacity-60 grayscale'/)
  assert.match(page, /\{PENDING_LABEL\}/)
})
