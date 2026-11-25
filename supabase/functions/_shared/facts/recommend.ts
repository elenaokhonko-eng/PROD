// Where the user is in the dispute and which stage we recommend (design 6.1). Deterministic and explained; the user
// may choose any other available stage. Follows the FIDReC Terms of Reference (rules/fidrec.ts).

import type { BankReply, Institution, Money, ReportedEvent } from "./keys.ts";
import { fidrecAvailability, type FidrecAvailability, FIDREC_RULES } from "./rules/fidrec.ts";
import { formatMoney } from "./display.ts";
import { addMonths } from "./normalise.ts";

export type JourneyPosition =
  | "not_told"
  | "told_no_complaint"
  | "complaint_recent"
  | "complaint_four_weeks"
  | "final_reply_in_window"
  | "final_reply_expired"
  | "final_reply_not_qualifying"
  | "fidrec_filed"
  | "resolved";

export type StageProduct = "free_evaluation" | "bank_pack" | "fidrec_pack";

export type ProductState =
  | { product: StageProduct; state: "available" }
  | { product: StageProduct; state: "not_offered"; reason: string }
  | { product: StageProduct; state: "available_from"; date: string | null }
  | { product: StageProduct; state: "unavailable" };

export interface Recommendation {
  position: JourneyPosition;
  recommended: StageProduct | null;
  optional: boolean;
  products: ProductState[];
  reasons: string[];
  guidance: string[];
  deadline: { date: string; daysLeft: number; soon: boolean } | null;
  notes: string[];
}

export interface RecommendFacts {
  reportedToBank: ReportedEvent | null;
  writtenComplaint: ReportedEvent | null;
  bankReply: BankReply | null;
  fidrecFiled: ReportedEvent | null;
  totalLoss: Money | null;
  recovered: Money | null;
  institutions: Institution[] | null;
}

export interface RecommendOptions {
  today: string;
  bankPackEnabled: boolean;
  isFidrecMember?: (institutionName: string) => boolean;
}

function position(facts: RecommendFacts, fidrec: FidrecAvailability): JourneyPosition {
  const reply = facts.bankReply;
  const fullyRecovered = facts.totalLoss && facts.recovered && facts.recovered.currency === facts.totalLoss.currency &&
    facts.recovered.amount >= facts.totalLoss.amount;
  if (reply?.outcome === "full_offer" || fullyRecovered) return "resolved";
  if (facts.fidrecFiled?.value === "yes") return "fidrec_filed";
  if (reply?.status === "final_reply") {
    if (reply.qualifies === "yes" && reply.date) return fidrec.available ? "final_reply_in_window" : "final_reply_expired";
    return "final_reply_not_qualifying";
  }
  if (facts.writtenComplaint?.value === "yes") return fidrec.available ? "complaint_four_weeks" : "complaint_recent";
  if (facts.reportedToBank?.value === "yes") return "told_no_complaint";
  return "not_told";
}

export const FINAL_REPLY_EXPIRED_NOTE =
  "FIDReC's Terms of Reference say a final reply is a letter that expressly states it is the institution's final reply, tells you that you can contact FIDReC within six months, and gives FIDReC's contact details (Rule 13(2)). If the reply you received did not state these, you can ask your bank in writing to confirm whether it was its final reply. Whether a document is a final reply is decided by FIDReC.";

