import { expect, test } from '../fixtures/harbor-test'

// Elena, 7 Nov: every signed-in page offers "Report a problem", which prepares an email to info@guidebuoyai.sg.
test('signed-in pages offer a problem report addressed to info@guidebuoyai.sg', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Report a problem' }).click()
  const panel = page.getByRole('dialog', { name: 'Report a problem' })
  await expect(panel).toBeVisible()
  await panel.getByLabel('What were you doing, and what happened?').fill('Synthetic report: the page did not respond.')
  const email = panel.getByRole('link', { name: 'Open email' })
  const href = await email.getAttribute('href')
  expect(href).toMatch(/^mailto:info@guidebuoyai\.sg\?subject=GuideBuoy%20problem%20report&body=/)
  expect(decodeURIComponent(href!.split('&body=')[1])).toContain('Synthetic report: the page did not respond.')
  await expect(panel.getByText('Page: /app')).toBeVisible()
})
