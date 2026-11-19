import { PUBLISHED_GUIDES } from '../guides/published.mjs'

// Brief W1 §O: the Guides index and each published guide, only once at least one guide is published.
export const GUIDE_ROUTES = PUBLISHED_GUIDES.length ? ['/guides', ...PUBLISHED_GUIDES.map((guide) => `/guides/${guide.slug}`)] : []

// The public pages that search engines and AI crawlers may index (brief W1 §L). Plain JavaScript so next.config.mjs
// can share it with lib/seo/indexing.ts; the sitemap, the noindex default and the Link headers all read this list.
export const PAGE_ROUTES = /** @type {const} */ ([
  '/',
  '/how-it-works',
  '/pricing',
  '/about',
  '/marketplace',
  '/faq',
  '/resources',
  '/privacy',
  '/terms',
])

/** @type {readonly string[]} */
export const INDEXABLE_ROUTES = [...PAGE_ROUTES, ...GUIDE_ROUTES]

// Cloudflare caches .txt and .xml for 4 hours unless the origin says otherwise (lesson of 14 Nov, runbook
// web-release-and-cloudflare). Crawl and discovery files set a 1-hour cache so a change reaches crawlers within the hour.
export const CRAWL_FILE_CACHE_CONTROL = 'public, max-age=3600'
export const CRAWL_FILE_PATHS = ['/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt', '/auth.md', '/.well-known/:path*']

// Addendum A §A4: every indexable page points agents at the machine-readable summary.
export const AGENT_LINK_HEADER = '</llms.txt>; rel="describedby"; type="text/plain"'

// Addendum M §M1: every indexable page has a markdown copy at its path plus ".md" ("/" → "/index.md"), generated at
// build time from the page's prerendered HTML (scripts/build-markdown-copies.mjs). The key is the copy's file name.
// Menu order, which /llms.txt and /llms-full.txt follow (§M5). A guide's copy is named "guides-<slug>" (one path
// segment, as the markdown route expects) and is built from its prerendered HTML at `html`.
/** @type {readonly { name: string, route: string, label: string, html?: string }[]} */
export const MARKDOWN_COPIES = ([
  { name: 'index', route: '/', label: 'Home' },
  { name: 'how-it-works', route: '/how-it-works', label: 'How it works' },
  { name: 'pricing', route: '/pricing', label: 'Pricing' },
  { name: 'resources', route: '/resources', label: 'Resources' },
  { name: 'about', route: '/about', label: 'About' },
  { name: 'faq', route: '/faq', label: 'FAQ' },
  // Off the menu but still indexed (Elena, 14 Nov; confirmed 18 Nov).
  { name: 'marketplace', route: '/marketplace', label: 'Marketplace' },
  { name: 'terms', route: '/terms', label: 'Terms of Service' },
  { name: 'privacy', route: '/privacy', label: 'Privacy Policy' },
  ...(PUBLISHED_GUIDES.length ? [{ name: 'guides', route: '/guides', label: 'Guides' }] : []),
  ...PUBLISHED_GUIDES.map((guide) => ({ name: `guides-${guide.slug}`, route: `/guides/${guide.slug}`, label: guide.title, html: `guides/${guide.slug}.html` })),
])

/** @param {string} route */
export const markdownPath = (route) => `/${MARKDOWN_COPIES.find((copy) => copy.route === route)?.name ?? ''}.md`

/** Addendum A §A4: the describedby link, plus the page's own markdown copy. @param {string} route */
export const pageLinkHeader = (route) => `${AGENT_LINK_HEADER}, <${markdownPath(route)}>; rel="alternate"; type="text/markdown"`

// Where the build writes the copies, relative to the app's working directory.
export const MARKDOWN_OUTPUT_DIR = '.next/markdown'
