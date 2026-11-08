// Synthetic free-evaluation corpus (hardening item 2, 8 Nov). Every person, reference, phone number and account
// number here is invented. Institutions are real Singapore names only because the FIDReC and institution rules
// depend on them. Keep this as the regression suite for any change to the summary prompt, the checks or the model.

export type ConfirmPolicy =
  /** Accept what was found: agreed stays, conflicts take the first value, unsupported claims are kept as "you told us". */
  | 'accept'
  /** "I'm not sure" on every card. */
  | 'unsure'
  /** Conflicts settled for the document's value, so the story is withheld from the model. */
  | 'prefer_documents'

export interface CorpusDocument {
  name: string
  text: string
}

export interface CorpusStory {
  id: string
  tags: string[]
  story: string
  documents?: CorpusDocument[]
  policy?: ConfirmPolicy
}

const BANK_STATEMENT_DBS = `DBS Bank Ltd - Statement of Account
Account: POSB Savings ****1234   Statement date: 31 Oct 2026
Date        Description                              Withdrawal   Deposit   Balance
02 Oct 2026 Opening balance                                                  14,250.00
03 Oct 2026 FAST TRANSFER TO TAN WEI MING  ref 88231  4,800.00                9,450.00
03 Oct 2026 FAST TRANSFER TO TAN WEI MING  ref 88232  3,200.00                6,250.00
05 Oct 2026 GIRO SP SERVICES                            86.40                6,163.60`

const CARD_STATEMENT_OCBC = `OCBC 365 Credit Card Statement   Card ending 5678
Statement date 20 Oct 2026
Transaction date  Description                         Amount (SGD)
14 Oct 2026       SHOPEEPAY*SG                        1,499.00
14 Oct 2026       SHOPEEPAY*SG                        1,499.00
15 Oct 2026       GRAB*FOOD                              23.80`

const POLICE_REPORT = `SINGAPORE POLICE FORCE - Police Report Acknowledgement
Report No: G/20261004/0000
Date/time of report: 04 Oct 2026 10:12
Nature: Cheating (online)
Informant states that on 03 Oct 2026 he received an SMS purportedly from DBS and keyed in his banking credentials on a link.`

const BANK_REPLY_UOB = `United Overseas Bank Limited
22 Oct 2026
Dear Customer,
Re: Your report of unauthorised transactions (Case UOB-SYN-0001)
We have completed our investigation. The transactions of SGD 2,000.00 on 9 Oct 2026 were authorised with your one-time password. Under the Shared Responsibility Framework we are unable to offer a goodwill payment.
Yours faithfully, Customer Advocacy`

const UNRELATED_BILL = `SP Group - Utilities Bill
Account 99-0000-000-0   Bill date 01 Oct 2026
Electricity 312 kWh   S$98.11
Water 14.2 Cu M       S$41.30
Total due by 22 Oct 2026: S$139.41`

const SCANNED_OCR = `D8S  B a n k  L td
St atement  of  Acc0unt     P0SB  Sav ings  ****1234
03 0ct 2026  FAST  TRANSFER  T0  TAN  WEI  M1NG   4,8OO.OO
03 0ct 2026  FAST  TRANSFER  T0  TAN  WEI  M1NG   3,2OO.OO
B a l a n c e   6,25O.OO`

