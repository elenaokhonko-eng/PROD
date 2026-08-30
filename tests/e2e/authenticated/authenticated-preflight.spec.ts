import { expect, test } from '../fixtures/harbor-test'

const requiredEnvironment = [
  'HARBOR_STATE_CASES_JSON',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const

test('authenticated release fixture is signed in and complete', async ({ page }) => {
  const missing = requiredEnvironment.filter((name) => !process.env[name]?.trim())
  expect(missing, 'Authenticated release lane is missing required environment').toEqual([])

  await page.goto('/app')
  await expect(page).not.toHaveURL(/\/sign-in(?:[/?]|$)/)
})
