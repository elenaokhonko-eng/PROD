// Synthetic evidence for staging tests of the free evaluation, the Bank dispute pack and the FIDReC pack (20 Nov 2026).
// One fictional case: an SMS phishing scam on a fictional bank ("Kallang Bank"), with losses from a savings account
// and a credit card, the bank's acknowledgement, a card dispute, the written complaint, the final reply, and the bank's
// technical access log (a new device token activated minutes before the transfers, overseas IP addresses).
// Every page says it is synthetic. No real person, bank, reference or document is used.
//
//   npx tsx scripts/generate-synthetic-case-documents.ts [--out test-results/synthetic-documents]

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'

export const CASE = {
  person: 'Nur Aisyah Tan',
  email: 'aisyah.tan@example.test',
  bank: 'Kallang Bank Ltd',
  bankShort: 'Kallang Bank',
  savings: 'Kallang Everyday Savings account ending 4821',
  card: 'Kallang Visa Platinum credit card ending 7730',
  bankCaseRef: 'KB-CS-2026-1002-4471',
  cardDisputeRef: 'KB-CD-2026-1003-0912',
  policeRef: 'F/20261003/2219',
  complaintRef: 'KB-CMP-2026-1004-118',
  scamDomain: 'kallang-secure-verify.example',
} as const

const FOOTER = 'SYNTHETIC TEST DOCUMENT - fictional bank and person, created for GuideBuoy staging tests. Not a real record.'

type Line = { text: string; bold?: boolean; size?: number; gap?: number }

class Doc {
  private pages: PDFPage[] = []
  private y = 0
  private constructor(
    private readonly pdf: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly header: string,
  ) {}

  static async create(header: string): Promise<Doc> {
    const pdf = await PDFDocument.create()
    const doc = new Doc(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold), header)
    doc.newPage()
    return doc
  }

  private newPage() {
    const page = this.pdf.addPage([595, 842])
    page.drawText(this.header, { x: 48, y: 800, size: 9, font: this.bold, color: rgb(0.2, 0.3, 0.45) })
    page.drawLine({ start: { x: 48, y: 792 }, end: { x: 547, y: 792 }, thickness: 0.6, color: rgb(0.7, 0.75, 0.8) })
    page.drawText(FOOTER, { x: 48, y: 28, size: 7, font: this.regular, color: rgb(0.55, 0.1, 0.1) })
    this.pages.push(page)
    this.y = 770
  }

  write(lines: Array<Line | string>) {
    for (const raw of lines) {
      const line = typeof raw === 'string' ? { text: raw } : raw
      const size = line.size ?? 10
      const font = line.bold ? this.bold : this.regular
      for (const chunk of wrap(line.text, font, size, 499)) {
        if (this.y < 60) this.newPage()
        this.pages.at(-1)!.drawText(chunk, { x: 48, y: this.y, size, font })
        this.y -= size + 4
      }
      this.y -= line.gap ?? 2
    }
  }

  table(columns: string[], widths: number[], rows: string[][]) {
    const draw = (cells: string[], font: PDFFont) => {
      if (this.y < 70) this.newPage()
      let x = 48
      cells.forEach((cell, i) => {
        this.pages.at(-1)!.drawText(fit(cell, font, 8.5, widths[i] - 4), { x, y: this.y, size: 8.5, font })
        x += widths[i]
      })
      this.y -= 14
    }
    draw(columns, this.bold)
    for (const row of rows) draw(row, this.regular)
    this.y -= 6
  }

  async bytes() {
    return this.pdf.save()
  }
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  if (!text) return ['']
  const out: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > width && current) {
      out.push(current)
      current = word
    } else current = next
  }
  out.push(current)
  return out
}

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = text
  while (t && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1)
  return t
}

const B = (text: string, size = 12): Line => ({ text, bold: true, size, gap: 6 })

