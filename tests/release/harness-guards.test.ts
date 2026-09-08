import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { evidenceClassForLane, resolveRunContext } from '../e2e/evidence/run-context'
import {
  harborReleaseRetries,
  isProductionHost,
  requirePreviewBaseUrl,
  requirePreviewSupabaseUrl,
} from '../e2e/config'

const rootDir = process.cwd()
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim()
const workflow = readFileSync(resolve(rootDir, '.github', 'workflows', 'harbor-release-gates.yml'), 'utf8')
const previewReleaseVerifier = readFileSync(resolve(rootDir, 'scripts', 'verify-harbor-preview-release.ts'), 'utf8')

test('lane evidence classes cannot label synthetic or skipped work as provider delivered', () => {
  assert.equal(evidenceClassForLane('public'), 'local/static')
  assert.equal(evidenceClassForLane('synthetic'), 'synthetic-provider')
  assert.equal(evidenceClassForLane('preview'), 'preview-provider-delivered')
  assert.equal(evidenceClassForLane('authenticated'), 'preview-provider-delivered')
})

test('release evidence lanes never turn an initial failure into a green retry', () => {
  assert.equal(harborReleaseRetries, 0)
})

test('public CI validates reviewed Windows baselines against a production server', () => {
  const publicJob = workflow.match(/  playwright-public:[\s\S]*?\n  playwright-synthetic:/)?.[0]
  assert.ok(publicJob, 'playwright-public workflow job is missing')
  assert.match(publicJob, /runs-on: windows-latest/)
  assert.match(publicJob, /- run: pnpm build/)
  assert.match(publicJob, /HARBOR_E2E_WEB_SERVER_COMMAND: pnpm start/)
  assert.match(publicJob, /pnpm exec playwright install chromium webkit/)
  assert.doesNotMatch(publicJob, /playwright install --with-deps/)
})

test('live run context requires exact HEAD, environment revision, and worker version', () => {
  withEnvironment(
    {
      HARBOR_RELEASE_SHA: undefined,
      HARBOR_ENVIRONMENT_REVISION: undefined,
      HARBOR_WORKER_VERSION: undefined,
    },
    () => assert.throws(() => resolveRunContext(rootDir, 'preview'), /HARBOR_RELEASE_SHA is required/),
  )

  const wrongSha = head === '0000000000000000000000000000000000000000'
    ? '1111111111111111111111111111111111111111'
    : '0000000000000000000000000000000000000000'
  withEnvironment(
    {
      HARBOR_RELEASE_SHA: wrongSha,
      HARBOR_ENVIRONMENT_REVISION: 'preview-revision',
      HARBOR_WORKER_VERSION: 'worker-version',
    },
    () => assert.throws(() => resolveRunContext(rootDir, 'preview'), /Refusing to report evidence for HEAD/),
  )

  withEnvironment(
    {
      HARBOR_RELEASE_SHA: head,
      HARBOR_PREVIEW_CONFIRMED_SHA: undefined,
      HARBOR_ENVIRONMENT_REVISION: 'preview-revision',
      HARBOR_WORKER_VERSION: 'worker-version',
    },
    () => assert.throws(() => resolveRunContext(rootDir, 'preview'), /HARBOR_PREVIEW_CONFIRMED_SHA is required/),
  )

  withEnvironment(
    {
      HARBOR_RELEASE_SHA: head,
      HARBOR_PREVIEW_CONFIRMED_SHA: head,
      HARBOR_ENVIRONMENT_REVISION: undefined,
      HARBOR_WORKER_VERSION: undefined,
    },
    () => assert.throws(() => resolveRunContext(rootDir, 'preview'), /HARBOR_ENVIRONMENT_REVISION is required/),
  )
  withEnvironment(
    {
      HARBOR_RELEASE_SHA: head,
      HARBOR_PREVIEW_CONFIRMED_SHA: head,
      HARBOR_ENVIRONMENT_REVISION: 'preview-revision',
      HARBOR_WORKER_VERSION: undefined,
    },
    () => assert.throws(() => resolveRunContext(rootDir, 'preview'), /HARBOR_WORKER_VERSION is required/),
  )
})

test('preview URL guard rejects plaintext, host mismatch, non-Render hosts, and production', () => {
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'http://harbor-preview-safe.onrender.com',
      HARBOR_PREVIEW_EXPECTED_HOST: 'harbor-preview-safe.onrender.com',
    },
    () => assert.throws(requirePreviewBaseUrl, /must use HTTPS/),
  )
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'https://harbor-preview-safe.onrender.com',
      HARBOR_PREVIEW_EXPECTED_HOST: 'other-preview.onrender.com',
    },
    () => assert.throws(requirePreviewBaseUrl, /does not match/),
  )
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'https://preview.example.invalid',
      HARBOR_PREVIEW_EXPECTED_HOST: 'preview.example.invalid',
    },
    () => assert.throws(requirePreviewBaseUrl, /staging Render hostname/),
  )
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'https://guidebuoyaisg.onrender.com',
      HARBOR_PREVIEW_EXPECTED_HOST: 'guidebuoyaisg.onrender.com',
      HARBOR_PRODUCTION_HOSTS: 'guidebuoyaisg.onrender.com,guidebuoyai.sg,www.guidebuoyai.sg',
    },
    () => assert.throws(requirePreviewBaseUrl, /Refusing to run live-preview tests against production/),
  )
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'https://guidebuoyaisg.onrender.com',
      HARBOR_PREVIEW_EXPECTED_HOST: 'guidebuoyaisg.onrender.com',
      HARBOR_PRODUCTION_HOSTS: 'guidebuoyai.sg,www.guidebuoyai.sg',
    },
    () => assert.throws(requirePreviewBaseUrl, /Refusing to run live-preview tests against production/),
  )
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'https://harbor-preview-safe.onrender.com',
      HARBOR_PREVIEW_EXPECTED_HOST: 'harbor-preview-safe.onrender.com',
      HARBOR_PRODUCTION_HOSTS: 'guidebuoyaisg.onrender.com,guidebuoyai.sg,www.guidebuoyai.sg',
    },
    () => assert.equal(requirePreviewBaseUrl(), 'https://harbor-preview-safe.onrender.com'),
  )
  assert.equal(isProductionHost('GUIDEBUOYAI.SG'), true)
  assert.equal(isProductionHost('guidebuoyaisg.onrender.com'), true)
})

