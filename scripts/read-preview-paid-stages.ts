import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { assertClerkSessionActive } from './check-harbor-auth-states'
import { parseStateCaseFixtures } from '../tests/e2e/helpers/state-case-fixtures'

// The authenticated lane expects stage 1 or stage 2 behaviour depending on whether staging takes payments
// (tests/e2e/helpers/paid-stages.ts). Staging's own answer decides it, read as user A from the capabilities route of
// user A's free-evaluation fixture, so the tests always describe the environment they ran against. Exports
// HARBOR_PAID_STAGES_ENABLED for the later steps of the job.
//
// Usage: pnpm exec tsx scripts/read-preview-paid-stages.ts
// Needs HARBOR_PREVIEW_BASE_URL, HARBOR_STATE_CASES_JSON and HARBOR_PREVIEW_AUTH_STORAGE_STATE (user A).

async function main() {
  const baseUrl = new URL(requiredEnvironment('HARBOR_PREVIEW_BASE_URL'))
  const caseId = parseStateCaseFixtures(requiredEnvironment('HARBOR_STATE_CASES_JSON')).layer1FreeDraft.caseId
  const storageState = requiredEnvironment('HARBOR_PREVIEW_AUTH_STORAGE_STATE')

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ baseURL: baseUrl.origin, storageState })
    // Clerk session tokens last about a minute; loading the app refreshes the stored session before the request.
    await assertClerkSessionActive(await context.newPage(), 'HARBOR_AUTH_STORAGE_STATE_USER_A_BASE64')
    const response = await context.request.get(`/api/cases/${caseId}/capabilities`, {
      maxRedirects: 0,
      headers: { accept: 'application/json' },
    })
    if (!response.ok()) throw new Error(`Case capabilities failed with HTTP ${response.status()}.`)
    const enabled = paidStagesFrom(await response.json())
    exportValue('HARBOR_PAID_STAGES_ENABLED', String(enabled))
    console.log(`Staging paid stages: ${enabled ? 'on (stage 2 expectations)' : 'off (stage 1 expectations)'}.`)
  } finally {
    await browser.close()
  }
}

export function paidStagesFrom(body: unknown): boolean {
  const enabled = (body as { access?: { paidStagesEnabled?: unknown } } | null)?.access?.paidStagesEnabled
  if (typeof enabled !== 'boolean') throw new Error('Case capabilities did not say whether paid stages are on.')
  return enabled
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function exportValue(name: string, value: string) {
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`, 'utf8')
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
