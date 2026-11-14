// The public pages that search engines and AI crawlers may index (brief W1 §L). Plain JavaScript so next.config.mjs
// can share it with lib/seo/indexing.ts; the sitemap, the noindex default and the Link headers all read this list.
export const INDEXABLE_ROUTES = /** @type {const} */ ([
  '/',
  '/how-it-works',
  '/pricing',
  '/product',
  '/about',
  '/marketplace',
  '/faq',
  '/resources',
  '/privacy',
  '/terms',
])

// Addendum A §A4: every indexable page points agents at the machine-readable summary.
export const AGENT_LINK_HEADER = '</llms.txt>; rel="describedby"; type="text/plain"'
