import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import test from 'node:test'
import { GOOGLE_TAG_MANAGER_ID, googleTagEnabled, googleTagManagerSnippet } from '../../lib/analytics/google-tag'

// Elena, 20 Nov 2026: Google campaign tracking on the public pages. Never in the signed-in case area, never on staging.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(entry) ? [path.split(sep).join('/')] : []
  })
}

test('production only', () => {
  assert.equal(googleTagEnabled({ HARBOR_DEPLOYMENT_ENVIRONMENT: 'production' }), true)
  for (const value of [undefined, '', 'preview', 'staging']) {
    assert.equal(googleTagEnabled({ HARBOR_DEPLOYMENT_ENVIRONMENT: value }), false, String(value))
  }
})

test("Google's standard container snippet, with the page-load event that 'All pages' triggers need", () => {
  assert.equal(GOOGLE_TAG_MANAGER_ID, 'GTM-WD9X2LV2')
  const snippet = googleTagManagerSnippet()
  assert.match(snippet, /'gtm\.start':new Date\(\)\.getTime\(\),event:'gtm\.js'/)
  assert.match(snippet, /https:\/\/www\.googletagmanager\.com\/gtm\.js\?id='\+i\+dl/)
  assert.match(snippet, /'dataLayer','GTM-WD9X2LV2'/)
})

test('on every public marketing page and the sign-up page, and nowhere in the signed-in area', () => {
  assert.match(readFileSync('app/(marketing)/layout.tsx', 'utf8'), /<GoogleTagManager \/>/)
  assert.match(readFileSync('app/(auth)/sign-up/[[...sign-up]]/page.tsx', 'utf8'), /<GoogleTagManager \/>/)
  const users = [...files('app'), ...files('components')].filter((path) => /GoogleTagManager|googletagmanager/.test(readFileSync(path, 'utf8')))
  assert.deepEqual(users.sort(), [
    'app/(auth)/sign-up/[[...sign-up]]/page.tsx',
    'app/(marketing)/layout.tsx',
    'components/analytics/google-tag-manager.tsx',
  ])
})
