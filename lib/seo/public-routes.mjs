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

// Cloudflare caches .txt and .xml for 4 hours unless the origin says otherwise (lesson of 14 Nov, runbook
// web-release-and-cloudflare). Crawl and discovery files set a 1-hour cache so a change reaches crawlers within the hour.
export const CRAWL_FILE_CACHE_CONTROL = 'public, max-age=3600'
export const CRAWL_FILE_PATHS = ['/robots.txt', '/sitemap.xml', '/llms.txt', '/.well-known/:path*']

// Addendum A §A4: every indexable page points agents at the machine-readable summary.
export const AGENT_LINK_HEADER = '</llms.txt>; rel="describedby"; type="text/plain"'
