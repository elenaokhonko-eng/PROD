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

test('preview URL guard rejects plaintext, host mismatch, and production', () => {
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'http://preview.example.invalid',
      HARBOR_PREVIEW_EXPECTED_HOST: 'preview.example.invalid',
    },
    () => assert.throws(requirePreviewBaseUrl, /must use HTTPS/),
  )
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'https://preview.example.invalid',
      HARBOR_PREVIEW_EXPECTED_HOST: 'other.example.invalid',
    },
    () => assert.throws(requirePreviewBaseUrl, /does not match/),
  )
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'https://guidebuoyai.sg',
      HARBOR_PREVIEW_EXPECTED_HOST: 'guidebuoyai.sg',
      HARBOR_PRODUCTION_HOSTS: undefined,
    },
    () => assert.throws(requirePreviewBaseUrl, /Refusing to run live-preview tests against production/),
  )
  withEnvironment(
    {
      HARBOR_PREVIEW_BASE_URL: 'https://preview.example.invalid',
      HARBOR_PREVIEW_EXPECTED_HOST: 'preview.example.invalid',
      HARBOR_PRODUCTION_HOSTS: undefined,
    },
    () => assert.equal(requirePreviewBaseUrl(), 'https://preview.example.invalid'),
  )
  assert.equal(isProductionHost('GUIDEBUOYAI.SG'), true)
})

test('Supabase URL guard requires the named preview host and an explicit production denylist', () => {
  const safeEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://preview-project.supabase.co',
    HARBOR_SUPABASE_EXPECTED_HOST: 'preview-project.supabase.co',
    HARBOR_PRODUCTION_SUPABASE_HOSTS: 'production-project.supabase.co',
  }

  withEnvironment(
    { ...safeEnvironment, NEXT_PUBLIC_SUPABASE_URL: 'http://preview-project.supabase.co' },
    () => assert.throws(requirePreviewSupabaseUrl, /must use HTTPS/),
  )
  withEnvironment(
    { ...safeEnvironment, HARBOR_SUPABASE_EXPECTED_HOST: 'other-project.supabase.co' },
    () => assert.throws(requirePreviewSupabaseUrl, /does not match/),
  )
  withEnvironment(
    { ...safeEnvironment, HARBOR_PRODUCTION_SUPABASE_HOSTS: undefined },
    () => assert.throws(requirePreviewSupabaseUrl, /HARBOR_PRODUCTION_SUPABASE_HOSTS is required/),
  )
  withEnvironment(
    {
      ...safeEnvironment,
      HARBOR_SUPABASE_EXPECTED_HOST: 'production-project.supabase.co',
      NEXT_PUBLIC_SUPABASE_URL: 'https://production-project.supabase.co',
    },
    () => assert.throws(requirePreviewSupabaseUrl, /production Supabase host/),
  )
  withEnvironment(
    safeEnvironment,
    () => assert.equal(requirePreviewSupabaseUrl(), 'https://preview-project.supabase.co'),
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