async function policeReport() {
  const d = await Doc.create('SINGAPORE POLICE FORCE - E-REPORT ACKNOWLEDGEMENT (SYNTHETIC)')
  d.write([
    B('Police Report Acknowledgement', 14),
    `Report number: ${CASE.policeRef}`,
    'Date and time reported: 3 October 2026, 09:12',
    `Reported by: ${CASE.person}`,
    'Type of offence: Cheating (phishing scam involving bank transfers and card transactions)',
    { text: '', gap: 4 },
    B('Brief facts as stated by the informant'),
    `On 2 October 2026 at about 7.41 pm, I received an SMS that appeared to come from ${CASE.bankShort}, saying my account had been suspended and asking me to verify my details at a link. I clicked the link, which opened a website that looked like ${CASE.bankShort}'s login page (${CASE.scamDomain}). I entered my username, password and a one-time password (OTP) sent to my phone.`,
    `Between 7.52 pm and 8.07 pm, two FAST transfers totalling S$4,000 were made from my ${CASE.savings} to an account I do not know, and two online card transactions totalling S$600 were charged to my ${CASE.card}. I did not make or authorise these transactions.`,
    `I called ${CASE.bankShort}'s fraud hotline at 8.35 pm on 2 October 2026. The bank gave me case reference ${CASE.bankCaseRef} and blocked my card and online banking.`,
    'Total loss reported: S$4,600.',
    { text: '', gap: 4 },
    'This acknowledgement confirms that your report has been received. Please quote the report number in all correspondence.',
  ])
  return d.bytes()
}

async function savingsStatement() {
  const d = await Doc.create(`${CASE.bank.toUpperCase()} - STATEMENT OF ACCOUNT (SYNTHETIC)`)
  d.write([
    B('Statement of Account', 14),
    `Account holder: ${CASE.person}`,
    `Account: ${CASE.savings}`,
    'Statement period: 1 October 2026 to 31 October 2026',
    { text: '', gap: 4 },
  ])
  d.table(
    ['Date', 'Description', 'Withdrawal (S$)', 'Deposit (S$)', 'Balance (S$)'],
    [62, 220, 80, 70, 70],
    [
      ['01 Oct 2026', 'Balance brought forward', '', '', '9,812.40'],
      ['01 Oct 2026', 'GIRO - SP SERVICES', '142.60', '', '9,669.80'],
      ['02 Oct 2026', 'FAST TRANSFER TO LIM K H 19:52', '2,400.00', '', '7,269.80'],
      ['02 Oct 2026', 'FAST TRANSFER TO LIM K H 19:58', '1,600.00', '', '5,669.80'],
      ['15 Oct 2026', 'SALARY', '', '4,250.00', '9,919.80'],
      ['31 Oct 2026', 'INTEREST', '', '0.41', '9,920.21'],
    ],
  )
  d.write(['Transactions marked with a time were made through digital banking.'])
  return d.bytes()
}

async function cardStatement() {
  const d = await Doc.create(`${CASE.bank.toUpperCase()} - CREDIT CARD STATEMENT (SYNTHETIC)`)
  d.write([
    B('Credit Card Statement', 14),
    `Cardholder: ${CASE.person}`,
    `Card: ${CASE.card}`,
    'Statement date: 20 October 2026',
    { text: '', gap: 4 },
  ])
  d.table(
    ['Post date', 'Trans date', 'Description', 'Amount (S$)'],
    [70, 70, 260, 90],
    [
      ['24 Sep 2026', '23 Sep 2026', 'NTUC FAIRPRICE SINGAPORE', '86.35'],
      ['03 Oct 2026', '02 Oct 2026', 'GLOBALTOPUP*ONLINE HK (card not present)', '350.00'],
      ['03 Oct 2026', '02 Oct 2026', 'GLOBALTOPUP*ONLINE HK (card not present)', '250.00'],
      ['05 Oct 2026', '05 Oct 2026', 'DISPUTED - TEMPORARY CREDIT PENDING INVESTIGATION', '-0.00'],
    ],
  )
  d.write(['Total new charges: S$686.35. Two transactions on 2 Oct 2026 are under dispute (ref ' + CASE.cardDisputeRef + ').'])
  return d.bytes()
}

