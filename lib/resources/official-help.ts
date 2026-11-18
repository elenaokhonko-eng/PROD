// Brief W1 §I: the Resources page, server-rendered from this file. Every number and link was read on the
// organisation's own website (sourceUrl) on the date checked. A bank whose number could not be confirmed on its own
// site is left out and listed for Elena (Maybank, 18 Nov: its site did not load). Elena reviews this list before
// each production release that changes it.

import { FIDREC_ABOUT, FIDREC_TIME_LIMIT } from '@/lib/harbor/packs'

export const LAST_CHECKED = '2026-11-18'

export type BankHotline = {
  bank: string
  // The number as the bank writes it, and the same number for a tel: link.
  phone: string
  tel: string
  // The bank's own description of the line, including any key to press. No hours unless the bank states them.
  label: string
  sourceUrl: string
}

export const BANK_HOTLINES: readonly BankHotline[] = [
  { bank: 'DBS / POSB', phone: '1800 339 6963', tel: '+6518003396963', label: '24-hour fraud, scam and lost cards reporting', sourceUrl: 'https://www.dbs.com.sg/personal/contact-us' },
  { bank: 'OCBC', phone: '6363 3333', tel: '+6563633333', label: 'Personal Banking hotline: press 9 to report fraud', sourceUrl: 'https://www.ocbc.com/personal-banking/security/need-help.page' },
  { bank: 'UOB', phone: '6255 0160', tel: '+6562550160', label: '24/7 Fraud Hotline: press 1 to report a case', sourceUrl: 'https://www.uob.com.sg/personal/digital-banking/pib/security/how-uob-protects-you/index.page' },
  { bank: 'Standard Chartered', phone: '6747 7000', tel: '+6567477000', label: 'Personal Banking (24-hour): select 1 to report a fraudulent transaction', sourceUrl: 'https://www.sc.com/sg/fraud-scam/help/' },
  { bank: 'HSBC', phone: '6472 2669', tel: '+6564722669', label: 'Emergency services (fraud and scam related enquiry): 24/7', sourceUrl: 'https://www.hsbc.com.sg/contact/' },
  { bank: 'Citibank', phone: '6337 5519', tel: '+6563375519', label: 'Fraud hotline, 24/7', sourceUrl: 'https://www.citibank.com.sg/static/contact' },
  { bank: 'Bank of China', phone: '1800 66 95566', tel: '+6518006695566', label: '24-hour customer service hotline', sourceUrl: 'https://www.bankofchina.com/sg/bocinfo/bi1/202006/t20200615_18038779.html' },
  { bank: 'ICBC', phone: '6369 5588', tel: '+6563695588', label: 'Hotline (24 hours)', sourceUrl: 'https://www.icbc.com.sg/en/page/721854456743624706.html' },
  { bank: 'CIMB', phone: '6333 7777', tel: '+6563337777', label: 'Hotline for suspected scams and fraud', sourceUrl: 'https://www.cimb.com.sg/en/personal/help-support/security-fraud.html' },
  { bank: 'Trust Bank', phone: '3138 7878', tel: '+6531387878', label: '24/7 reporting channel', sourceUrl: 'https://trustbank.sg/srf/' },
  { bank: 'GXS Bank', phone: '1800 866 6685', tel: '+6518008666685', label: 'GXS Hotline', sourceUrl: 'https://help.gxs.com.sg/Emergencies/Security_Issues/How_do_I_report_an_alleged_fraud_attempt_or_scam%3F' },
  { bank: 'MariBank', phone: '6995 8688', tel: '+6569958688', label: 'Report suspected fraudulent activities: 24/7', sourceUrl: 'https://www.maribank.sg/help-centre/article/10145-how-do-i-contact-maribanks-customer-service' },
]

export type OfficialSource = {
  id: string
  title: string
  // DRAFT for Elena (18 Nov): one line per section, from each organisation's own wording.
  line: string
  phone?: { display: string; tel: string }
  link: { label: string; href: string }
  sourceUrl: string
}

// The brief's order after the bank hotlines: ScamShield, police report, MoneySense, FIDReC, MAS.
export const OFFICIAL_SOURCES: readonly OfficialSource[] = [
  {
    id: 'scamshield',
    title: 'ScamShield',
    line: 'Call the 24/7 ScamShield Helpline on 1799 if you are unsure whether something is a scam.',
    phone: { display: '1799', tel: '1799' },
    link: { label: 'ScamShield website', href: 'https://www.scamshield.gov.sg/' },
    sourceUrl: 'https://www.scamshield.gov.sg/',
  },
  {
    id: 'police',
    title: 'Police report',
    line: 'In an emergency, call 999 or SMS 70999. To report a scam that does not need immediate police action, make a police report online.',
    phone: { display: '999', tel: '999' },
    link: { label: 'Make a police report online', href: 'https://www.police.gov.sg/e-services/lodge-police-report' },
    sourceUrl: 'https://www.police.gov.sg/e-services/lodge-police-report',
  },
  {
    id: 'moneysense',
    title: 'MoneySense',
    line: 'Singapore’s national financial education programme sets out what to do if you suspect you have been scammed.',
    link: { label: 'I suspect I’ve been scammed! What should I do?', href: 'https://www.moneysense.gov.sg/i-suspect-i-ve-been-scammed-what-should-i-do/' },
    sourceUrl: 'https://www.moneysense.gov.sg/i-suspect-i-ve-been-scammed-what-should-i-do/',
  },
  {
    id: 'fidrec',
    title: 'FIDReC',
    // The approved FIDReC sentences, unchanged (pricing card and route strip).
    line: `${FIDREC_ABOUT} ${FIDREC_TIME_LIMIT}`,
    link: { label: 'FIDReC: file a complaint', href: 'https://www.fidrec.com.sg/complainant/' },
    sourceUrl: 'https://www.fidrec.com.sg/knowledgebase/article/KA-01013',
  },
  {
    id: 'mas',
    title: 'MAS',
    line: 'To report a problem with your bank or another financial institution, write to the Monetary Authority of Singapore using its guided forms.',
    link: { label: 'Contact MAS', href: 'https://www.mas.gov.sg/contact-us' },
    sourceUrl: 'https://www.mas.gov.sg/contact-us',
  },
]
