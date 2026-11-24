// A synthetic credit bureau report in the layout of a Credit Bureau Singapore consumer report (review of 25 Nov 2026).
// Layout only, taken from CBS's public descriptions of the report: an "Account Status History" table, one row per
// credit facility, with Product Type, Grantor Bank, Account Type, Date Open/Close, Overdue Balance and the "Last 12
// cycles" string of status letters (oldest on the left). As in the real layout, the rows carry no status words, no
// per-row "as at" date and no legend; only the report has a date.
//
// Every value is invented: the bureau, the banks ("Example Bank A/B/C"), the facilities, the amounts and the letters.
// Nothing is copied from any sample report or client document. CLAUDE.md: nothing from a real case.
//
// Example Bank A's credit card is the synthetic card-only case's card (disputed amount 7,550.00); its overdue balance
// equals the disputed amount, and its cycle string ends in letters other than the rest, but nothing on the row says
// "overdue", "arrears" or "default".

export const CBS_LAYOUT_REPORT_DATE_LINE = 'Report Date: 02/11/2025'

export const CBS_LAYOUT_HEADER = 'Product Type | Grantor Bank | Account Type | Date Open/Close | Overdue Balance | Last 12 cycles'

export const CBS_LAYOUT_ROWS = [
  'Credit Card | Example Bank A | Individual | 01/2019 | 7,550.00 | AAAAAAAAABCC',
  'Credit Card | Example Bank B | Individual | 06/2021 | 0.00 | AAAAAAAAAAAA',
  'Personal Loan | Example Bank C | Joint | 03/2020 - 08/2024 | 0.00 | AAAAAAEEEEEE',
] as const

export const CBS_LAYOUT_TEXT = [
  'EXAMPLE CREDIT BUREAU (SYNTHETIC) - CONSUMER CREDIT REPORT',
  CBS_LAYOUT_REPORT_DATE_LINE,
  'Enquiry Reference: EX-0000',
  'ACCOUNT STATUS HISTORY',
  CBS_LAYOUT_HEADER,
  ...CBS_LAYOUT_ROWS,
].join('\n')

/** The row cells, as the model would read them. */
export const CBS_LAYOUT_CELLS = CBS_LAYOUT_ROWS.map((row) => {
  const [productType, grantorBank, accountType, dateOpenClose, overdueBalance, cycleCodes] = row.split(' | ')
  return { productType, grantorBank, accountType, dateOpenClose, overdueBalance, cycleCodes, row }
})
