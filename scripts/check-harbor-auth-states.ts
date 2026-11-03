import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chromium, type Page } from '@playwright/test'

// Usage: tsx scripts/check-harbor-auth-states.ts SECRET_NAME=path/to/state.json [...]
// Opens each saved Clerk session against the preview and fails with one clear message per expired session, instead
// of letting the suites fail later on redirects to sign-in.

const refreshHint = 'Refresh it with "Refresh test sessions" in docs/release-operations.md.'

type Clerkish = { Clerk?: { loaded?: boolean; session?: unknown; user?: unknown } }

export async function assertClerkSessionActive(page: Page, label: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  try {
    await page.waitForFunction(() => Boolean((window as typeof window & Clerkish).Clerk?.loaded), undefined, {
      timeout: 60_000,
    })
  } catch {
    throw new Error(`${label}: Clerk did not load on the preview, so the session could not be checked.`)
  }
  const active = await page.evaluate(() => {
    const clerk = (window as typeof window & Clerkish).Clerk
    return Boolean(clerk?.session && clerk?.user)
  })
  if (!active) throw new Error(`${label}: the saved Clerk test session has expired or was signed out. ${refreshHint}`)
}

async function main() {
  const pairs = process.argv.slice(2).map((argument) => {
    const index = argument.indexOf('=')
    if (index <= 0) throw new Error(`Expected SECRET_NAME=path, received "${argument}".`)
    return { label: argument.slice(0, index), path: argument.slice(index + 1) }
  })
  if (pairs.length === 0) throw new Error('Pass at least one SECRET_NAME=path pair.')

  const baseUrl = new URL(requiredEnvironment('HARBOR_PREVIEW_BASE_URL'))
  if (
    baseUrl.protocol !== 'https:' ||
    baseUrl.hostname.toLowerCase() !== requiredEnvironment('HARBOR_PREVIEW_EXPECTED_HOST').toLowerCase() ||
    !baseUrl.hostname.toLowerCase().endsWith('.onrender.com')
  ) {
    throw new Error('Session checks must target the exact HTTPS staging Render host.')
  }

  const failures: string[] = []
  const browser = await chromium.launch()
  try {
    for (const { label, path } of pairs) {
      if (!existsSync(path)) {
        failures.push(`${label}: no saved session was materialized. ${refreshHint}`)
        continue
      }
      const context = await browser.newContext({ baseURL: baseUrl.origin, storageState: path })
      try {
        await assertClerkSessionActive(await context.newPage(), label)
        console.log(`${label}: Clerk session active.`)
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
  if (failures.length) throw new Error(failures.join('\n'))
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
