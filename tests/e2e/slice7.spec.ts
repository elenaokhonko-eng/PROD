import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const authStatePath = resolve(process.env.SLICE5_AUTH_STORAGE_STATE ?? 'tests/e2e/.auth/slice5.json')
const hasAuthState = existsSync(authStatePath)
const layer3CaseId =
  process.env.SLICE7_LAYER3_CASE_ID ?? '01eb9245-0bb2-4b08-9469-412850d656a0'

test.describe('Slice 7 Layer 3 availability QA', () => {
  test.skip(
    !hasAuthState,
    `Missing authenticated Clerk storage state. Run "pnpm.cmd run test:e2e:auth", sign in as the test case owner, then save ${authStatePath}.`,
  )

  test('keeps unapproved human support inactive', async ({ page }) => {
    await page.goto(`/app/case/${layer3CaseId}/dashboard`)

    await expect(page.getByRole('heading', { name: 'Human consultation' })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByText('Human consultation is not currently available.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Consultation unavailable' })).toBeDisabled()
    await expect(page.getByText('Request specialist support')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /WhatsApp/i })).toHaveCount(0)
  })
})
