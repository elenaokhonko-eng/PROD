// The sentences a customer reads when something cannot be stated plainly ("a pack is never reduced", Elena,
// 27 Nov 2026). One list, so each situation always uses the same words. Every sentence here has her approval;
// a new one needs it before it is merged.

export const APPROVED = {
  // Empty sections (items 14, 18).
  noDatedEvents: "No dated events are confirmed.",
  noPayments: "No individual payments are confirmed.",
  noTotal: "The total amount lost is not confirmed.",
  noDocuments: "No documents are listed for these facts.",
  // The FIDReC pack (items 16, 17, 20, 21).
  noClauseMatched: "No rule clause was matched to the payments in this case.",
  noInstitutionPoint: "No point for the institution could be drawn from the confirmed facts and documents.",
  noDutySetOut: "No duty could be set out from the matched rule clauses and the documents.",
  noFinalReply: "No final reply from the institution had been received when the facts were confirmed.",
  // The free evaluation (items 9, 11).
  evaluationCap: "We’ve reached today’s limit for free evaluations. Your answers are saved. Please come back tomorrow.",
  readingTimedOut: "Reading your documents took too long and did not finish. Please try again now.",
  bothTold: "You have told your bank and the police.",
  // Payments (requirements 9.3, 9.4; approved 27 and 28 Nov 2026).
  tooManyPayments: "This case has more than 150 payments. Please email info@guidebuoyai.sg so we can help you with it.",
  notShownMark: "Not shown in a document",
  // Uploads (item 19).
  unreadableFile: "We couldn’t read this file, so it is not part of your case. Please upload it again, or upload a different document.",
} as const;

// Item 6: a fact the person confirmed that a document shows differently.
export const contradictionSentence = (voice: "you" | "complainant", confirmed: string, document: string, other: string) =>
  `${voice === "you" ? "You confirmed" : "The complainant states"} ${confirmed}. ${document} shows ${other}.`;

// Item 7.
export const noDocumentSentence = (fact: string, value: string) => `${fact}: ${value}. No document yet.`;

// Item 15.
export const bankReplySentence = (final: boolean, date: string | null) =>
  `My bank ${final ? "gave its final reply" : "replied"}${date ? ` on ${date}` : ""}.`;

// 9.4: how the documents' payments compare with the confirmed ones, in numbers. The plural forms ("statements … show",
// "1 payment that is") are variations of the approved sentences.
const many = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const shownSomeSentence = (voice: "you" | "complainant", confirmed: number, documents: string, plural: boolean, matched: number) =>
  `${voice === "you" ? "You confirmed" : "The complainant states"} ${many(confirmed, "payment")}. ${documents} ${plural ? "show" : "shows"} ${matched} of them.`;

export const notConfirmedSentence = (voice: "you" | "complainant", documents: string, plural: boolean, count: number) =>
  `${documents} ${plural ? "show" : "shows"} ${many(count, "payment")} that ${count === 1 ? "is" : "are"} not in ${voice === "you" ? "your" : "the"} confirmed facts.`;
