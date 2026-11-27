import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { safeNextPath, signedUpRedirect } from '../../lib/analytics/google-tag'
import { packCards, packHref, routeStops } from '../../lib/harbor/packs'
import { isAwaitingStory, packEntryDestination, parsePack, storylessCaseDestination } from '../../lib/journey/pack-case'

// CR-2 (Elena, 26 Nov 2026): after sign-in everything happens inside My cases (/app); nothing about "this person wanted
// a pack" is carried in the browser across sign-up, story and free evaluation.

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })

const DASHBOARD = 'app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx'

test('every pack card, route stop and pricing button leads to the one pack entry, never to the home page', () => {
  assert.equal(packHref('bank', true), '/start-pack/bank')
  assert.equal(packHref('fidrec', true), '/start-pack/fidrec')
  const hrefs = [
    ...packCards(true).filter((card) => card.paid).map((card) => card.action!.href),
    ...routeStops(true).flatMap((stop) => stop.links).filter((link) => link.label.endsWith('pack')).map((link) => link.href),
  ]
  assert.ok(hrefs.length >= 4)
  for (const href of hrefs) assert.match(href, /^\/start-pack\/(bank|fidrec)$/)
  // Packs off: the Pricing anchors, as before.
  assert.equal(packHref('bank', false), '/pricing#bank-pack')
  assert.equal(packHref('fidrec', false), '/pricing#fidrec-pack')
})

test('the pack entry: sign up first, or straight into the dashboard when signed in', () => {
  assert.equal(parsePack('bank'), 'bank')
  assert.equal(parsePack('fidrec'), 'fidrec')
  for (const other of ['', 'consult', '../app', undefined, null]) assert.equal(parsePack(other), null)

  for (const pack of ['bank', 'fidrec'] as const) {
    assert.equal(packEntryDestination(pack, { live: true, signedIn: true }), `/app/pack/${pack}`)
    const signUp = packEntryDestination(pack, { live: true, signedIn: false })
    assert.equal(signUp, `/sign-up?redirect_url=%2Fapp%2Fpack%2F${pack}`)
    // The new account still passes the sign-up conversion step, then reaches the pack step.
    const next = new URL(signUp, 'https://example.invalid').searchParams.get('redirect_url')
    assert.equal(signedUpRedirect(next), `/signed-up?next=%2Fapp%2Fpack%2F${pack}`)
    assert.equal(safeNextPath(next), `/app/pack/${pack}`)
    assert.equal(packEntryDestination(pack, { live: false, signedIn: true }), `/pricing#${pack}-pack`)
    assert.equal(packEntryDestination(pack, { live: false, signedIn: false }), `/pricing#${pack}-pack`)
  }
  const entry = read('app/(auth)/start-pack/[pack]/page.tsx')
  assert.match(entry, /await auth\(\)/)
  assert.match(entry, /redirect\(packEntryDestination\(pack, \{ live: paidStagesEnabled\(\), signedIn: Boolean\(userId\) \}\)\)/)
})

test('a signed-in person who signs in with nowhere to go lands on My cases', () => {
  assert.match(read('app/(auth)/sign-in/[[...sign-in]]/page.tsx'), /fallbackRedirectUrl="\/app"/)
  const signUp = read('app/(auth)/sign-up/[[...sign-up]]/page.tsx')
  assert.match(signUp, /signInFallbackRedirectUrl="\/app"/)
  assert.match(signUp, /forceRedirectUrl=\{signedUpRedirect\(redirectUrl\)\}/)
})

test('no pack intent is carried in the browser any more', () => {
  for (const path of [
    'lib/journey/pack-intent.ts',
    'components/journey/pack-intent-capture.tsx',
    'components/journey/pack-intent-note.tsx',
    'components/journey/pack-intent-route.tsx',
  ]) {
    assert.equal(existsSync(path), false, path)
  }
  for (const path of ['app', 'components', 'lib', 'hooks'].flatMap(files)) {
    assert.doesNotMatch(read(path), /packIntent|PackIntent|pack-intent|\?intent=|freeEvaluationChosen/, path)
  }
})

test('a case created for a pack waits for its story; no other case does', () => {
  assert.equal(isAwaitingStory({ pack_first_at: '2026-11-27T00:00:00Z', primary_narrative: null }), true)
  assert.equal(isAwaitingStory({ pack_first_at: '2026-11-27T00:00:00Z', primary_narrative: '  ' }), true)
  assert.equal(isAwaitingStory({ pack_first_at: '2026-11-27T00:00:00Z', primary_narrative: 'Synthetic story.' }), false)
  assert.equal(isAwaitingStory({ pack_first_at: null, primary_narrative: null }), false)
  assert.equal(isAwaitingStory({}), false)
})