async function smsNotifications() {
  const d = await Doc.create('SMS MESSAGES - SCREENSHOT TRANSCRIPT (SYNTHETIC)')
  d.write([
    B('SMS messages on my phone, 2 October 2026', 14),
    'Transcript of the messages as they appear on my phone.',
    { text: '', gap: 4 },
    B('From: KALLANGBK   19:41', 10),
    `Kallang Bank: Your account has been suspended due to unusual activity. Verify your identity within 24 hours to avoid closure: https://${CASE.scamDomain}/verify`,
    { text: '', gap: 4 },
    B('From: KALLANGBK   19:45', 10),
    'Kallang Bank: Your OTP is 482913. Do not share it with anyone. It is valid for 5 minutes. (Ref: device activation)',
    { text: '', gap: 4 },
    B('From: KALLANGBK   19:46', 10),
    'Kallang Bank: Your digital token was activated on a new device on 02 Oct 2026 19:46. If this was not you, call 1800 000 0000 now.',
    { text: '', gap: 4 },
    B('From: KALLANGBK   19:52', 10),
    'Kallang Bank: FAST transfer of SGD 2,400.00 from a/c ending 4821 to LIM K H on 02 Oct 19:52. Not you? Call 1800 000 0000.',
    { text: '', gap: 4 },
    B('From: KALLANGBK   19:58', 10),
    'Kallang Bank: FAST transfer of SGD 1,600.00 from a/c ending 4821 to LIM K H on 02 Oct 19:58. Not you? Call 1800 000 0000.',
    { text: '', gap: 4 },
    B('From: KALLANGBK   20:05', 10),
    'Kallang Bank: Card ending 7730 was charged SGD 350.00 at GLOBALTOPUP*ONLINE HK on 02 Oct 20:05.',
    { text: '', gap: 4 },
    B('From: KALLANGBK   20:07', 10),
    'Kallang Bank: Card ending 7730 was charged SGD 250.00 at GLOBALTOPUP*ONLINE HK on 02 Oct 20:07.',
    { text: '', gap: 6 },
    'Note: the alerts arrived while my phone was on silent; I saw them at about 8.30 pm.',
  ])
  return d.bytes()
}

async function bankAcknowledgement() {
  const d = await Doc.create(`EMAIL FROM ${CASE.bank.toUpperCase()} (SYNTHETIC)`)
  d.write([
    'From: Kallang Bank Customer Care <care@kallangbank.example>',
    `To: ${CASE.person} <${CASE.email}>`,
    'Date: 3 October 2026, 10:04',
    `Subject: Your fraud report - case reference ${CASE.bankCaseRef}`,
    { text: '', gap: 6 },
    `Dear ${CASE.person},`,
    `Thank you for contacting Kallang Bank on 2 October 2026 at 8.35 pm to report unauthorised activity on your accounts. We have recorded your report under case reference ${CASE.bankCaseRef}.`,
    'As requested, we have suspended your digital banking access and blocked your credit card ending 7730. We have recorded the following transactions as disputed:',
    '- FAST transfer of S$2,400.00 on 2 October 2026 at 19:52 from account ending 4821',
    '- FAST transfer of S$1,600.00 on 2 October 2026 at 19:58 from account ending 4821',
    '- Card transactions of S$350.00 and S$250.00 on 2 October 2026 on card ending 7730',
    'We have initiated a recall request with the receiving bank. We will investigate your case and reply to you in writing. Please send us a copy of your police report and any screenshots of the messages you received.',
    { text: '', gap: 6 },
    'Yours sincerely,',
    'Fraud Operations, Kallang Bank Ltd',
  ])
  return d.bytes()
}

async function cardDispute() {
  const d = await Doc.create(`${CASE.bank.toUpperCase()} - CARD TRANSACTION DISPUTE ACKNOWLEDGEMENT (SYNTHETIC)`)
  d.write([
    B('Card Transaction Dispute - Acknowledgement', 14),
    `Dispute reference: ${CASE.cardDisputeRef}`,
    `Cardholder: ${CASE.person}`,
    `Card: ${CASE.card}`,
    'Date received: 3 October 2026',
    { text: '', gap: 4 },
  ])
  d.table(
    ['Transaction date', 'Merchant', 'Amount (S$)', 'Reason given by cardholder'],
    [90, 170, 70, 170],
    [
      ['02 Oct 2026 20:05', 'GLOBALTOPUP*ONLINE HK', '350.00', 'Not made or authorised by me'],
      ['02 Oct 2026 20:07', 'GLOBALTOPUP*ONLINE HK', '250.00', 'Not made or authorised by me'],
    ],
  )
  d.write([
    'Both transactions were card-not-present online transactions. We will review them under the card scheme rules and our cardholder agreement. Where a chargeback is available, we will raise it with the card scheme within the scheme time limits and let you know the outcome.',
    'A temporary credit may be applied while the dispute is investigated.',
  ])
  return d.bytes()
}

