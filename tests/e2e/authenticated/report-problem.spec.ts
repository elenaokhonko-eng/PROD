import { expect, test } from '../fixtures/harbor-test'

// Elena, 7-8 Nov: every signed-in page offers "Report a problem", which the server sends to info@guidebuoyai.sg
// (staging delivers to its test inbox). If sending fails, the person can still use their email app.
test('signed-in pages send a problem report to info@guidebuoyai.sg', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Report a problem' }).click()
  const panel = page.getByRole('dialog', { name: 'Report a problem' })
  await expect(panel).toBeVisible()
  await panel.getByLabel('What were you doing, and what happened?').fill('Synthetic report: the page did not respond.')
  await expect(panel.getByText('Page: /app')).toBeVisible()
  const sent = page.waitForResponse((r) => r.url().endsWith('/api/report-problem') && r.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Send report' }).click()
  expect((await sent).status()).toBe(200)
  await expect(panel.getByRole('status')).toHaveText('Thank you. Your report has been sent to info@guidebuoyai.sg.')
})

test('if sending fails, the report can still be emailed or copied', async ({ page }) => {
  await page.route('**/api/report-problem', (route) => route.fulfill({ status: 502, json: { error: 'The report could not be sent' } }))
  await page.goto('/app')
  await page.getByRole('button', { name: 'Report a problem' }).click()
  const panel = page.getByRole('dialog', { name: 'Report a problem' })
  await panel.getByLabel('What were you doing, and what happened?').fill('Synthetic report: the page did not respond.')
  await panel.getByRole('button', { name: 'Send report' }).click()
  await expect(panel.getByRole('alert')).toContainText('We couldn’t send your report just now.')
  const href = await panel.getByRole('link', { name: 'Open email' }).getAttribute('href')
  expect(href).toMatch(/^mailto:info@guidebuoyai\.sg\?subject=GuideBuoy%20problem%20report&body=/)
  expect(decodeURIComponent(href!.split('&body=')[1])).toContain('Synthetic report: the page did not respond.')
})
