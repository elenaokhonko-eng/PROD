import { expect, test } from './fixtures/harbor-test'
import { readReleaseFixtures } from '../release/release-fixtures'

const fixtures = readReleaseFixtures()
const layer3CaseId = fixtures.contact.caseId

test.describe('Slice 7 Layer 3 availability QA', () => {
  test('keeps unapproved human support inactive', async ({ page }) => {
    await page.goto(`/app/case/${layer3CaseId}/dashboard`)

    await expect(page.getByRole('heading', { name: 'Human consultation' })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByText('Human consultation: S$99 for 30 minutes. Email info@guidebuoyai.sg to book.')).toBeVisible()
    // PB-6 (Elena, 25 Nov): booking is by email, so no consultation button at all, not even a greyed one.
    await expect(page.getByRole('button', { name: /consultation/i })).toHaveCount(0)
    await expect(page.getByText('Request specialist support')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /WhatsApp/i })).toHaveCount(0)
  })
})