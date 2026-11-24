// A synthetic credit bureau report (review follow-up, 24 Nov 2026): the card account is shown 30 days overdue, with no
// transaction and no dispute named. Every value is invented: "Example Credit Information Bureau", Example Bank A, a
// card ending 0001, the amounts and dates of the synthetic card-only case. CLAUDE.md: nothing from a real case.

export const CREDIT_BUREAU_OVERDUE_TEXT = [
  'EXAMPLE CREDIT INFORMATION BUREAU (SYNTHETIC) - CONSUMER CREDIT REPORT',
  'Report date: 02 Nov 2025',
  'Enquiry reference: EX-CB-0000',
  'ACCOUNT STATUS',
  'Lender: Example Bank A | Facility: credit card ending 0001 | Credit limit: 10,000.00',
  'Balance as at 15 Oct 2025: 7,550.00',
  'Payment status as at 15 Oct 2025: 30 days overdue',
  '12-month payment history: 0 0 0 0 0 0 0 0 0 0 0 1',
  'Legend: 0 = paid as agreed, 1 = 30 days overdue',
].join('\n')

/** The line that shows the account overdue. It names no transaction and no dispute. */
export const OVERDUE_LINE = 'Payment status as at 15 Oct 2025: 30 days overdue'

/** A line that does name the disputed amount being reported (used to show such an entry is still kept). */
export const DISPUTED_AMOUNT_REPORTED_LINE =
  '16 Oct 2025: Example Bank A reported non-payment of 7,550.00 on card ending 0001 (amount under dispute)'

/**
 * What the extraction prompt asks for, applied to this document: a report "of non-payment of the disputed amount".
 * The document says no such thing, so the list is empty.
 */
export const MODEL_OUTPUT_AS_PROMPTED = {
  document_type: 'credit_bureau_report',
  credit_bureau_reports: [],
}

/** A model that reads the overdue status as a report of the disputed amount (over-reading), quoting the overdue line. */
export const MODEL_OUTPUT_OVER_READ = {
  document_type: 'credit_bureau_report',
  credit_bureau_reports: [{ date: '2025-10-15', bureau: 'Example Credit Information Bureau', quote: OVERDUE_LINE, confidence: 0.8 }],
}