const RAMBLING = `Okay so I will try to explain everything from the start because honestly I am still quite confused about what happened and my daughter told me to write it all down while I still remember. ` +
  `I am 67 and retired, I used to work in logistics, and I do most of my banking on the DBS app which my son set up for me two years ago. ` +
  `On the morning of 3 October 2026 I was having my kopi and I got an SMS that looked exactly like the normal DBS messages, same sender name and everything, saying that there was an unusual login and that I must verify my account within 24 hours or it would be suspended. ` +
  `There was a link. I know now that I should not click links but at that time it looked real and I was worried because my pension goes into that account. ` +
  `The page looked like the DBS page, with the red logo and the same colours, and it asked for my user ID and PIN and then it asked for the code that came by SMS. I typed everything. ` +
  `After that nothing happened, the page just said thank you, your account is verified. I thought okay, done. ` +
  `Then around lunchtime I went to the market and when I came back I saw two notifications on my phone that money had been transferred out. ` +
  `The first one was $4,800 and the second one was $3,200, both to a name I did not know, Tan Wei Ming. So altogether $8,000. ` +
  `I called the DBS hotline straight away, it took very long to get through, maybe 40 minutes, and the officer froze my account and said they would investigate and gave me a reference number which I wrote on a piece of paper but now I cannot find the paper. ` +
  `The next day, 4 October, my daughter brought me to the neighbourhood police centre and we made a police report. I have the acknowledgement slip. ` +
  `Since then the bank has not given me any answer, they just said it is under investigation. I sent them an email also on 10 October explaining everything again. ` +
  `My friend from church said there is some framework where the bank must pay back if it is their fault, I don't know if that applies to me. ` +
  `I also want to say I did not give anyone my card, the card is still with me. The money was savings for my grandson's school fees. ` +
  `Some days I feel very stupid about this. I have not received any money back. I just want to know what I should do next and whether it is worth going to FIDReC, someone mentioned that also. ` +
  `I hope this is enough information, if you need more please tell me. ` +
  `Oh and one more thing, a few days before this there was a phone call from someone saying they were from the bank also, asking if I had made a purchase, I said no and hung up, I don't know if that is related. ` +
  `That is everything I can remember. Thank you for reading this long message.`
const RAMBLING_LONG = Array.from({ length: 3 }, (_, i) => (i === 0 ? RAMBLING : RAMBLING.replace(/^Okay so I will try/, 'Let me say again, I will try'))).join('\n\n')