test('a case with no story returns from Stripe to My cases; a case with a story returns to itself', () => {
  assert.equal(storylessCaseDestination({ checkout: 'success', product: 'self_serve_report' }), '/app?checkout=success&product=self_serve_report')
  assert.equal(storylessCaseDestination({ checkout: 'cancel', product: 'fidrec_tier2_pack' }), '/app?checkout=cancel&product=fidrec_tier2_pack')
  assert.equal(storylessCaseDestination({}), '/app/case/new')
  // Only the known values are passed on; nothing from the address becomes part of the destination.
  assert.equal(storylessCaseDestination({ checkout: 'https://evil.example', product: 'x' }), '/app/case/new')
  assert.equal(storylessCaseDestination({ checkout: 'success', product: '//evil.example' }), '/app/case/new')

  const page = read('app/(case)/app/case/[id]/dashboard/page.tsx')
  assert.match(page, /if \(isAwaitingStory\(caseData\)\) \{[\s\S]*redirect\(storylessCaseDestination\(await searchParams, /)
  // The Stripe addresses are the case's, built on the server and the same on every attempt: the Checkout Session's
  // idempotency key is the purchase, so an address that changed once the story arrived would be refused by Stripe.
  const checkout = read('app/api/payments/create-checkout-session/route.ts')
  assert.match(checkout, /success_url: `\$\{checkoutOrigin\}\/app\/case\/\$\{caseId\}\/dashboard\?checkout=success&product=\$\{productKey\}`/)
  assert.match(checkout, /cancel_url: `\$\{checkoutOrigin\}\/app\/case\/\$\{caseId\}\/dashboard\?checkout=cancel&product=\$\{productKey\}`/)
  assert.doesNotMatch(checkout, /returnUrl|return_url/)
})

test('My cases always offers "Add a new case", and a case awaiting its story leads to the story page', () => {
  const page = read('app/(case)/app/page.tsx')
  assert.equal(page.match(/Add a new case<\/Link>|Add a new case\n\s*<\/Link>/g)?.length, 2, 'the header button and the empty list')
  assert.doesNotMatch(page, /Start a new case/)
  // Elena, 27 Nov: with several cases, the pack being chosen travels in the address to the case picked.
  // Requirements 10.1 (28 Nov): with a pack chosen, a case leads to that pack's payment step (pack-from-my-cases.test.ts).
  assert.ok(page.includes('wanted ? myCasesPackHref(wanted, caseItem.id)'))
})

test('the in-dashboard story page is the story box only, with "Submit the story"', () => {
  const page = read('app/(case)/app/case/new/page.tsx') + read('app/(case)/app/case/new/_components/new-case-steps.tsx')
  assert.match(page, /<NarrativeCapture variant="case" \/>/)
  assert.doesNotMatch(page, /href=|TrustRow|PackComparison|RouteStrip|\/router/)
  const capture = read('components/landing/narrative-capture.tsx')
  assert.match(capture, /inDashboard \? SUBMIT_CASE_STORY : SUBMIT_STORY\}/)
  assert.match(read('lib/harbor/cta.ts'), /SUBMIT_CASE_STORY = 'Submit the story'/)
  assert.match(capture, /\{inDashboard \? null : <p[^>]*>\{ACCOUNT_NOTICE\}<\/p>\}/)
  // Elena, 27 Nov: the server fills the waiting case for any story, so the client sends nothing extra.
  assert.match(capture, /body: JSON\.stringify\(pending\)/)
  assert.match(capture, /router\.push\(`\/app\/case\/\$\{data\.case_id\}\/dashboard`\)/)
  // The public page is unchanged: it still goes to sign-up and then onboarding, and never opens a checkout.
  assert.match(capture, /router\.push\('\/sign-up\?redirect_url=\/onboarding'\)/)
  for (const path of ['components/landing/narrative-capture.tsx', 'app/(auth)/onboarding/page.tsx']) {
    assert.doesNotMatch(read(path), /create-checkout-session|useCreateCheckoutSession|stripe|\/start-pack|\/app\/pack/i, `${path}: the free evaluation never opens Stripe`)
  }
})

test('the story fills the waiting pack case before any new case is created', () => {
  const route = read('app/api/cases/bootstrap/route.ts')
  assert.ok(route.indexOf("rpc('fill_pack_case_v1'") > 0)
  assert.ok(route.indexOf("rpc('fill_pack_case_v1'") < route.indexOf("rpc('bootstrap_case_v1'"))
})

test('the pack step: the server opens one empty case, refuses while the pack is off, and only the service role may', () => {
  const route = read('app/api/cases/pack-first/route.ts')
  assert.match(route, /getCurrentUser\(\)/)
  assert.ok(route.indexOf('productSwitchedOn(') < route.indexOf("rpc('open_pack_case_v1'"), 'refused before anything is created')
  assert.match(route, /product_not_available/)
  assert.match(route, /overCaseLimit\(user\.supabaseUuid\)/)
  assert.match(route, /p_owner_profile_id: user\.supabaseUuid/)

  const page = read('app/(case)/app/pack/[pack]/page.tsx')
  assert.match(page, /getCurrentUser\(\)/)
  assert.match(page, /productSwitchedOn\(PACK_PRODUCT\[pack\]\)/)

  const migration = read('supabase/migrations/20261127120000_pack_first_cases.sql')
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.open_pack_case_v1\(uuid, boolean\) TO service_role;/)
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE)[^;]*pack_first_at/)
  assert.doesNotMatch(migration, /open_pack_case_v1\(uuid, boolean\) TO (authenticated|anon)/)
})

