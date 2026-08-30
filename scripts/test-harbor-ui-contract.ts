import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { HARBOR_FUNCTIONALITY_CONTRACT } from '../lib/harbor/functionality-contract'

const ROOT = process.cwd()

function readSource(path: string) {
  return readFileSync(join(ROOT, path), 'utf8')
}

function sourceTree(...roots: string[]) {
  const files: string[] = []
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const entryPath = join(path, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(entryPath)
    }
  }
  roots.forEach((root) => visit(join(ROOT, root)))
  return files.map((file) => readFileSync(file, 'utf8')).join('\n')
}

const productionSource = sourceTree('app', 'components', 'hooks', 'lib')
const dashboardSource = readSource('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx')
const onboardingSource = readSource('app/(auth)/onboarding/page.tsx')
const routerSource = readSource('app/router/page.tsx')
const narrativeCaptureSource = readSource('components/landing/narrative-capture.tsx')
const settingsSource = readSource('app/(case)/app/settings/_components/settings-client.tsx')
const stateMachineSource = readSource('hooks/state-machine/use-state-machine.ts')
const paymentStatusSource = readSource('hooks/state-machine/transition/use-payment-status.ts')
const paymentLandingSource = readSource('components/state-machine/transition/payment-success-landing.tsx')
const resourceDirectorySource = readSource('components/harbor/resource-directory.tsx')
const resourceRouteSource = readSource('app/api/resources/route.ts')

function protects(markers: readonly string[]) {
  for (const marker of markers) {
    assert.ok(productionSource.includes(marker), `Missing protected UI contract marker: ${marker}`)
  }
}

