// A synthetic credit bureau report with two card accounts (review of 25 Nov 2026, account and coverage): the other
// bank's card is overdue, the case's bank's card (Example Bank A, ending 0001, the synthetic card-only case) is current.
// Every value is invented. CLAUDE.md: nothing from a real case.

export const TWO_ACCOUNTS_TEXT = [
  'EXAMPLE CREDIT INFORMATION BUREAU (SYNTHETIC) - CONSUMER CREDIT REPORT',
  'Report date: 02 Nov 2025',
  'ACCOUNT 1: Example Bank A credit card ending 0001',
  'Lender: Example Bank A | Status as at 31 Oct 2025: current',
  'ACCOUNT 2: Example Bank B credit card ending 0002',
  'Lender: Example Bank B | Status as at 31 Oct 2025: 30 days overdue',
].join('\n')

export const REPORT_DATE_LINE = 'Report date: 02 Nov 2025'
export const ACCOUNT_1_LINE = 'Lender: Example Bank A | Status as at 31 Oct 2025: current'
export const ACCOUNT_2_LINE = 'Lender: Example Bank B | Status as at 31 Oct 2025: 30 days overdue'

/** One entry for every account line, good standing included, and the report's own date once. */
export const TWO_ACCOUNTS_MODEL_OUTPUT = {
  document_type: 'credit_bureau_report',
  report_date: { date: '2025-11-02', quote: REPORT_DATE_LINE },
  credit_account_status: [
    {
      as_of: '2025-10-31',
      status_text: 'current',
      account_name: 'Example Bank A credit card ending 0001',
      lender: 'Example Bank A',
      last4: '0001',
      facility: 'credit card ending 0001',
      bureau: 'Example Credit Information Bureau',
      quote: ACCOUNT_1_LINE,
      confidence: 0.9,
    },
    {
      as_of: '2025-10-31',
      status_text: '30 days overdue',
      account_name: 'Example Bank B credit card ending 0002',
      lender: 'Example Bank B',
      last4: '0002',
      facility: 'credit card ending 0002',
      bureau: 'Example Credit Information Bureau',
      quote: ACCOUNT_2_LINE,
      confidence: 0.9,
    },
  ],
}
