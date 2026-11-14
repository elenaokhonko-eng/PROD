import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { markdownNameForPath, markdownNameForRoute, prefersMarkdown } from '../../lib/seo/markdown'
import { INDEXABLE_ROUTES, MARKDOWN_COPIES, markdownPath } from '../../lib/seo/public-routes.mjs'

// Addendum M §M3 and §M6: the format follows the Accept header, never the client.
const CHROME_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'

test('markdown only when text/markdown is named and ranked above HTML', () => {
  assert.equal(prefersMarkdown('text/markdown'), true)
  assert.equal(prefersMarkdown('text/markdown, text/html;q=0.9'), true)
  assert.equal(prefersMarkdown('text/markdown;q=0.9, */*;q=0.1'), true)
  assert.equal(prefersMarkdown('text/html'), false)
  assert.equal(prefersMarkdown('*/*'), false)
  assert.equal(prefersMarkdown(CHROME_ACCEPT), false)
  assert.equal(prefersMarkdown('text/html, text/markdown'), false)
  assert.equal(prefersMarkdown('text/markdown;q=0'), false)
  assert.equal(prefersMarkdown(''), false)
  assert.equal(prefersMarkdown(null), false)
})

test('every indexable page has a copy, and nothing else does', () => {
  assert.deepEqual([...MARKDOWN_COPIES.map((copy) => copy.route)].sort(), [...INDEXABLE_ROUTES].sort())
  assert.equal(markdownPath('/'), '/index.md')
  assert.equal(markdownNameForPath('/pricing.md'), 'pricing')
  assert.equal(markdownNameForRoute('/'), 'index')
  for (const path of ['/sign-in.md', '/sign-up.md', '/onboarding.md', '/app.md', '/api/cases.md', '/auth.md', '/pricing']) {
    assert.equal(markdownNameForPath(path), null, path)
  }
})

test('no part of the markdown path reads the user agent', () => {
  for (const file of ['lib/seo/markdown.ts', 'lib/seo/markdown-files.ts', 'app/markdown/[page]/route.ts', 'scripts/build-markdown-copies.mjs']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /user-?agent/i, file)
  }
  const middleware = readFileSync('middleware.ts', 'utf8')
  const branch = middleware.slice(middleware.indexOf('Addendum M §M3'), middleware.indexOf('NextResponse.rewrite('))
  assert.ok(branch.length > 0)
  assert.doesNotMatch(branch, /userAgent|user-agent/i)
})

test('pnpm build makes the copies and checks them against their pages', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
  assert.match(pkg.scripts.build, /next build && node scripts\/build-markdown-copies\.mjs/)
})