describe('Harbor UI functionality contract', () => {
  it('defines every protected workflow boundary and existing owner', () => {
    assert.deepEqual(Object.keys(HARBOR_FUNCTIONALITY_CONTRACT), [
      'narrative-capture',
      'evidence-upload',
      'questions',
      'case-dashboard',
      'checkout',
      'report-lifecycle',
      'tier-2',
      'settings',
    ])

    for (const [flow, contract] of Object.entries(HARBOR_FUNCTIONALITY_CONTRACT)) {
      assert.ok(contract.entryRoutes.length > 0, `${flow} needs an entry route`)
      assert.ok(contract.uiOwners.length > 0, `${flow} needs a UI owner`)
      assert.ok(contract.dataOwners.length > 0, `${flow} needs a data owner`)
      for (const owner of contract.uiOwners) {
        assert.ok(existsSync(join(ROOT, owner)), `${flow} owner does not exist: ${owner}`)
      }
    }
  })

  it('preserves narrative capture while using the canonical authenticated bootstrap', () => {
    protects([
      '/api/router/session',
      '/api/transcribe',
      '/api/router/classify',
      '/api/router/assess',
      'story_submitted',
      '/router/classify',
      '/router/results',
      '/sign-up?redirect_url=/onboarding',
    ])
    assert.match(onboardingSource, /readPendingNarrative/)
    assert.match(onboardingSource, /\/api\/cases\/bootstrap/)
    assert.match(onboardingSource, /router_conversion_imported/)
    assert.match(routerSource, /clearPendingNarrative\(\)/)
    assert.doesNotMatch(onboardingSource, /create-from-session/)
    assert.doesNotMatch(narrativeCaptureSource, /createRouterSession|updateRouterSession|getSessionToken/)
    assert.match(readSource('lib/analytics/client.ts'), /NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY/)
    assert.match(readSource('app/api/analytics/track/route.ts'), /sessionId: z\.string\(\)\.nullable\(\)\.optional\(\)/)
    assert.doesNotMatch(readSource('app/layout.tsx'), /PendingNarrativeHandoff/)
    assert.doesNotMatch(readSource('components/landing/hero-capture.tsx'), /Clerk|unsafeMetadata/)
  })

  it('preserves the upload and authenticated question pipelines', () => {
    protects([
      '/api/evidence/upload',
      '/evidence/process',
      '/responses',
      '/api/edge/extract',
      '/api/edge/tier0',
      'v_case_validation_gap_items',
      "from('case_documents')",
    ])
  })

  it('preserves authoritative dashboard and report lifecycle owners', () => {
    protects([
      "rpc('get_case_eligibility'",
      '/capabilities',
      "from('case_decision_runs')",
      "from('reports')",
      '/job-status',
      'useStateMachine',
    ])
    assert.doesNotMatch(paymentStatusSource, /from\(['"]case_entitlements['"]\)/)
    assert.match(paymentStatusSource, /capabilityBilling\.capabilities/)
    assert.match(paymentStatusSource, /reconciliationRequired/)
    assert.match(stateMachineSource, /eligible_actions\.run_report_selfserve/)
    assert.match(dashboardSource, /eligible_actions\.run_escalation_pack/)
    assert.match(dashboardSource, /reportCapability\?\.canCheckout/)
    assert.match(dashboardSource, /fidrecCapability\?\.canCheckout/)
  })

  it('keeps one server-authoritative checkout and gates unavailable products', () => {
    protects([
      '/api/payments/create-checkout-session',
      'JSON.stringify({ caseId, productKey })',
      'PRODUCT_CATALOGUE',
      'self_serve_report',
      'fidrec_tier2_pack',
      'window.location.assign(checkout.url)',
    ])
    assert.doesNotMatch(dashboardSource, /human_consult_30m|useSubmitContactRequest|ContactRequest/)
    assert.match(dashboardSource, /Human consultation is not currently available\./)
    assert.match(paymentLandingSource, /checking the server-recorded payment and access status/)
    assert.match(dashboardSource, /searchParams\.get\('checkout'\) !== 'cancel'/)
    assert.match(dashboardSource, /<PaymentCancelled/)
    assert.match(dashboardSource, /canStartCheckout\(cancelledProduct\)/)
    assert.match(dashboardSource, /handleCheckout\(cancelledProduct\)/)
    assert.match(dashboardSource, /hasInvalidPaymentReturn/)
    assert.match(dashboardSource, /Invalid payment return product/)
    assert.match(dashboardSource, /paymentReturnProduct !== null && !returnedProductIsEntitled/)
    assert.doesNotMatch(paymentLandingSource, /few seconds|payment received|payment is safe/i)
  })

  it('keeps retired and policy-blocked API and marketing paths absent', () => {
    for (const retiredPath of [
      'app/api/cases/[caseId]/generate-pack/route.ts',
      'app/api/cases/[caseId]/regenerate/route.ts',
      'app/api/subscriptions',
      'app/api/payments/create-subscription',
      'app/api/payments/create-portal-session',
      'app/pricing/page.tsx',
      'app/how-it-works/page.tsx',
    ]) {
      assert.equal(existsSync(join(ROOT, retiredPath)), false, `Retired path must stay absent: ${retiredPath}`)
    }
    assert.equal(productionSource.includes('/generate-pack'), false, 'Production code still calls retired generation')
    assert.ok(existsSync(join(ROOT, 'app/(marketing)/pricing/page.tsx')))
    assert.ok(existsSync(join(ROOT, 'app/(marketing)/how-it-works/page.tsx')))

    const capabilitiesSource = readSource('lib/billing/case-capabilities.ts')
    assert.match(capabilitiesSource, /regeneration:\s*\{[\s\S]*?availability: "policy_blocked"/)
    assert.match(capabilitiesSource, /subscription:\s*\{[\s\S]*?availability: "policy_blocked"/)
  })

  it('discloses automated output on every material tier surface', () => {
    const disclosure = 'Generated automatically by GuideBuoy AI. It has not been reviewed by a person.'
    for (const path of [
      'components/state-machine/layer1/tier0-draft-view.tsx',
      'components/state-machine/transition/buy-report-cta.tsx',
      'components/state-machine/layer2/report-drafting.tsx',
      'components/state-machine/layer2/report-view.tsx',
      'components/state-machine/layer3/tier2-pack-panel.tsx',
      'components/state-machine/layer3/tier2-pack-view.tsx',
    ]) {
      assert.ok(readSource(path).includes(disclosure), `${path} is missing the automated-output disclosure`)
    }
  })

  it('keeps deletion, referral, consultation, Singpass, and handoffs inactive', () => {
    assert.match(settingsSource, /Request data deletion/)
    assert.match(settingsSource, /reviewable request and receipt/)
    assert.doesNotMatch(settingsSource, /\/api\/privacy\/delete-request|\/api\/referral\/generate/)

    for (const path of [
      'app/(auth)/sign-in/[[...sign-in]]/page.tsx',
      'app/(auth)/sign-up/[[...sign-up]]/page.tsx',
    ]) {
      assert.ok(readSource(path).includes('Singpass sign-in is not currently available.'))
    }

    assert.ok(
      readSource('app/(marketing)/marketplace/page.tsx').includes('Planned—not currently available through GuideBuoy.'),
    )
    assert.doesNotMatch(productionSource, /href=["']https:\/\/probono\.sg/i)
  })

  it('keeps public, auth, and case shells separate with safe errors', () => {
    const rootLayout = readSource('app/layout.tsx')
    const marketingLayout = readSource('app/(marketing)/layout.tsx')
    assert.doesNotMatch(rootLayout, /PublicFooter|WhatsApp/)
    assert.match(marketingLayout, /PublicHeader/)
    assert.match(marketingLayout, /PublicFooter/)
    assert.match(readSource('app/(case)/layout.tsx'), /CaseShell/)
    assert.match(readSource('app/(auth)/layout.tsx'), /main-content/)
    assert.ok(existsSync(join(ROOT, 'app/error.tsx')))
    assert.ok(existsSync(join(ROOT, 'app/not-found.tsx')))
    assert.doesNotMatch(readSource('components/state-machine/error-card.tsx'), /Technical details/)
  })

  it('fails closed without Clerk on protected routes while leaving public routes available', () => {
    const middleware = readSource('middleware.ts')
    assert.match(middleware, /pathname === '\/app' \|\| pathname\.startsWith\('\/app\/'\)/)
    assert.match(middleware, /needsAuthentication\(request\)[\s\S]*auth\.protect\(\)/)
    assert.match(middleware, /!hasClerkConfig[\s\S]*needsAuthentication\(request\)[\s\S]*status: 503[\s\S]*NextResponse\.next\(\)/)
    assert.match(middleware, /isPublicAppRoute\(request\)[\s\S]*NextResponse\.redirect\(new URL\('\/sign-up'/)
    assert.doesNotMatch(middleware, /!process\.env\.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\)[\s\S]*return NextResponse\.next\(\)/)
  })

  it('keeps resources provider-backed, retryable, and explicitly unavailable', () => {
    assert.match(resourceDirectorySource, /fetch\('\/api\/resources'/)
    assert.match(resourceDirectorySource, /status: 'loading'/)
    assert.match(resourceDirectorySource, /status: 'error'/)
    assert.match(resourceDirectorySource, /setRequestVersion/)
    assert.match(resourceDirectorySource, /filteredResources/)
    assert.match(resourceDirectorySource, /No official resources are available\./)
    assert.match(resourceDirectorySource, /No resources match this filter\./)
    assert.match(resourceRouteSource, /code: 'resources_unavailable'/)
    assert.match(resourceRouteSource, /status: 503/)
    assert.doesNotMatch(resourceRouteSource, /resources\s*:\s*\[/)
    assert.equal(existsSync(join(ROOT, 'app/api/contact/route.ts')), false)
  })
  it('publishes exactly 61 synthetic fixtures behind a production guard', () => {
    const definitions = readSource('lib/harbor/visual-fixtures.ts')
    const route = readSource('app/harbor-fixtures/page.tsx')
    const middleware = readSource('middleware.ts')
    const fixtureIds = [...definitions.matchAll(/id: '[A-I]\d+-[^']+'/g)]

    assert.equal(fixtureIds.length, 61)
    assert.match(route, /process\.env\.NODE_ENV === 'production'/)
    assert.match(route, /notFound\(\)/)
    assert.match(middleware, /process\.env\.NODE_ENV !== 'production'[\s\S]*HARBOR_VISUAL_FIXTURES === '1'/)
    assert.doesNotMatch(definitions, /fetch\(|createBrowserClient|createServerClient/)
  })

  it('does not reintroduce quarantined promise copy', () => {
    for (const pattern of [
      /money-back guarantee/i,
      /full refund for platform faults/i,
      /refund.{0,30}(?:1–2|1-2) business days/i,
      /your payment is safe/i,
      /singpass[- ]ready/i,
      /100% confidential/i,
    ]) {
      assert.doesNotMatch(productionSource, pattern)
    }
  })
})