test('state fixtures exclude transient unreachable dashboard states', () => {
  const stateMachine = readFileSync(
    resolve(rootDir, 'tests', 'e2e', 'authenticated', 'state-machine-families.spec.ts'),
    'utf8',
  )
  assert.doesNotMatch(stateMachine, /transitionPaymentSuccess/)
  assert.doesNotMatch(stateMachine, /layer3Confirmed/)
  assert.match(stateMachine, /unreachable or unrecognized states/)
})

test('workflow derives preview confirmed SHA instead of reading a manual secret', () => {
  const previewJob = workflow.match(/  playwright-preview:[\s\S]*?\n  playwright-authenticated:/)?.[0]
  const authenticatedJob = workflow.match(/  playwright-authenticated:[\s\S]*$/)?.[0]
  assert.ok(previewJob, 'playwright-preview workflow job is missing')
  assert.ok(authenticatedJob, 'playwright-authenticated workflow job is missing')

  assert.match(previewJob, /preview_confirmed_sha: \$\{\{ steps\.preview-release\.outputs\.harbor_preview_confirmed_sha \}\}/)
  assert.match(previewJob, /id: preview-release/)
  assert.match(previewJob, /pnpm exec tsx scripts\/verify-harbor-preview-release\.ts/)
  assert.match(authenticatedJob, /needs: \[playwright-preview\]/)
  assert.match(authenticatedJob, /HARBOR_PREVIEW_CONFIRMED_SHA: \$\{\{ needs\.playwright-preview\.outputs\.preview_confirmed_sha \}\}/)
  assert.doesNotMatch(workflow, /secrets\.HARBOR_PREVIEW_CONFIRMED_SHA/)
})

test('preview release verifier rejects anonymous SHA endpoints before exporting', () => {
  assert.match(previewReleaseVerifier, /assertReleaseEndpointRejectsAnonymous\(baseUrl\.origin\)/)
  assert.match(previewReleaseVerifier, /response\.status\(\) !== 401 && response\.status\(\) !== 403/)
  assert.match(previewReleaseVerifier, /exportValue\('HARBOR_PREVIEW_CONFIRMED_SHA'/)
})

test('Supabase URL guard requires the exact staging ref and an explicit production denylist', () => {
  const safeEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://yqqkkftfddxuxmpxwbcj.supabase.co',
    HARBOR_SUPABASE_EXPECTED_HOST: 'yqqkkftfddxuxmpxwbcj.supabase.co',
    HARBOR_PREVIEW_CONFIRM_SUPABASE_REF: 'yqqkkftfddxuxmpxwbcj',
    HARBOR_PRODUCTION_SUPABASE_HOSTS: 'production-project.supabase.co',
  }

  withEnvironment(
    { ...safeEnvironment, NEXT_PUBLIC_SUPABASE_URL: 'http://yqqkkftfddxuxmpxwbcj.supabase.co' },
    () => assert.throws(requirePreviewSupabaseUrl, /must use HTTPS/),
  )
  withEnvironment(
    { ...safeEnvironment, HARBOR_SUPABASE_EXPECTED_HOST: 'other-project.supabase.co' },
    () => assert.throws(requirePreviewSupabaseUrl, /does not match/),
  )
  withEnvironment(
    { ...safeEnvironment, NEXT_PUBLIC_SUPABASE_URL: 'https://other-project.supabase.co', HARBOR_SUPABASE_EXPECTED_HOST: 'other-project.supabase.co' },
    () => assert.throws(requirePreviewSupabaseUrl, /Preview Supabase ref must be yqqkkftfddxuxmpxwbcj/),
  )
  withEnvironment(
    { ...safeEnvironment, HARBOR_PREVIEW_CONFIRM_SUPABASE_REF: 'other-project' },
    () => assert.throws(requirePreviewSupabaseUrl, /HARBOR_PREVIEW_CONFIRM_SUPABASE_REF must be yqqkkftfddxuxmpxwbcj/),
  )
  withEnvironment(
    { ...safeEnvironment, HARBOR_PRODUCTION_SUPABASE_HOSTS: undefined },
    () => assert.throws(requirePreviewSupabaseUrl, /HARBOR_PRODUCTION_SUPABASE_HOSTS is required/),
  )
  withEnvironment(
    {
      ...safeEnvironment,
      HARBOR_PRODUCTION_SUPABASE_HOSTS: 'yqqkkftfddxuxmpxwbcj.supabase.co',
    },
    () => assert.throws(requirePreviewSupabaseUrl, /production Supabase host/),
  )
  withEnvironment(
    safeEnvironment,
    () => assert.equal(requirePreviewSupabaseUrl(), 'https://yqqkkftfddxuxmpxwbcj.supabase.co'),
  )
})

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]))
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    run()
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}