export const STORIES: CorpusStory[] = [
  // SMS phishing, bank account
  { id: 'sms-01', tags: ['sms', 'phishing', 'bank_account', 'police', 'bank'], story: 'On 3 Oct 2026 I got an SMS from "DBS" saying my account was locked. I clicked the link and entered my login and the OTP. Two transfers went out the same day, $4,800 and $3,200, total $8,000, from my POSB savings. I called DBS that afternoon and made a police report on 4 Oct.' },
  { id: 'sms-02', tags: ['sms', 'phishing', 'bank_account', 'documents'], story: 'SMS pretending to be DBS on 3 October 2026. I entered my details and an OTP on a fake page. $8,000 was taken in two FAST transfers. Reported to DBS same day and to the police next day.', documents: [{ name: 'statement.txt', text: BANK_STATEMENT_DBS }, { name: 'police.txt', text: POLICE_REPORT }] },
  { id: 'sms-03', tags: ['sms', 'phishing', 'conflict', 'documents'], story: 'I received an SMS on 3 Oct 2026 from DBS and gave my OTP. I lost $9,000 from my savings. I told DBS the same day.', documents: [{ name: 'statement.txt', text: BANK_STATEMENT_DBS }] },
  { id: 'sms-04', tags: ['sms', 'phishing', 'conflict', 'documents', 'prefer_documents'], policy: 'prefer_documents', story: 'Got a DBS SMS on 2 Oct 2026, clicked, typed OTP. Lost about $9k. Called DBS hotline.', documents: [{ name: 'statement.txt', text: BANK_STATEMENT_DBS }] },
  { id: 'sms-05', tags: ['sms', 'phishing', 'no_police'], story: 'An SMS from "OCBC" on 12/10/2026 said a payee was added. I followed the link and approved something in my app. S$2,500 went to an unknown account. I told OCBC by phone the same evening. I have not made a police report yet.' },
  // Email phishing
  { id: 'email-01', tags: ['email', 'phishing', 'bank_account'], story: 'I received an email that looked like it was from UOB about a security upgrade on 8 Oct 2026. I logged in through the link and approved a notification. The next morning S$2,000 was gone. I reported it to UOB on 9 Oct and to the police on 10 Oct.' },
  { id: 'email-02', tags: ['email', 'phishing', 'bank_reply', 'documents'], story: 'Email phishing pretending to be UOB, 8 Oct 2026. I gave my OTP. SGD 2,000 lost on 9 Oct. UOB replied and refused to pay anything.', documents: [{ name: 'uob-letter.txt', text: BANK_REPLY_UOB }] },
  { id: 'email-03', tags: ['email', 'phishing', 'card'], story: 'I got an email from "Singpost" about a parcel fee of $2.80. I paid with my OCBC credit card on the site. On 14 Oct 2026 two charges of $1,499 each appeared. I called OCBC and they blocked the card.', documents: [{ name: 'card.txt', text: CARD_STATEMENT_OCBC }] },
  // Phone call scams
  { id: 'call-01', tags: ['call', 'impersonation', 'government'], story: 'On 20 Oct 2026 a man called saying he was from the Ministry of Health and that my identity was used for a crime. He transferred me to a "police officer" who told me to move my savings to a safe account. I transferred $15,000 from my Standard Chartered account in three transfers of $5,000. I reported to the police on 22 Oct and told the bank the same day.' },
  { id: 'call-02', tags: ['call', 'bank_impersonation', 'otp'], story: 'Someone called claiming to be from Citibank fraud team on 5 Nov 2026. They read my card number and asked me to read out the OTP to cancel a transaction. I did. $3,750 was charged to my Citi credit card. I called Citi back on the official number an hour later.' },
  { id: 'call-03', tags: ['call', 'no_dates'], story: 'A caller pretending to be from my bank, HSBC, said my account was compromised and I had to install an app to secure it. After that $6,200 left my account. I have told HSBC.' },
  // Malware
  { id: 'malware-01', tags: ['malware', 'android', 'out_of_scope_check'], story: 'I bought durians on Facebook in September 2026 and the seller asked me to download an app to pay. I installed the APK on my Android phone. On 28 Sep 2026 my OCBC account was drained, S$11,400 in several transfers I did not make. I made a police report on 29 Sep and called OCBC.' },
  { id: 'malware-02', tags: ['malware', 'remote_access'], story: 'A "technician" asked me to install AnyDesk to fix my internet on 1 Oct 2026. While connected, someone transferred $7,000 out of my DBS account. I reported it to DBS and the police the next day.' },
  // Investment and other out-of-SRF scams
  { id: 'invest-01', tags: ['investment', 'out_of_scope', 'authorised'], story: 'I met someone on a dating app who introduced me to a crypto trading platform. Between July and September 2026 I transferred a total of $42,000 from my UOB account myself to different accounts they gave me. When I tried to withdraw they asked for a tax fee. I made a police report on 2 Oct 2026.' },
  { id: 'invest-02', tags: ['investment', 'out_of_scope', 'multi_currency'], story: 'A Telegram group promised returns on gold trading. I paid USD 5,000 and SGD 8,000 in August 2026 by bank transfer from my Maybank account. The platform has disappeared. Police report made 15 Sep 2026.' },
  { id: 'job-01', tags: ['job_scam', 'authorised'], story: 'I took a part-time job "liking" videos. They asked me to top up for higher tasks. I paid $300, $1,200 and $3,500 by PayNow from my DBS account between 1 and 6 Oct 2026. I never got paid out.' },
  { id: 'ecommerce-01', tags: ['ecommerce', 'small_loss'], story: 'I paid $180 by PayNow on 2 Nov 2026 for concert tickets on Carousell and never received them. The seller blocked me.' },
  // Card-only losses
  { id: 'card-01', tags: ['card', 'card_only'], story: 'On 14 Oct 2026 I saw two charges of $1,499 each on my OCBC credit card from SHOPEEPAY that I did not make. I still have my card. I called OCBC the same day and disputed them.', documents: [{ name: 'card.txt', text: CARD_STATEMENT_OCBC }] },
  { id: 'card-02', tags: ['card', 'card_only', 'conflict'], story: 'Unknown charges on my OCBC card on 14 Oct 2026, three of $1,499. I reported it to OCBC.', documents: [{ name: 'card.txt', text: CARD_STATEMENT_OCBC }] },
  { id: 'card-03', tags: ['card', 'debit_card'], story: 'My DBS debit card was used overseas on 30 Oct 2026 for EUR 640 and EUR 1,100 while the card was in my wallet in Singapore. DBS says they are investigating.' },
  // Multiple accounts / e-wallet
  { id: 'multi-01', tags: ['bank_account', 'card', 'ewallet', 'multi_account'], story: 'After a phishing SMS on 3 Oct 2026, the scammer took $5,000 from my DBS savings, charged $2,998 on my OCBC credit card and emptied my GrabPay wallet of $420. I reported to DBS, OCBC and Grab on 3 Oct and to the police on 4 Oct.' },
  { id: 'multi-02', tags: ['bank_account', 'card', 'multi_account', 'split_loss'], story: 'I lost S$9,800 from my bank account and S$3,100 on my credit card, S$12,900 in total, after giving my details on a fake POSB site on 12 Mar 2026. I reported to the bank and the police on 13 Mar 2026; police report number G/20260313/0000.' },
  { id: 'ewallet-01', tags: ['ewallet', 'non_bank'], story: 'Someone took over my Singtel Dash account on 18 Oct 2026 after I gave them an SMS code and spent $860. I told Singtel.' },
  // Lengths
  { id: 'short-01', tags: ['one_line'], story: 'Scammed $5k via SMS link, DBS.' },
  { id: 'short-02', tags: ['one_line', 'no_amount'], story: 'I think I was scammed.' },
  { id: 'long-01', tags: ['long', 'rambling'], story: RAMBLING },
  { id: 'long-02', tags: ['long', 'rambling', 'very_long'], story: RAMBLING_LONG },
  // Singlish / mixed language
  { id: 'singlish-01', tags: ['singlish'], story: 'Wah lau, on 3/10/2026 got SMS say DBS account kena lock, I click the link then key in my password and OTP lor. Then same day $8k gone, two times transfer. I call DBS already, also go police make report next day.' },
  { id: 'singlish-02', tags: ['singlish', 'mixed_language'], story: 'Aiyo my mother kena scam call, the guy say he from MOH, then she transfer 3 times $5000 from her Standard Chartered account on 20 Oct 2026. 我们已经报警了 (we already made a police report) on 22 Oct.' },
  { id: 'mixed-01', tags: ['mixed_language', 'malay'], story: 'Saya terima SMS dari "Maybank" pada 5 Okt 2026, saya klik link dan masukkan OTP. RM is not involved, it was my Singapore Maybank account: S$3,300 hilang. I reported to Maybank the same day.' },
  { id: 'mixed-02', tags: ['mixed_language', 'chinese'], story: '10月3日我收到DBS的短信，点了链接，输入了密码和OTP。当天账户被转走了8000新元。我当天打电话给DBS，第二天报了警。' },
  // Dates
  { id: 'dates-01', tags: ['date_ambiguous'], story: 'On 3/10 I entered my OCBC details on a fake site and lost $2,200 the same night. I called OCBC on 4/10.' },
  { id: 'dates-02', tags: ['date_ambiguous', 'us_format'], story: 'On 10/3/2026 (I mean 3 October) I lost $8,000 from DBS after an SMS link. I reported it on 10/4/2026.' },
  { id: 'dates-03', tags: ['no_dates'], story: 'I lost money from my UOB account after giving an OTP to someone on the phone. About $2,000. I told UOB.' },
  { id: 'dates-04', tags: ['relative_dates'], story: 'Last Tuesday I got a call from "DBS", gave them my OTP, and $3,000 disappeared. Yesterday I made a police report.' },
  // Amount formats
  { id: 'amount-01', tags: ['amount_shorthand'], story: 'Lost S$2.4k on 3 Oct 2026 from my DBS account after a phishing SMS. Reported to DBS same day.' },
  { id: 'amount-02', tags: ['amount_words'], story: 'On 3 Oct 2026 about eight thousand dollars was taken from my POSB account after I gave my OTP. I called POSB.' },
  { id: 'amount-03', tags: ['amount_cents'], story: 'I lost $1,234.56 to a fake Lazada refund page on 7 Oct 2026, charged to my UOB card. Reported to UOB on 7 Oct.' },
  { id: 'amount-04', tags: ['recovered', 'partial_recovery'], story: 'I lost $6,000 from my OCBC account on 1 Oct 2026 to a phishing link. OCBC recovered $1,500 and offered nothing for the rest. I reported to the police on 2 Oct.' },
  // Uncertainty
  { id: 'unsure-01', tags: ['unsure_all'], policy: 'unsure', story: 'On 3 Oct 2026 I got an SMS from DBS and gave my OTP. $8,000 was transferred out. I called DBS and made a police report.' },
  { id: 'unsure-02', tags: ['unsure_all', 'documents'], policy: 'unsure', story: 'Phishing email, UOB, OTP given, money lost.', documents: [{ name: 'uob-letter.txt', text: BANK_REPLY_UOB }] },
  { id: 'unsure-03', tags: ['hedged_story'], story: 'I am not sure if it was an SMS or an email, maybe around early October 2026. I might have typed my OTP somewhere. I think around $3,000 is missing from my DBS account but I have not checked properly. I have not told anyone yet.' },
  // Documents
  { id: 'nodocs-01', tags: ['no_documents', 'police_claimed'], story: 'On 3 Oct 2026 a fake DBS SMS got my OTP and $8,000 was taken. I made a police report on 4 Oct 2026, report number G/20261004/0000, and told DBS on 3 Oct.' },
  { id: 'scan-01', tags: ['scanned_pdf', 'ocr_noise'], story: 'Fake DBS SMS on 3 Oct 2026; I gave my OTP and two transfers went out. I reported it to DBS.', documents: [{ name: 'scan.pdf', text: SCANNED_OCR }] },
  { id: 'unrelated-01', tags: ['unrelated_document'], story: 'On 3 Oct 2026 I got a DBS SMS and lost $8,000 after entering my OTP. Reported to DBS and police.', documents: [{ name: 'bill.pdf', text: UNRELATED_BILL }] },
  { id: 'docs-all-01', tags: ['documents', 'full_case'], story: 'SMS phishing from "DBS" on 3 Oct 2026. Entered credentials and OTP. $4,800 and $3,200 transferred to Tan Wei Ming. Called DBS on 3 Oct, case reference DBS-SYN-0001. Police report 4 Oct. Sent a written complaint to DBS on 10 Oct 2026; no reply yet.', documents: [{ name: 'statement.txt', text: BANK_STATEMENT_DBS }, { name: 'police.txt', text: POLICE_REPORT }] },
  // Bank replies and escalation
  { id: 'reply-01', tags: ['bank_reply', 'rejected', 'fidrec'], story: 'UOB rejected my claim on 22 Oct 2026 for the $2,000 taken on 9 Oct after a phishing email. I am thinking of going to FIDReC. I made a police report on 10 Oct.' },
  { id: 'reply-02', tags: ['bank_reply', 'partial_offer'], story: 'After the $6,000 phishing loss on 1 Oct 2026, OCBC offered me $1,500 as goodwill on 25 Oct. I have not accepted. Police report made 2 Oct.' },
  { id: 'fidrec-01', tags: ['fidrec_filed'], story: 'I lost $11,400 to malware in September 2026 from my OCBC account. OCBC rejected my claim on 20 Oct and I filed with FIDReC on 1 Nov 2026, reference FIDREC-SYN-0001.' },
  // Contradictions inside the story
  { id: 'contra-01', tags: ['self_contradiction'], story: 'I did not report this to the police. On 4 Oct 2026 I made a police report about the $8,000 DBS SMS scam from 3 Oct.' },
  { id: 'contra-02', tags: ['self_contradiction', 'amount'], story: 'I lost $5,000 on 3 Oct 2026 from my DBS account after an SMS. Actually it was $7,000 in total. I told DBS.' },
]
