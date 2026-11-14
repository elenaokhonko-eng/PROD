import type { Metadata } from 'next'

// Brief W1 §L: only public marketing pages are indexed. Everything else, including any route added later,
// inherits NOINDEX from the root layout and must opt in here to be crawled.
export const SITE_ORIGIN = 'https://guidebuoyai.sg'

export const INDEXABLE_ROUTES = [
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
] as const

export const INDEX: Metadata['robots'] = { index: true, follow: true }
export const NOINDEX: Metadata['robots'] = { index: false, follow: false }

// Private areas, closed to every crawler.
const PRIVATE_PATHS = ['/app', '/onboarding', '/sign-in', '/sign-up', '/api']

// AI crawlers named explicitly so their rules are visible (Cloudflare AI Crawl Control, RFC 9309 groups). Decision
// D1 (Elena, 13 Nov): search, training and user-triggered crawlers are all allowed on public pages.
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'Claude-Web',
  'Google-Extended',
  'Applebot-Extended',
  'PerplexityBot',
  'Perplexity-User',
  'CCBot',
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
] as const

const rules = ['Allow: /', ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`)]

// Brief W1 §L1, plus one group for the named AI crawlers with the same rules (a crawler that matches a named group
// ignores the * group, so the rules are repeated there).
export const ROBOTS_TXT =
  [
    'User-agent: *',
    ...rules,
    '',
    ...AI_CRAWLERS.map((agent) => `User-agent: ${agent}`),
    ...rules,
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
  ].join('\n') + '\n'
