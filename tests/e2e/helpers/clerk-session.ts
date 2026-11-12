import type { BrowserContext, Page } from '@playwright/test'

type ClerkWindow = {
  Clerk?: { session?: { getToken(options?: { template?: string }): Promise<string | null> } | null }
}

// Clerk's page script has to load before window.Clerk.session exists; reading a token earlier returns null.
export async function waitForClerkSession(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as ClerkWindow).Clerk?.session), undefined, {
    timeout: 60_000,
  })
}

// Clerk session tokens last about a minute and only a loaded page refreshes them. API calls through a context
// (context.request / page.request) reuse the stored __session cookie, so refresh it in a page first.
export async function refreshClerkSession(context: BrowserContext) {
  const page = await context.newPage()
  try {
    await page.goto('/app', { waitUntil: 'domcontentloaded' })
    await waitForClerkSession(page)
    await page.evaluate(() => (window as unknown as ClerkWindow).Clerk?.session?.getToken())
  } finally {
    await page.close()
  }
}
