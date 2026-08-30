import { expect, test as base, type BrowserContext } from '@playwright/test'
import { isProductionHost } from '../config'

const blockedOrigins = new WeakMap<BrowserContext, string[]>()

export const test = base.extend<{ harborProductionGuard: void }>({
  harborProductionGuard: [
    async ({ context }, use) => {
      await guardContextAgainstProduction(context)
      try {
        await use()
      } finally {
        expectNoProductionTraffic(context)
      }
    },
    { auto: true },
  ],
})

export { expect }

export async function guardContextAgainstProduction(context: BrowserContext) {
  const blocked: string[] = []
  blockedOrigins.set(context, blocked)
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (isProductionHost(url.hostname)) {
      blocked.push(url.origin)
      await route.abort('blockedbyclient')
      return
    }
    await route.fallback()
  })
}

export function expectNoProductionTraffic(context: BrowserContext) {
  expect(
    Array.from(new Set(blockedOrigins.get(context) ?? [])),
    'Preview-provider tests must never follow requests or redirects to a production origin',
  ).toEqual([])
}