test('the pack step goes straight to Stripe for the bank pack; the FIDReC pack’s payment step asks no question', () => {
  const client = read('app/(case)/app/pack/[pack]/_components/pack-first-client.tsx')
  assert.match(client, /'self_serve_report'/)
  assert.match(client, /<FidrecOffer/)
  assert.match(client, /onBuy=\{\(\) => void buy\('fidrec_tier2_pack'\)\}/)
  // Back from Stripe lands on My cases, not on a step that would open Stripe again or a stuck "Redirecting" screen.
  assert.match(client, /window\.history\.replaceState\(null, '', '\/app'\)\s*window\.location\.assign\(checkout\.url\)/)
  assert.match(client, /if \(event\.persisted\) window\.location\.replace\('\/app'\)/)
  assert.doesNotMatch(client, /href="\/"|push\('\/'\)|replace\('\/'\)/)
})

test('Back from Stripe inside a case clears the "Redirecting to secure payment" screen', () => {
  const dashboard = read(DASHBOARD)
  assert.match(dashboard, /if \(!event\.persisted\) return\s*setCheckoutRedirecting\(false\)\s*setCheckoutProduct\(null\)/)
  assert.match(dashboard, /window\.addEventListener\('pageshow', \w+\)/)
})

test('under the free evaluation: the Bank dispute pack, then the FIDReC pack', () => {
  const dashboard = read(DASHBOARD)
  const draft = dashboard.slice(dashboard.indexOf(") : node === 'S1-Tier0Draft' ? ("), dashboard.indexOf(") : node === 'T-EligibilityGate' ? ("))
  assert.ok(draft.indexOf('<BuyReportCTA') > 0 && draft.indexOf('<BuyReportCTA') < draft.indexOf('{fidrecOffer}'))
})

test('the FIDReC pack report page offers no Bank dispute pack, and shows both packs to someone who has both', () => {
  const dashboard = read(DASHBOARD)
  const reportPage = dashboard.slice(dashboard.indexOf('const renderLayer3 = () => ('), dashboard.indexOf('<div className="min-h-screen bg-background">'))
  assert.ok(reportPage.length > 500)
  assert.doesNotMatch(reportPage, /BuyReportCTA|self_serve_report|NextSteps/)
  assert.match(reportPage, /data-pack-section="fidrec"/)
  assert.match(reportPage, /data-pack-section="bank"/)
  // Elena, 27 Nov: also on the case a pack button chose, only before that case's evaluation (data-asked-pack), and
  // (CR-2 amended) beside a bought FIDReC pack that waits because the bank has not had a written complaint.
  assert.equal(dashboard.split('<BuyReportCTA').length - 1, 3)
})

test('onboarding sends no signed-in person to the public home page', () => {
  const onboarding = read('app/(auth)/onboarding/page.tsx')
  assert.doesNotMatch(onboarding, /href="\/"/)
  assert.match(onboarding, /<Link href="\/app">My cases<\/Link>/)
})

