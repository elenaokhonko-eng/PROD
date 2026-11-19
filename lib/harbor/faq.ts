import { COMING_SHORTLY, FIDREC_ABOUT, FIDREC_TIME_LIMIT, REFUNDS_LINE } from '@/lib/harbor/packs'

// Brief W1 §J: the FAQ, in the brief's groups and order. The FAQ page and its FAQPage structured data both read this
// list, so the two always say the same thing. Answers marked [policy] in the brief quote the Terms or the Privacy
// Policy and link to them.

export type FaqItem = {
  question: string
  answer: string
  link?: { label: string; href: string }
  // The two pack answers end with "Coming shortly." while the packs are off (Elena, 14 Nov).
  pack?: boolean
}

export type FaqGroup = { title: string; items: readonly FaqItem[] }

export const FAQ_GROUPS: readonly FaqGroup[] = [
  {
    title: 'Start',
    items: [
      { question: 'Who is GuideBuoy for?', answer: 'Anyone aged 18 or over, living in Singapore and acting for themselves, who has lost money to a scam or has a dispute with a bank or payment provider.' },
      { question: 'The scam just happened. What should I do first?', answer: 'Call your bank’s fraud hotline and ask them to freeze your accounts and cards. Call ScamShield on 1799. File a police report. Then come back and start your evaluation.' },
      { question: 'Will I get my money back?', answer: 'No one can promise that. Your bank decides first, and FIDReC can review the bank’s decision. What you control is how clear, complete and well-evidenced your case is. That is what GuideBuoy helps with.' },
      { question: 'Do I need an account?', answer: 'You can write your story first. To save it and get your evaluation you create a free account.' },
      { question: 'What if writing it all down is hard for me?', answer: 'You can type or record your story. A recording is transcribed after you stop, and you can edit the text. “I’m not sure” is always an acceptable answer.' },
    ],
  },
  {
    title: 'What you get',
    items: [
      { question: 'What is the free evaluation?', answer: 'GuideBuoy puts your facts in order, asks you to settle anything that conflicts between your story, your answers and your documents, shows how the rules may apply and suggests a next step. It is free.' },
      { question: 'What is the Bank dispute pack?', answer: 'A concise, formal complaint to your bank with your key facts and evidence. S$18, one-off.', pack: true },
      { question: 'What is the FIDReC escalation pack?', answer: 'A comprehensive case pack for FIDReC’s process, with every material fact, the arguments on both sides and your evidence index. S$188, one-off. You do not need the bank pack first.', pack: true },
      // The sentences already approved on the pricing card, unchanged.
      { question: 'What is FIDReC?', answer: `${FIDREC_ABOUT} ${FIDREC_TIME_LIMIT}` },
      { question: 'Is this legal advice? Does a person review it?', answer: 'No. GuideBuoy is automated and is not legal advice; you check everything before you send it. A 30-minute consultation with a person is available for S$99.' },
      { question: 'Can I correct something?', answer: 'Yes. You confirm every fact before anything is written, and you can add or correct information in your case.' },
    ],
  },
  {
    title: 'Cost',
    items: [
      { question: 'What does it cost?', answer: 'The evaluation is free. The Bank dispute pack is S$18 and the FIDReC escalation pack is S$188, each a one-off price shown before you pay. No GST is added.' },
      // [policy] Terms §6.4, in the two sentences Elena approved for Pricing (18 Nov).
      { question: 'Can I get a refund?', answer: REFUNDS_LINE, link: { label: 'Terms, clause 6.4', href: '/terms#section-6' } },
    ],
  },
  {
    title: 'Privacy',
    items: [
      { question: 'Who can see my case?', answer: 'Only you, through your account. We never share your case with any bank, FIDReC, the police or any other body. You decide what to download and send.' },
      // [policy] Privacy Policy §3–4. DRAFT for Elena (19 Nov).
      {
        question: 'Where is my information kept, and who processes it?',
        answer: 'Your cases and documents are stored in Singapore. Named providers process data for us under contract, including the AI model providers OpenAI and Google (Gemini); some of them process it outside Singapore, under written contracts that require protection comparable to the PDPA. The AI providers do not keep your data to train their models.',
        link: { label: 'Privacy Policy, sections 3 and 4', href: '/privacy#section-3' },
      },
      { question: 'Will GuideBuoy ever ask for my bank login, PIN or OTP?', answer: 'Never.' },
      { question: 'Can I export or delete my information?', answer: 'Yes. You can download your outputs from your case. To delete a case or your account, email info@guidebuoyai.sg; we confirm and delete it, apart from records the law requires us to keep.' },
    ],
  },
]

// The answer as shown, given the pack state.
export function faqAnswer(item: FaqItem, packsLive: boolean): string {
  return item.pack && !packsLive ? `${item.answer} ${COMING_SHORTLY}.` : item.answer
}