async function writtenComplaint() {
  const d = await Doc.create(`EMAIL TO ${CASE.bank.toUpperCase()} (SYNTHETIC)`)
  d.write([
    `From: ${CASE.person} <${CASE.email}>`,
    'To: Kallang Bank Complaints <complaints@kallangbank.example>',
    'Date: 4 October 2026, 21:18',
    `Subject: Formal complaint - disputed transactions (case ${CASE.bankCaseRef})`,
    { text: '', gap: 6 },
    'Dear Sir or Madam,',
    `I am writing to make a formal complaint about four transactions totalling S$4,600 made on 2 October 2026 from my ${CASE.savings} and my ${CASE.card}. I reported them to the bank at 8.35 pm that evening (case ${CASE.bankCaseRef}) and to the police on 3 October 2026 (report ${CASE.policeRef}).`,
    'I did not make these transactions. I was deceived by an SMS that appeared to come from the bank into entering my details and a one-time password on a fake website. A digital token was then activated on a new device and the transfers were made within minutes.',
    'I ask the bank to restore my funds, to give me the findings of its investigation, and to confirm which alerts, checks, cooling periods and holds applied to these transactions.',
    { text: '', gap: 6 },
    'Yours faithfully,',
    CASE.person,
  ])
  return d.bytes()
}

async function finalReply() {
  const d = await Doc.create(`${CASE.bank.toUpperCase()} - LETTER (SYNTHETIC)`)
  d.write([
    '10 November 2026',
    CASE.person,
    { text: '', gap: 4 },
    `Our reference: ${CASE.complaintRef}`,
    B('Final reply to your complaint dated 4 October 2026', 12),
    `Dear ${CASE.person},`,
    'We have completed our investigation into the transactions of 2 October 2026 reported under case ' + CASE.bankCaseRef + '.',
    'Our records show that the transactions were performed after successful authentication using your login credentials and a one-time password sent to your registered mobile number, and that a digital token was activated on a new device using that one-time password. Transaction alerts were sent to your registered mobile number for each transaction.',
    'As the transactions were authenticated with credentials and a one-time password that you disclosed to a third party, we are unable to reimburse the transferred amounts of S$4,000. Our recall request to the receiving bank was unsuccessful as the funds had been withdrawn.',
    'For the card transactions of S$600, our review found that the transactions were authenticated with a one-time password and we are unable to raise a chargeback.',
    'This is our final reply. If you are not satisfied, you may refer the dispute to the Financial Industry Disputes Resolution Centre (FIDReC) within six months of the date of this letter.',
    { text: '', gap: 6 },
    'Yours sincerely,',
    'Customer Complaints Unit, Kallang Bank Ltd',
  ])
  return d.bytes()
}

