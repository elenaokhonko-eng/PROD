import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { assertClerkSessionActive } from './check-harbor-auth-states'

// Creates fresh Playwright storage states for the three disposable staging CI identities from one-time Clerk sign-in
// tokens (no passwords), checks each against the preview, and writes them to the git-ignored tests/e2e/.auth/.
// Run with the staging env file: pnpm exec tsx --env-file=.env.staging.local scripts/refresh-harbor-auth-states.ts
// The manual-walkthrough identity userGolden owns imported case data and is refused: its session is never saved.

const stagingOrigin = 'https://guidebuoy-staging-web.onrender.com'
const ciLabels = ['userA', 'userB', 'deletionUser'] as const
const files: Record<(typeof ciLabels)[number], string[]> = {
  userA: ['harbor-user-a.json', 'harbor-preview.json', 'harbor-preview-release.json'],
  userB: ['harbor-user-b.json'],
  deletionUser: ['harbor-deletion-user.json'],
}

type ClerkWindow = {
  Clerk: {
    loaded?: boolean
    client: { signIn: { create(params: { strategy: 'ticket'; ticket: string }): Promise<{ status: string; createdSessionId: string }> } }
    setActive(params: { session: string }): Promise<void>
  }
}

async function main() {
  const secretKey = requiredEnvironment('CLERK_SECRET_KEY')
  if (!secretKey.startsWith('sk_test_')) throw new Error('Refreshing test sessions requires the Clerk Development key.')
  if (requiredEnvironment('NEXT_PUBLIC_APP_URL') !== stagingOrigin) throw new Error(`Test sessions are only made for ${stagingOrigin}.`)

  const allowlist = JSON.parse(requiredEnvironment('CLERK_RECONCILIATION_USER_ALLOWLIST_JSON')) as Record<string, unknown>
  const users = ciLabels.map((label) => {
    const id = allowlist[label]
    if (typeof id !== 'string' || !/^user_[A-Za-z0-9]{3,}$/.test(id)) throw new Error(`${label} needs one Clerk user ID.`)
    if (id === allowlist.userGolden) throw new Error(`${label} must not be the userGolden identity.`)
    return { label, id }
  })

  const directory = resolve('tests', 'e2e', '.auth')
  mkdirSync(directory, { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const { label, id } of users) {
      const response = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: id, expires_in_seconds: 300 }),
      })
      const { token } = (await response.json()) as { token?: string }
      if (!token) throw new Error(`${label}: Clerk did not issue a sign-in token (HTTP ${response.status}).`)

      const context = await browser.newContext({ baseURL: stagingOrigin })
      const page = await context.newPage()
      await page.goto('/sign-in', { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean((window as unknown as Partial<ClerkWindow>).Clerk?.loaded), undefined, {
        timeout: 60_000,
      })
      const status = await page.evaluate(async (ticket) => {
        const { Clerk } = window as unknown as ClerkWindow
        const attempt = await Clerk.client.signIn.create({ strategy: 'ticket', ticket })
        if (attempt.status !== 'complete') return attempt.status
        await Clerk.setActive({ session: attempt.createdSessionId })
        return 'complete'
      }, token)
      if (status !== 'complete') throw new Error(`${label}: sign-in ended as ${status}.`)

      await assertClerkSessionActive(page, label)
      for (const file of files[label]) await context.storageState({ path: resolve(directory, file) })
      console.log(`${label}: saved ${files[label].join(', ')}`)
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
