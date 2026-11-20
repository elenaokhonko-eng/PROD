import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import test from 'node:test'
import {
  ANALYTICS_SIGN_UP_EVENT,
  GOOGLE_TAG_ID,
  GOOGLE_TAG_MANAGER_ID,
  googleTagSnippet,
  googleTagEnabled,
  googleTagManagerSnippet,
  safeNextPath,
  SIGN_UP_COMPLETED_EVENT,
  signedUpRedirect,
} from '../../lib/analytics/google-tag'

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
    'app/(auth)/signed-up/page.tsx',
    'app/(marketing)/layout.tsx',
    'components/analytics/google-tag-manager.tsx',
  ])
})

test('sign-up completed: a public step reports one event and continues, to this site only', () => {
  assert.equal(SIGN_UP_COMPLETED_EVENT, 'sign_up_completed')
  assert.equal(signedUpRedirect('/onboarding'), '/signed-up?next=%2Fonboarding')
  assert.equal(signedUpRedirect(undefined), '/signed-up?next=%2Fapp')
  for (const unsafe of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '']) {
    assert.equal(safeNextPath(unsafe), '/app', unsafe)
  }
  assert.equal(safeNextPath('/app/case/abc/dashboard?checkout=success'), '/app/case/abc/dashboard?checkout=success')
  const signUp = readFileSync('app/(auth)/sign-up/[[...sign-up]]/page.tsx', 'utf8')
  assert.match(signUp, /forceRedirectUrl=\{signedUpRedirect\(redirectUrl\)\}/)
  const step = readFileSync('components/analytics/sign-up-completed.tsx', 'utf8')
  assert.match(step, /dataLayer\.push\(\{ event: SIGN_UP_COMPLETED_EVENT, eventCallback: go, eventTimeout: 2000 \}\)/)
  assert.match(step, /if \(!report\) \{\s*go\(\)/, 'without the tag (staging) it continues at once')
  // The step is outside the signed-in area, so the tag never loads where cases are.
  assert.doesNotMatch(readFileSync('middleware.ts', 'utf8'), /signed-up/)
})

test('Privacy v2.2 explains the Google tag in the wording Elena approved, and no longer says there are no tracking cookies', () => {
  const privacy = readFileSync('docs/legal/privacy-policy.md', 'utf8').replace(/\r\n/g, '\n')
  assert.match(privacy, /^version: "2\.2"$/m)
  assert.match(privacy, /^replaces: "2\.1 \(14 November 2026\)"$/m)
  const cookies = privacy.slice(privacy.indexOf('## 8.'), privacy.indexOf('## 9.'))
  assert.ok(cookies.includes(
    '**Measuring our website and advertising.** On our public pages and the sign-up page we use Google Tag Manager and Google Analytics, services from Google, to understand how people find GuideBuoy and whether our advertising works. Google may set cookies and receive information about your device and visit, such as your IP address, the pages you viewed and the ad you clicked. This happens only on our public pages: your story, documents and case details are never sent to Google. You can block these cookies in your browser settings.',
  ))
  assert.doesNotMatch(cookies, /We don't use advertising or third-party tracking cookies/)
})

test('the Google tag for Analytics (GT-MR59L657 to G-YFMTYRWZYT) is installed beside Tag Manager, and gets the sign-up', () => {
  assert.equal(GOOGLE_TAG_ID, 'GT-MR59L657')
  assert.equal(googleTagSnippet(), "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','GT-MR59L657');")
  const component = readFileSync('components/analytics/google-tag-manager.tsx', 'utf8')
  assert.match(component, /src=\{`https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=\$\{GOOGLE_TAG_ID\}`\}/)
  assert.equal(ANALYTICS_SIGN_UP_EVENT, 'sign_up')
  assert.match(readFileSync('components/analytics/sign-up-completed.tsx', 'utf8'), /w\.gtag\?\.\('event', ANALYTICS_SIGN_UP_EVENT/)
})
