import type { Locator, Page } from '@playwright/test'
import { expect } from '../fixtures/harbor-test'

// CR-2: the timeline questionnaire after buying the FIDReC pack. Dates are in Singapore time, counted back from today.
export const daysAgo = (days: number) => new Date(Date.now() + 8 * 3_600_000 - days * 86_400_000).toISOString().slice(0, 10)

export interface TimelineAnswer {
  /** Null: not complained in writing yet. */
  complaintDaysAgo: number | null
  /** Null: no answer from the bank. */
  reply?: { daysAgo: number; final: boolean } | null
}

export const FINAL_REPLY_TEN_DAYS_AGO: TimelineAnswer = { complaintDaysAgo: 60, reply: { daysAgo: 10, final: true } }

export async function answerTimeline(page: Page, answer: TimelineAnswer): Promise<void> {
  const form: Locator = page.locator('[data-fidrec-timeline]')
  await expect(form).toBeVisible({ timeout: 120_000 })
  const choose = (question: string, value: 'yes' | 'no') => form.locator(`input[name="${question}"][value="${value}"]`).check()
  await choose('complained', answer.complaintDaysAgo === null ? 'no' : 'yes')
  if (answer.complaintDaysAgo !== null) {
    await form.locator('input[name="complaint-date"]').fill(daysAgo(answer.complaintDaysAgo))
    await choose('answered', answer.reply ? 'yes' : 'no')
    if (answer.reply) {
      await choose('final', answer.reply.final ? 'yes' : 'no')
      await form.locator('input[name="reply-date"]').fill(daysAgo(answer.reply.daysAgo))
    }
  }
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(form).toHaveCount(0, { timeout: 60_000 })
}