export function recommend(facts: RecommendFacts, options: RecommendOptions): Recommendation {
  const fidrec = fidrecAvailability(
    { reportedToBank: facts.reportedToBank, writtenComplaint: facts.writtenComplaint, bankReply: facts.bankReply },
    options.today,
  );
  const pos = position(facts, fidrec);
  const finalReplyReceived = facts.bankReply?.status === "final_reply";

  const fidrecReason = "reason" in fidrec ? fidrec.reason : null;
  const fidrecState: ProductState = fidrec.available
    ? { product: "fidrec_pack", state: "available" }
    : fidrecReason === "fidrec_too_early"
      ? { product: "fidrec_pack", state: "available_from", date: "availableFrom" in fidrec ? fidrec.availableFrom : null }
      : { product: "fidrec_pack", state: "not_offered", reason: fidrecReason ?? "complaint_not_raised" };
  const bankState: ProductState = !options.bankPackEnabled
    ? { product: "bank_pack", state: "unavailable" }
    : finalReplyReceived
      ? { product: "bank_pack", state: "not_offered", reason: "final_reply_received" }
      : { product: "bank_pack", state: "available" };
  const products: ProductState[] = [{ product: "free_evaluation", state: "available" }, bankState, fidrecState];

  const bankAvailable = bankState.state === "available";
  let recommended: StageProduct | null = null;
  let optional = false;
  const reasons: string[] = [];
  const guidance: string[] = [];

  switch (pos) {
    case "not_told":
      recommended = bankAvailable ? "bank_pack" : null;
      reasons.push("You haven't told your bank yet. The first step is a clear written complaint with your evidence.");
      guidance.push("Report the scam to your bank and to the police now, if you haven't already. Reporting quickly matters.");
      break;
    case "told_no_complaint":
      recommended = bankAvailable ? "bank_pack" : null;
      reasons.push("You've told your bank, but not yet sent a full written complaint with your evidence.");
      break;
    case "complaint_recent":
      recommended = bankAvailable ? "bank_pack" : null;
      optional = true;
      reasons.push("You've sent a written complaint. We can't check what it covered, so a GuideBuoy bank pack may help strengthen it.");
      guidance.push("Ask your bank for its final reply.");
      break;
    case "complaint_four_weeks":
      recommended = "fidrec_pack";
      reasons.push("Your bank has had your written complaint for at least four weeks without resolving it, so you can now take it to FIDReC.");
      break;
    case "final_reply_in_window":
      recommended = "fidrec_pack";
      reasons.push("Your bank has sent its final reply. If you disagree with it, FIDReC is the next independent step.");
      break;
    case "final_reply_expired":
      reasons.push("The six-month window to take this to FIDReC after your bank's final reply has passed. You may wish to get advice.");
      break;
    case "final_reply_not_qualifying":
      recommended = fidrec.available ? "fidrec_pack" : null;
      reasons.push("FIDReC decides whether a letter counts as a final reply. A final reply says it is final and tells you that you can contact FIDReC within six months.");
      if (!fidrec.available) guidance.push("Ask your bank for its final reply.");
      break;
    case "fidrec_filed":
      recommended = "fidrec_pack";
      reasons.push("You've already filed with FIDReC. The FIDReC pack helps you prepare for case management and adjudication.");
      break;
    case "resolved":
      reasons.push("Your bank has offered a full refund, so no further step should be needed.");
      break;
  }
  if (!bankAvailable && (pos === "not_told" || pos === "told_no_complaint" || pos === "complaint_recent")) {
    guidance.push("If you haven't yet, report it to your bank's 24-hour fraud hotline, the police and ScamShield (helpline 1799).");
  }

  const deadline = fidrec.available && fidrec.route === "final_reply"
    ? { date: fidrec.deadline, daysLeft: fidrec.daysLeft, soon: fidrec.deadlineSoon }
    : null;

  const notes: string[] = [];
  // Rules review, 25 Nov (wording approved by Elena): the four-week route is not the only one before a final reply.
  // The 28-day check itself is unchanged.
  if (fidrecReason === "fidrec_too_early" && "availableFrom" in fidrec && fidrec.availableFrom) {
    notes.push("FIDReC's rules also allow filing earlier if the institution has already answered and the matter is not resolved (Rule 13(1)(i)).");
  }
  // Rules review, 25 Nov (row 22, wording approved by Elena): when the six months after a final reply have passed, what
  // makes a letter a final reply under FIDReC's rules, and how to ask the bank. FIDReC decides; the free evaluation
  // does not. Shown in the signed-in free evaluation only (this module is not used by public pages).
  if (finalReplyReceived && facts.bankReply?.date && addMonths(facts.bankReply.date, FIDREC_RULES.filingWindowMonthsAfterFinalReply.value) < options.today) {
    notes.push(FINAL_REPLY_EXPIRED_NOTE);
  }
  const cap = FIDREC_RULES.awardCapSgd.value;
  if (facts.totalLoss?.currency === "SGD" && facts.totalLoss.amount > cap) {
    notes.push(`FIDReC awards are capped at ${formatMoney({ amount: cap, currency: "SGD", amountSgd: cap })} per claim. A larger claim goes to adjudication only if you limit your claim or your bank agrees.`);
  }
  if (options.isFidrecMember && facts.institutions?.length && recommended === "fidrec_pack") {
    for (const institution of facts.institutions) {
      if (!options.isFidrecMember(institution.name)) {
        notes.push(`We couldn't confirm that ${institution.name} is a FIDReC member. FIDReC can tell you.`);
      }
    }
  }

  return { position: pos, recommended, optional, products, reasons, guidance, deadline, notes };
}
