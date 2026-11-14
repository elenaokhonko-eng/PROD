import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { AI_CRAWLERS, INDEXABLE_ROUTES, ROBOTS_TXT } from '../../lib/seo/indexing'
import { enumeratePageRoutes } from '../seo-routes'

const source = (file: string) => readFileSync(file, 'utf8')

// Brief W1 §L4: only public marketing pages may be indexed; a new route is noindex unless it opts in.
test('pages are noindex by default and only marketing pages opt in', () => {
  const root = source('app/layout.tsx')
  assert.match(root, /robots: NOINDEX/)
  assert.doesNotMatch(root, /alternates:/, 'a site-wide canonical points every page at the home page')
  assert.match(root, /<html lang="en-SG"/)
  assert.match(source('app/(marketing)/layout.tsx'), /robots: INDEX\b/)

  const routes = enumeratePageRoutes()
  for (const path of INDEXABLE_ROUTES) {
    const route = routes.find((r) => r.path === path)
    assert.ok(route, `indexable route ${path} has a page`)
    assert.ok(route.marketing, `${path} is indexable but sits outside the marketing layout`)
    assert.match(source(route.file), new RegExp(`canonical: '${path}'`), `${path} sets its own canonical`)
  }
  for (const route of routes.filter((r) => r.marketing && !INDEXABLE_ROUTES.includes(routePath(r)))) {
    assert.match(source(route.file), /robots: NOINDEX/, `${route.path} is a marketing page that is not listed as indexable`)
  }
})

test('robots.txt matches Addendum A §A1: content signals, the AI crawlers and identical rules in both groups', () => {
  const groups = ROBOTS_TXT.trimEnd().split('\n\n')
  const briefRules =
    'Content-Signal: search=yes, ai-input=yes, ai-train=yes\nAllow: /\nDisallow: /app\nDisallow: /onboarding\nDisallow: /sign-in\nDisallow: /sign-up\nDisallow: /api'
  assert.equal(groups[0], `User-agent: *\n${briefRules}`)
  // The addendum's list, plus Claude-Web, which Cloudflare's AI-rules check names. D1 allows them all on public pages.
  for (const agent of [
    'OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'Claude-SearchBot', 'Claude-User', 'ClaudeBot', 'Claude-Web',
    'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Amazonbot', 'CCBot', 'Bytespider',
    'meta-externalagent', 'DuckAssistBot',
  ]) {
    assert.ok(AI_CRAWLERS.includes(agent as (typeof AI_CRAWLERS)[number]), agent)
  }
  assert.equal(groups[1], `${AI_CRAWLERS.map((a) => `User-agent: ${a}`).join('\n')}\n${briefRules}`)
  assert.equal(groups[2], 'Sitemap: https://guidebuoyai.sg/sitemap.xml')
  assert.equal(groups.length, 3)
})

test('the marketplace is public and indexed (Elena, 14 Nov)', () => {
  assert.ok(INDEXABLE_ROUTES.includes('/marketplace'))
})

function routePath(r: { path: string }) {
  return r.path as (typeof INDEXABLE_ROUTES)[number]
}
