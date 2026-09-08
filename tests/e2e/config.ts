import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'
import {
  isLiveLane,
  requireAuthState,
  requireEnvironment,
  resolveRunContext,
  type HarborLane,
} from './evidence/run-context'
import { assertReleaseFixtures } from '../release/release-fixtures'

const rootDir = resolve(__dirname, '..', '..')
const testDir = resolve(rootDir, 'tests', 'e2e')
export const harborReleaseRetries = 0
const localBaseUrl =
  process.env.HARBOR_BASE_URL ??
  process.env.SLICE5_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'http://127.0.0.1:3000'

const harborPreviewSupabaseRef = 'yqqkkftfddxuxmpxwbcj'
const defaultProductionHosts = ['guidebuoyaisg.onrender.com', 'guidebuoyai.sg', 'www.guidebuoyai.sg']

const browserMatrix: PlaywrightTestConfig['projects'] = [
  {
    name: 'chromium-390',
    use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
  },
  {
    name: 'chromium-768',
    use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
  },
  {
    name: 'chromium-1440',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  },
  {
    name: 'webkit-mobile-390',
    use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
  },
]

export type HarborAuthMode = 'configured' | 'credential-withheld'

export function resolveHarborAuthMode(lane: HarborLane): HarborAuthMode {
  if (isLiveLane(lane)) return 'configured'
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ? 'configured' : 'credential-withheld'
}

export function readHarborAuthMode(metadata: unknown): HarborAuthMode {
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('Missing Playwright metadata for Harbor auth mode.')
  }

  const value = (metadata as { harborAuthMode?: unknown }).harborAuthMode
  if (value === 'configured' || value === 'credential-withheld') return value
  throw new Error(`Invalid harborAuthMode metadata value: ${String(value)}`)
}

export function readHarborAnalyticsConfigured(metadata: unknown) {
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('Missing Playwright metadata for Harbor analytics mode.')
  }

  const value = (metadata as { harborAnalyticsConfigured?: unknown }).harborAnalyticsConfigured
  if (typeof value === 'boolean') return value
  throw new Error(`Invalid harborAnalyticsConfigured metadata value: ${String(value)}`)
}

export function createHarborConfig(lane: HarborLane) {
  const run = resolveRunContext(rootDir, lane)
  const liveLane = isLiveLane(lane)
  const authenticated = lane === 'authenticated'
  const authMode = resolveHarborAuthMode(lane)
  const analyticsConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  )
  const baseURL = liveLane ? requirePreviewBaseUrl() : localBaseUrl
  const authStatePath = authenticated ? requireAuthState(rootDir, 'userA') : undefined

  if (authenticated) {
    assertDistinctAuthStates(rootDir)
    for (const name of [
      'HARBOR_STATE_CASES_JSON',
      'HARBOR_RELEASE_FIXTURES_JSON',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'HARBOR_SMTP_TEST_RECIPIENT',
      'HARBOR_PREVIEW_CONFIRM_SUPABASE_REF',
    ]) requireEnvironment(name)
    assertDisposableReleaseFixtures(requireEnvironment('HARBOR_RELEASE_FIXTURES_JSON'))
    requirePreviewSupabaseUrl()
  }

  const shouldStartLocalServer =
    !liveLane &&
    process.env.HARBOR_SKIP_WEB_SERVER !== '1' &&
    isLoopbackUrl(baseURL)
  const reporterOptions = {
    lane,
    evidenceClass: run.evidenceClass,
    outputDir: resolve(rootDir, 'test-results', 'evidence'),
    releaseSha: run.releaseSha,
    previewConfirmedSha: run.previewConfirmedSha,
    environmentRevision: run.environmentRevision,
    workerVersion: run.workerVersion,
  }

  return defineConfig({
    testDir,
    testMatch: matchForLane(lane),
    outputDir: resolve(rootDir, 'test-results', lane),
    timeout: liveLane ? 60_000 : 120_000,
    expect: { timeout: 30_000 },
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: harborReleaseRetries,
    workers: liveLane ? 1 : process.env.CI ? 2 : undefined,
    metadata: {
      harborSchemaVersion: run.schemaVersion,
      harborLane: run.lane,
      harborEvidenceClass: run.evidenceClass,
      harborReleaseSha: run.releaseSha,
      harborPreviewConfirmedSha: run.previewConfirmedSha,
      harborEnvironmentRevision: run.environmentRevision,
      harborWorkerVersion: run.workerVersion,
      harborGitRef: run.gitRef,
      harborAuthMode: authMode,
      harborAnalyticsConfigured: analyticsConfigured,
    },
    reporter: [
      ['list'],
      ['html', { open: 'never', outputFolder: resolve(rootDir, 'playwright-report', lane) }],
      [resolve(testDir, 'reporters', 'harbor-evidence-reporter.ts'), reporterOptions],
      ...(process.env.CI ? ([['github']] as const) : []),
    ],
    use: {
      baseURL,
      storageState: authStatePath,
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      actionTimeout: 30_000,
      navigationTimeout: 30_000,
    },
    projects: lane === 'preview'
      ? [
          {
            name: 'preview-chromium',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
          },
        ]
      : browserMatrix,
    webServer: shouldStartLocalServer
      ? {
          command: process.env.HARBOR_E2E_WEB_SERVER_COMMAND ?? 'pnpm dev',
          url: baseURL,
          reuseExistingServer: false,
          timeout: 180_000,
          stdout: 'pipe',
          stderr: 'pipe',
        }
      : undefined,
  })
}

