import { COMPANY } from '@/lib/harbor/company'
import { FAQ_GROUPS, faqAnswer } from '@/lib/harbor/faq'
import { FOUNDER } from '@/lib/content/team'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
import { SITE_ORIGIN } from '@/lib/seo/indexing'

// Brief W1 §L5: JSON-LD built from the same sources as the visible pages (company details, prices, pack state, FAQ,
// team). No LegalService, Attorney, review or rating types: GuideBuoy is not a law firm and has no reviews to show.

type JsonLd = Record<string, unknown>

const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`

export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: COMPANY.brand,
    legalName: COMPANY.legalName,
    identifier: { '@type': 'PropertyValue', propertyID: 'UEN', value: COMPANY.uen },
    url: SITE_ORIGIN,
    logo: `${SITE_ORIGIN}/icon-512.png`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: COMPANY.address.street,
      postalCode: COMPANY.address.postalCode,
      addressLocality: 'Singapore',
      addressCountry: COMPANY.address.country,
    },
    telephone: COMPANY.main.tel,
    email: COMPANY.email,
    ...(COMPANY.linkedin ? { sameAs: [COMPANY.linkedin] } : {}),
  }
}

export function websiteJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: COMPANY.brand,
    url: SITE_ORIGIN,
    publisher: { '@id': ORGANIZATION_ID },
  }
}

// Home and Pricing. Paid offers are PreOrder while the packs are off and InStock once they are live.
export function webApplicationJsonLd(packsLive: boolean): JsonLd {
  const paid = packsLive ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder'
  const offer = (name: string, price: number, availability: string) => ({
    '@type': 'Offer',
    name,
    price: String(price),
    priceCurrency: 'SGD',
    availability,
  })
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: COMPANY.brand,
    url: SITE_ORIGIN,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    areaServed: 'SG',
    provider: { '@id': ORGANIZATION_ID },
    offers: [
      offer('Free evaluation', 0, 'https://schema.org/InStock'),
      offer('Bank dispute pack', PRODUCT_CATALOGUE.self_serve_report.amountSgd, paid),
      offer('FIDReC escalation pack', PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd, paid),
    ],
  }
}

// FAQ: the same questions and answers the page shows.
export function faqPageJsonLd(packsLive: boolean): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_GROUPS.flatMap((group) => group.items).map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: faqAnswer(item, packsLive) },
    })),
  }
}

// About: the founder, only with her consent entry.
export function founderJsonLd(): JsonLd | null {
  if (!FOUNDER) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: FOUNDER.name,
    jobTitle: FOUNDER.title,
    worksFor: { '@id': ORGANIZATION_ID },
    image: `${SITE_ORIGIN}${FOUNDER.photo}`,
    sameAs: [FOUNDER.linkedin],
  }
}

// Guides (brief W1 §O): the article and its place in the site.
export function articleJsonLd(guide: { slug: string; title: string; description: string; reviewedOn: string; reviewedBy: string }): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.description,
    url: `${SITE_ORIGIN}/guides/${guide.slug}`,
    dateModified: guide.reviewedOn,
    reviewedBy: { '@type': 'Person', name: guide.reviewedBy },
    publisher: { '@id': ORGANIZATION_ID },
  }
}

export function breadcrumbJsonLd(items: readonly { name: string; path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE_ORIGIN}${item.path}`,
    })),
  }
}
