import { writeFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/harbor-test'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'
import {
  confirmFactsInDashboard,
  deleteClerkUser,
  expectFreeEvaluation,
  startFreshCase,
  stepTimeoutMs,
  syntheticPdf,
} from '../helpers/fresh-account'
import { assertSampleIsFictional, SAMPLE_FILE, toSampleRows } from '../../../lib/samples/free-evaluation'

// Brief W1 §H: runs the approved fictional case (content/samples/fictional-case.md, Elena, 19 Nov) through the real
// pipeline on staging as a throwaway synthetic account, and freezes the free evaluation into lib/samples. The bank and
// FIDReC pack samples wait until the paid packs exist (Elena, 19 Nov).

test.use({ storageState: { cookies: [], origins: [] } })

const STORY = [
  'On 3 March 2026 at about 7.40 pm I got an SMS saying a parcel couldn’t be delivered and I had to confirm my address. I clicked the link. It took me to a page that looked like Harbourline Bank’s login, and I typed in my username and password. Then it asked for the one-time code that came to my phone, and I entered it. Nothing seemed to happen, so I closed the page.',
  'The next morning I saw three transfers I didn’t make: S$1,500, S$2,000 and S$1,350, S$4,850 in total, all to the same account I don’t recognise. I called Harbourline’s fraud hotline at 8.10 am and they froze my account. I made a police report the same day and reported the SMS to ScamShield.',
  'On 20 April 2026 Harbourline wrote to me with their final reply. They said they would not refund me because I gave out my one-time code. I don’t think that’s fair, because the page looked exactly like theirs.',
].join('\n\n')

const INTAKE: Record<string, string> = {
  institution_name: 'Harbourline Bank',
  account_details: 'Savings account ending 0001 (fictional)',
  incident_summary: STORY,
  financial_impact: 'I lost S$4,850 in three transfers on 3 March 2026: S$1,500, S$2,000 and S$1,350.',
  desired_outcome: 'A full refund of S$4,850.',
}

const DOCUMENTS = [
  {
    name: 'sample-sms.pdf',
    lines: [
      'SAMPLE - fictional document',
      'SMS received 3 Mar 2026, 19:40',
      'Your parcel could not be delivered. Confirm your address within 24 hours:',
      'harbourline-parcel-check (link, fictional)',
    ],
  },
  {
    name: 'sample-statement.pdf',
    lines: [
      'SAMPLE - fictional document',
      'Harbourline Bank - Statement extract',
      'Account holder: Mei Ling Tan   Savings account ending 0001',
      '03 Mar 2026 19:52  Transfer to account ending 0001 (fictional)   S$1,500.00 debit',
      '03 Mar 2026 19:55  Transfer to account ending 0001 (fictional)   S$2,000.00 debit',
      '03 Mar 2026 19:58  Transfer to account ending 0001 (fictional)   S$1,350.00 debit',
    ],
  },
  {
    name: 'sample-final-reply.pdf',
    lines: [
      'SAMPLE - fictional document',
      'Harbourline Bank - 20 April 2026',
      'Dear Ms Tan, Our reference: SAMPLE-HB-0001',
      'This is our final reply to your complaint about three transfers totalling S$4,850 on 3 March 2026.',
      'The transfers were authorised with a one-time password sent to your registered phone.',
      'As the one-time password was disclosed, we are unable to refund the amount.',
      'If you are not satisfied, you may refer the matter to FIDReC within six months of this letter.',
    ],
  },
]

// Answers that fit the fictional case, so nothing generic reaches the sample.
async function answerFollowUps(form: Locator) {
  for (const group of await form.getByRole('radiogroup').all()) {
    const legend = (await group.textContent()) ?? ''
    const yes = group.getByRole('radio', { name: /^Yes/ })
    const notSure = group.getByRole('radio', { name: /not sure/i })
    if (/OTP|one-time|code|password|link|clicked/i.test(legend) && (await yes.count())) await yes.first().check()
    else if (await notSure.count()) await notSure.first().check()
    else await group.getByRole('radio').first().check()
  }
  for (const field of await form.locator('textarea, input:not([type="radio"]):not([type="hidden"])').all()) {
    if (await field.inputValue()) continue
    const type = await field.getAttribute('type')
    const label = await field.evaluate((input) => (input as HTMLInputElement).labels?.[0]?.textContent ?? '')
    if (type === 'date') await field.fill(/reply|final/i.test(label) ? '2026-04-20' : /report|police|bank|told|call/i.test(label) ? '2026-03-04' : '2026-03-03')
    else if (type === 'number' || (await field.getAttribute('inputmode')) === 'decimal' || /amount|lost|how much/i.test(label)) await field.fill('4850')
    else if (/reference|ref|number/i.test(label)) await field.fill(/police/i.test(label) ? 'SAMPLE-POL-0001' : 'SAMPLE-HB-0001')
    else await field.fill('I’m not sure.')
  }
  await form.locator('button[type="submit"]').click()
  await form.page().waitForTimeout(5_000)
}

async function answerFollowUpsUntil(page: Page, target: Locator) {
  const deadline = Date.now() + stepTimeoutMs
  let rounds = 0
  while (Date.now() < deadline) {
    if (await target.first().isVisible().catch(() => false)) return
    const followUps = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save answers' }) })
    if (await followUps.isVisible().catch(() => false)) {
      expect(++rounds, 'follow-up rounds').toBeLessThanOrEqual(4)
      await answerFollowUps(followUps)
      continue
    }
    await page.waitForTimeout(5_000)
  }
  await expect(target.first()).toBeVisible({ timeout: 1_000 })
}

test('generate the free-evaluation sample from the fictional case', async ({ page }) => {
  const supabase = createServiceClientFromEnvironment()
  const { clerkUserId, caseId } = await startFreshCase(page, supabase, STORY)
  try {
    // Journey: told the bank by hotline, written complaint sent, final reply rejecting the claim, police report, no FIDReC.
    await expect(page.getByText('Where are you with your bank?')).toBeVisible({ timeout: 120_000 })
    await page.locator('#journey-bank-yes').check()
    await page.locator('#journey-bank-date').fill('2026-03-04')
    await page.locator('#journey-bank-channel-hotline').check()
    await page.locator('#journey-bank-ref').fill('SAMPLE-HB-0001')
    await page.locator('#journey-complaint-yes').check()
    await page.locator('#journey-complaint-date').fill('2026-03-06')
    await page.locator('#journey-reply-final_reply').check()
    await page.locator('#journey-reply-date').fill('2026-04-20')
    await page.locator('#journey-outcome-rejected').check()
    await page.locator('#journey-qualifies-yes').check()
    await page.locator('#journey-police-yes').check()
    await page.locator('#journey-police-date').fill('2026-03-04')
    await page.locator('#journey-police-number').fill('SAMPLE-POL-0001')
    await page.locator('#journey-fidrec-no').check()
    await page.locator('#journey-inst-bank').click()
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByText('Tell us about your complaint')).toBeVisible({ timeout: 120_000 })
    for (const [key, value] of Object.entries(INTAKE)) await page.locator(`#intake-${key}`).fill(value)
    await page.locator('#intake-previous_contact-Yes').check()
    await page.getByRole('button', { name: 'Continue' }).click()

    await answerFollowUpsUntil(page, page.getByText('Upload supporting evidence'))
    await page.locator('input[type="file"]').setInputFiles(
      DOCUMENTS.map((doc) => ({ name: doc.name, mimeType: 'application/pdf', buffer: syntheticPdf(doc.lines) })),
    )

    await answerFollowUpsUntil(page, page.getByRole('heading', { name: 'Confirm your facts', exact: true }))
    await confirmFactsInDashboard(page, caseId)
    await expectFreeEvaluation(page)

    const { data, error } = await supabase
      .from('case_narratives')
      .select('narrative_type, title, text_content, created_at, version, language, audience')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
    expect(error).toBeNull()
    const rows = toSampleRows(data ?? [])
    assertSampleIsFictional(rows)
    writeFileSync(SAMPLE_FILE, `${JSON.stringify(rows, null, 2)}\n`)
    console.log(`Wrote ${rows.length} rows to ${SAMPLE_FILE}`)
  } finally {
    await deleteClerkUser(clerkUserId)
  }
})