function matchForLane(lane: HarborLane) {
  if (lane === 'authenticated') {
    return ['authenticated/**/*.spec.ts', 'slice5.spec.ts', 'slice7.spec.ts']
  }
  if (lane === 'preview') return ['preview/**/*.spec.ts']
  if (lane === 'synthetic') return ['router/**/*.spec.ts']
  return ['public/**/*.spec.ts']
}

export function requirePreviewBaseUrl() {
  const value = requireEnvironment('HARBOR_PREVIEW_BASE_URL')
  const url = new URL(value)
  if (url.protocol !== 'https:') {
    throw new Error(`Live preview must use HTTPS; received ${url.origin}.`)
  }

  const expectedHost = requireEnvironment('HARBOR_PREVIEW_EXPECTED_HOST').toLowerCase()
  if (url.hostname.toLowerCase() !== expectedHost) {
    throw new Error(`Preview host ${url.hostname} does not match HARBOR_PREVIEW_EXPECTED_HOST=${expectedHost}.`)
  }
  if (!url.hostname.toLowerCase().endsWith('.onrender.com')) {
    throw new Error('Preview tests must target the exact staging Render hostname.')
  }
  const productionHosts = configuredHosts('HARBOR_PRODUCTION_HOSTS', defaultProductionHosts)
  if (productionHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to run live-preview tests against production host ${url.hostname}.`)
  }

  return url.origin
}

export function requirePreviewSupabaseUrl() {
  const value = requireEnvironment('NEXT_PUBLIC_SUPABASE_URL')
  const url = new URL(value)
  if (url.protocol !== 'https:') {
    throw new Error(`Preview Supabase must use HTTPS; received ${url.origin}.`)
  }

  const expectedHost = requireEnvironment('HARBOR_SUPABASE_EXPECTED_HOST').toLowerCase()
  if (url.hostname.toLowerCase() !== expectedHost) {
    throw new Error(`Supabase host ${url.hostname} does not match HARBOR_SUPABASE_EXPECTED_HOST=${expectedHost}.`)
  }
  const previewRef = url.hostname.split('.')[0]
  if (previewRef !== harborPreviewSupabaseRef) {
    throw new Error(`Preview Supabase ref must be ${harborPreviewSupabaseRef}.`)
  }
  if (requireEnvironment('HARBOR_PREVIEW_CONFIRM_SUPABASE_REF') !== harborPreviewSupabaseRef) {
    throw new Error(`HARBOR_PREVIEW_CONFIRM_SUPABASE_REF must be ${harborPreviewSupabaseRef}.`)
  }

  const productionHosts = configuredHosts('HARBOR_PRODUCTION_SUPABASE_HOSTS')
  if (productionHosts.length === 0) {
    throw new Error('HARBOR_PRODUCTION_SUPABASE_HOSTS must list every production Supabase hostname.')
  }
  if (productionHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to run authenticated tests against production Supabase host ${url.hostname}.`)
  }

  return url.origin
}

export function isProductionHost(hostname: string) {
  const configured = (process.env.HARBOR_PRODUCTION_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  return [...defaultProductionHosts, ...configured].includes(hostname.toLowerCase())
}

function assertDistinctAuthStates(root: string) {
  const states = (['userA', 'userB', 'deletionUser'] as const).map((user) => ({
    user,
    path: requireAuthState(root, user),
  }))
  if (new Set(states.map((state) => state.path)).size !== states.length) {
    throw new Error('Authenticated Harbor lane requires three distinct Clerk storage-state files.')
  }
  const hashes = states.map((state) => createHash('sha256').update(readFileSync(state.path, 'utf8')).digest('hex'))
  if (new Set(hashes).size !== hashes.length) {
    throw new Error('Authenticated Harbor lane requires three distinct disposable Clerk storage states.')
  }
}

function configuredHosts(name: string, defaults: string[] = []) {
  return Array.from(new Set([
    ...defaults,
    ...requireEnvironment(name)
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  ]))
}

function assertDisposableReleaseFixtures(raw: string) {
  try {
    assertReleaseFixtures(JSON.parse(raw))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('HARBOR_RELEASE_FIXTURES_JSON must contain valid JSON.')
    }
    throw error
  }
}

function isLoopbackUrl(value: string) {
  const hostname = new URL(value).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}
