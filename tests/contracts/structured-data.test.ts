import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { COMPANY_UEN } from '../../components/harbor/trust-row'
import { COMPANY } from '../../lib/harbor/company'
import { FAQ_GROUPS, faqAnswer } from '../../lib/harbor/faq'
import { PRODUCT_CATALOGUE } from '../../lib/payments/product-catalogue'
import {
  faqPageJsonLd,
  founderJsonLd,
  organizationJsonLd,
  webApplicationJsonLd,
  websiteJsonLd,
} from '../../lib/seo/structured-data'

// Brief W1 §L5 (Release 4): structured data from the same sources as the visible pages.

const FORBIDDEN_TYPES = /"@type":"(LegalService|Attorney|Review|AggregateRating|Rating)"/

test('§L5: Organization carries the company details shown in the footer', () => {
  const org = organizationJsonLd()
  assert.equal(org['@type'], 'Organization')
  assert.equal(org.name, 'GuideBuoy AI')
  assert.equal(org.legalName, 'GuideBuoy AI SG Pte Ltd')
  assert.deepEqual(org.identifier, { '@type': 'PropertyValue', propertyID: 'UEN', value: COMPANY_UEN })
  assert.equal(COMPANY.uen, COMPANY_UEN, 'one UEN across the trust row, footer and structured data')
  assert.equal(org.email, 'info@guidebuoyai.sg')
  assert.equal('sameAs' in org, COMPANY.linkedin !== null, 'sameAs only once Elena supplies the LinkedIn page')
  assert.match(readFileSync('components/harbor/public-footer.tsx', 'utf8'), /\{COMPANY\.legalName\}[\s\S]*\{COMPANY\.uen\}[\s\S]*\{COMPANY\.address\.display\}/)
  assert.equal(websiteJsonLd()['@type'], 'WebSite')
})

test('§L5: the three offers follow the catalogue prices and the pack state', () => {
  for (const live of [false, true]) {
    const app = webApplicationJsonLd(live)
    assert.equal(app['@type'], 'WebApplication')
    assert.equal(app.applicationCategory, 'BusinessApplication')
    assert.equal(app.areaServed, 'SG')
    const offers = app.offers as { name: string; price: string; priceCurrency: string; availability: string }[]
    assert.deepEqual(offers.map((o) => [o.name, o.price, o.priceCurrency]), [
      ['Free evaluation', '0', 'SGD'],
      ['Bank dispute pack', String(PRODUCT_CATALOGUE.self_serve_report.amountSgd), 'SGD'],
      ['FIDReC escalation pack', String(PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd), 'SGD'],
    ])
    const paid = live ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder'
    assert.deepEqual(offers.map((o) => o.availability), ['https://schema.org/InStock', paid, paid])
  }
})

test('§J, §L5: FAQPage has exactly the questions and answers the FAQ page shows', () => {
  for (const live of [false, true]) {
    const faq = faqPageJsonLd(live)
    const entries = faq.mainEntity as { name: string; acceptedAnswer: { text: string } }[]
    const items = FAQ_GROUPS.flatMap((group) => group.items)
    assert.deepEqual(entries.map((e) => e.name), items.map((i) => i.question))
    assert.deepEqual(entries.map((e) => e.acceptedAnswer.text), items.map((i) => faqAnswer(i, live)))
  }
  assert.match(readFileSync('components/harbor/faq-explorer.tsx', 'utf8'), /from '@\/lib\/harbor\/faq'/, 'the page reads the same list')
})

test('§J: the FAQ follows the brief: 17 questions in four groups, pack answers say "Coming shortly." while off', () => {
  assert.deepEqual(FAQ_GROUPS.map((g) => [g.title, g.items.length]), [['Start', 5], ['What you get', 6], ['Cost', 2], ['Privacy', 4]])
  const bank = FAQ_GROUPS[1].items[1]
  assert.equal(faqAnswer(bank, false), 'A concise, formal complaint to your bank with your key facts and evidence. S$18, one-off. Coming shortly.')
  assert.equal(faqAnswer(bank, true), 'A concise, formal complaint to your bank with your key facts and evidence. S$18, one-off.')
  const refund = FAQ_GROUPS[2].items[1]
  assert.deepEqual(refund.link, { label: 'Terms, clause 6.4', href: '/terms#section-6' })
  const privacy = FAQ_GROUPS[3].items[1]
  assert.deepEqual(privacy.link, { label: 'Privacy Policy, sections 3 and 4', href: '/privacy#section-3' })
  assert.match(readFileSync('components/harbor/faq-explorer.tsx', 'utf8'), /<Accordion type="multiple"/, 'any number of answers open at once')
})

test('§G, §L5: the founder is a Person working for the organisation', () => {
  const person = founderJsonLd()
  assert.ok(person)
  assert.equal(person['@type'], 'Person')
  assert.equal(person.name, 'Elena Okhonko')
  assert.deepEqual(person.worksFor, { '@id': 'https://guidebuoyai.sg/#organization' })
})

test('§L5: no legal-service, attorney, review or rating markup anywhere', () => {
  const all = [organizationJsonLd(), websiteJsonLd(), webApplicationJsonLd(false), webApplicationJsonLd(true), faqPageJsonLd(false), founderJsonLd()]
  for (const data of all) assert.doesNotMatch(JSON.stringify(data), FORBIDDEN_TYPES)
  const code = readFileSync('lib/seo/structured-data.ts', 'utf8').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(code, /LegalService|Attorney|AggregateRating/)
})

test('§L5: each page publishes its structured data', () => {
  const read = (file: string) => readFileSync(`app/(marketing)/${file}`, 'utf8')
  assert.match(read('layout.tsx'), /<JsonLd data=\{organizationJsonLd\(\)\} \/>[\s\S]*<JsonLd data=\{websiteJsonLd\(\)\} \/>/)
  assert.match(read('page.tsx'), /<JsonLd data=\{webApplicationJsonLd\(packsLive\)\} \/>/)
  assert.match(read('pricing/page.tsx'), /<JsonLd data=\{webApplicationJsonLd\(paidStagesState\(\)\.enabled\)\} \/>/)
  assert.match(read('faq/page.tsx'), /<JsonLd data=\{faqPageJsonLd\(packsLive\)\} \/>/)
  assert.match(read('about/page.tsx'), /<JsonLd data=\{founderJsonLd\(\)\} \/>/)
})
