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
  partlyRead: "Only part of this document was read when this pack was written.",
  notRead: "This document was not read when this pack was written.",
  noFinalReply: "No final reply from the institution had been received when the facts were confirmed.",
  // The free evaluation (items 9, 11).
  evaluationCap: "We can’t prepare more evaluations today. Your answers are saved; please try again tomorrow.",
  bothTold: "You have told your bank and the police.",
  // Uploads (items 19, 20).
  unreadableFile: "We couldn’t read this file, so it is not part of your case. Please upload it again, or upload a different document.",
  readingLimits:
    "When a FIDReC pack is written, about the first two pages of each document are read (4,000 characters), up to 24,000 characters across all documents. Put the pages that matter first.",
} as const;

// Item 6: a fact the person confirmed that a document shows differently.
export const contradictionSentence = (voice: "you" | "complainant", confirmed: string, document: string, other: string) =>
  `${voice === "you" ? "You confirmed" : "The complainant states"} ${confirmed}. ${document} shows ${other}.`;

// Item 7.
export const noDocumentSentence = (fact: string, value: string) => `${fact}: ${value}. No document yet.`;

// Item 15.
export const bankReplySentence = (final: boolean, date: string | null) =>
  `My bank ${final ? "gave its final reply" : "replied"}${date ? ` on ${date}` : ""}.`;