async function technicalLog() {
  const d = await Doc.create(`${CASE.bank.toUpperCase()} - DIGITAL BANKING ACCESS RECORDS (SYNTHETIC)`)
  d.write([
    B('Digital banking access and device records', 14),
    `Released to the customer on request under case ${CASE.bankCaseRef}, 12 November 2026.`,
    `Customer: ${CASE.person}`,
    'Period: 25 September 2026 00:00 to 2 October 2026 23:59 (Singapore time)',
    { text: '', gap: 4 },
    B('Registered devices', 11),
  ])
  d.table(
    ['Device ID', 'Model', 'Registered', 'Status'],
    [150, 140, 110, 100],
    [
      ['IOS-7C1E-44A0-9B12', 'iPhone 14 (iOS 19.2)', '14 Mar 2024 08:10', 'Active'],
      ['AND-58F3-0D9A-E7C4', 'Android SM-A546E', '02 Oct 2026 19:46', 'Blocked 02 Oct 20:41'],
    ],
  )
  d.write([B('Login and transaction events', 11)])
  d.table(
    ['Time (SGT)', 'Event', 'Device ID', 'IP address', 'IP location'],
    [90, 150, 105, 85, 70],
    [
      ['29 Sep 08:02', 'Login (biometric)', 'IOS-7C1E-44A0-9B12', '116.86.12.45', 'Singapore'],
      ['02 Oct 19:44', 'Web login (password)', 'Browser (Windows)', '203.0.113.77', 'Vietnam'],
      ['02 Oct 19:45', 'OTP sent - token activation', '-', '-', '-'],
      ['02 Oct 19:46', 'Digital token activated', 'AND-58F3-0D9A-E7C4', '198.51.100.23', 'Cambodia'],
      ['02 Oct 19:49', 'New payee added: LIM K H', 'AND-58F3-0D9A-E7C4', '198.51.100.23', 'Cambodia'],
      ['02 Oct 19:50', 'Transfer limit raised to S$10,000', 'AND-58F3-0D9A-E7C4', '198.51.100.23', 'Cambodia'],
      ['02 Oct 19:52', 'FAST transfer S$2,400.00', 'AND-58F3-0D9A-E7C4', '198.51.100.23', 'Cambodia'],
      ['02 Oct 19:58', 'FAST transfer S$1,600.00', 'AND-58F3-0D9A-E7C4', '198.51.100.23', 'Cambodia'],
      ['02 Oct 20:05', 'Card CNP S$350.00, 3-D Secure OTP', 'Browser (Windows)', '203.0.113.77', 'Vietnam'],
      ['02 Oct 20:07', 'Card CNP S$250.00, 3-D Secure OTP', 'Browser (Windows)', '203.0.113.77', 'Vietnam'],
      ['02 Oct 20:41', 'All access blocked by bank', '-', '-', '-'],
    ],
  )
  d.write([
    'Notes from the bank:',
    '- No cooling period was applied between the digital token activation (19:46) and the first high-risk transaction (19:52).',
    '- The device AND-58F3-0D9A-E7C4 had not been used with this customer before 2 October 2026.',
    '- Fraud surveillance raised no alert for these events.',
    '- The customer has used only the device IOS-7C1E-44A0-9B12, from Singapore IP addresses, since March 2024.',
  ])
  return d.bytes()
}

export const DOCUMENTS: Array<{ file: string; title: string; use: string; build: () => Promise<Uint8Array> }> = [
  { file: '01-police-report.pdf', title: 'Police report acknowledgement', use: 'All flows', build: policeReport },
  { file: '02-bank-statement-oct-2026.pdf', title: 'Savings account statement', use: 'All flows', build: savingsStatement },
  { file: '03-credit-card-statement.pdf', title: 'Credit card statement', use: 'All flows (card portion)', build: cardStatement },
  { file: '04-sms-messages.pdf', title: 'SMS messages (scam SMS and alerts)', use: 'All flows', build: smsNotifications },
  { file: '05-bank-incident-email.pdf', title: 'Bank email recording the incident', use: 'All flows', build: bankAcknowledgement },
  { file: '06-card-dispute-acknowledgement.pdf', title: 'Card transaction dispute acknowledgement', use: 'Bank and FIDReC packs', build: cardDispute },
  { file: '07-written-complaint-email.pdf', title: 'Written complaint to the bank', use: 'Bank and FIDReC packs', build: writtenComplaint },
  { file: '08-bank-final-reply.pdf', title: "Bank's final reply", use: 'FIDReC pack', build: finalReply },
  { file: '09-bank-technical-access-records.pdf', title: "Bank's device and access records", use: 'FIDReC pack', build: technicalLog },
]

async function main() {
  const outIndex = process.argv.indexOf('--out')
  const outDir = resolve(outIndex >= 0 ? process.argv[outIndex + 1] : 'test-results/synthetic-documents')
  mkdirSync(outDir, { recursive: true })
  for (const doc of DOCUMENTS) {
    writeFileSync(resolve(outDir, doc.file), await doc.build())
    console.log(`wrote ${doc.file}`)
  }
}

if (process.argv[1]?.includes('generate-synthetic-case-documents')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
