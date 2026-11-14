import type { Metadata } from 'next'

// Brief W1 §L: only public marketing pages are indexed. Everything else, including any route added later,
// inherits NOINDEX from the root layout and must opt in here to be crawled.
export const SITE_ORIGIN = 'https://guidebuoyai.sg'

import { markdownPath } from './public-routes.mjs'

export { INDEXABLE_ROUTES } from './public-routes.mjs'

// Addendum M §M5: an indexable page's canonical address and its markdown copy, for the page's metadata.
export const pageAlternates = (route: string): Metadata['alternates'] => ({
  canonical: route,
  types: { 'text/markdown': markdownPath(route) },
})

export const INDEX: Metadata['robots'] = { index: true, follow: true }
export const NOINDEX: Metadata['robots'] = { index: false, follow: false }

// Private areas, closed to every crawler.
export const PRIVATE_PATHS = ['/app', '/onboarding', '/sign-in', '/sign-up', '/api'] as const

// AI crawlers named explicitly so their rules are visible (Addendum A §A1, Cloudflare AI Crawl Control).
// Claude-Web is kept beyond the addendum's list because Cloudflare's AI-rules check names it.
export const AI_CRAWLERS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'GPTBot',
  'Claude-SearchBot',
  'Claude-User',
  'ClaudeBot',
  'Claude-Web',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Amazonbot',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
  'DuckAssistBot',
] as const

// Decision D1 (Elena, 13 Nov): search, AI answers and AI training are all allowed on public pages.
export const CONTENT_SIGNAL = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes'

// Both groups are built from the same lines: a crawler that matches a named group ignores the * group, so every
// Disallow must be repeated there (Addendum A §A1).
const groupRules = [CONTENT_SIGNAL, 'Allow: /', ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`)]

export const ROBOTS_TXT =
  [
    'User-agent: *',
    ...groupRules,
    '',
    ...AI_CRAWLERS.map((agent) => `User-agent: ${agent}`),
    ...groupRules,
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
  ].join('\n') + '\n'
