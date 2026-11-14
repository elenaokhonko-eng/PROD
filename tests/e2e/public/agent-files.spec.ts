import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { SKILL_PATH, SKILLS_INDEX_SCHEMA } from '../../../lib/agents/skills'
import { CRAWL_FILE_CACHE_CONTROL } from '../../../lib/seo/public-routes.mjs'
import { SITE_ORIGIN } from '../../../lib/seo/indexing'

// Brief W1 Addendum A, Phase 1 tests.

test('crawl and discovery files carry a 1-hour cache (Cloudflare holds them for 4 hours otherwise)', async ({ request }) => {
  for (const path of ['/robots.txt', '/sitemap.xml', '/llms.txt', SKILL_PATH, '/.well-known/agent-skills/index.json']) {
    const response = await request.get(path)
    expect(response.status(), path).toBe(200)
    expect(response.headers()['cache-control'], path).toBe(CRAWL_FILE_CACHE_CONTROL)
  }
})

test('the agent skill and its index are served, and the digest matches the served file (§A6)', async ({ request }) => {
  const skill = await request.get(SKILL_PATH)
  expect(skill.headers()['content-type']).toMatch(/^text\/markdown/)
  const body = await skill.text()
  expect(body).toMatch(/^---\nname: guidebuoy-scam-help\n/)

  const index = await request.get('/.well-known/agent-skills/index.json')
  expect(index.headers()['content-type']).toMatch(/^application\/json/)
  const json = await index.json()
  expect(json.$schema).toBe(SKILLS_INDEX_SCHEMA)
  expect(json.skills).toHaveLength(1)
  expect(json.skills[0]).toMatchObject({ name: 'guidebuoy-scam-help', type: 'skill-md', url: `${SITE_ORIGIN}${SKILL_PATH}` })
  expect(json.skills[0].digest).toBe(`sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`)
})

test('no discovery file is published for something that does not exist yet (Addendum A)', async ({ request }) => {
  for (const path of [
    '/.well-known/unknown',
    '/.well-known/api-catalog',
    '/.well-known/openid-configuration',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/.well-known/mcp/server-card.json',
    '/.well-known/agent-card.json',
    '/.well-known/http-message-signatures-directory',
  ]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404)
  }
})
