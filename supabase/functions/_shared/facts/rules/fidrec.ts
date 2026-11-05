// FIDReC rules from the Terms of Reference v2.2 (with effect from 1 July 2025), as decided by Elena on 2026-11-05
// (design 8.1). The Terms of Reference text itself is kept outside the repository; only clause citations are here.

import type { BankReply, ReportedEvent } from "../keys.ts";
import { addDays, addMonths, daysBetween } from "../normalise.ts";

export const FIDREC_TOR = "FIDReC Terms of Reference v2.2 (1 July 2025)";

export const FIDREC_RULES = {
  // F2: earliest filing is 4 weeks after the complaint was referred to the institution, or earlier if its internal
  // process has already failed to resolve it (Rule 13(1)(i); Rule 4(1)(v)).
  earliestFilingDaysAfterComplaint: { value: 28, cite: "Rule 13(1)(i); Rule 4(1)(v)" },
  // F3: no later than six months after the institution's final reply (Rule 13(1)(ii); Rule 5(vi)).
  filingWindowMonthsAfterFinalReply: { value: 6, cite: "Rule 13(1)(ii); Rule 5(vi)" },
  // F4: what counts as a final reply (Rule 13(2)).
  finalReplyDefinition: { cite: "Rule 13(2)" },
  // F1: complain to the institution first (Rule 4(2)).
  complainFirst: { cite: "Rule 4(2)" },
  // F5: the institution must be a FIDReC subscriber (Rule 4(1)(ii), (vi)).
  subscriberRequired: { cite: "Rule 4(1)(ii), (vi)" },
  // F6: award cap per claim (Rule 29(1); Rule 21(2)).
  awardCapSgd: { value: 150_000, cite: "Rule 29(1); Rule 21(2)" },
  // F7: settled, decided by a court, or already decided by FIDReC (Rule 5(viii)-(x)).
  excludedResolved: { cite: "Rule 5(viii)-(x)" },
  // F9: complainant case fee if the dispute goes to adjudication, part refundable (Annex 1, 6.4-6.6).
  adjudicationFeeSgd: { value: 250, refundableSgd: 200, cite: "Annex 1, 6.4-6.6" },
} as const;

export type FidrecAvailability =
  | { available: true; route: "final_reply"; deadline: string; daysLeft: number; deadlineSoon: boolean }
  | { available: true; route: "four_weeks"; deadline: null }
  | { available: false; reason: "complaint_not_raised" }
  | { available: false; reason: "fidrec_too_early"; availableFrom: string | null }
  | { available: false; reason: "fidrec_window_expired"; deadline: string };

export function finalReplyDeadline(reply: BankReply | null): string | null {
  if (!reply || reply.status !== "final_reply" || reply.qualifies !== "yes" || !reply.date) return null;
  return addMonths(reply.date, FIDREC_RULES.filingWindowMonthsAfterFinalReply.value);
}

// Whether the user can take the dispute to FIDReC today, by the Terms of Reference routes F2 and F3.
export function fidrecAvailability(
  facts: { reportedToBank: ReportedEvent | null; writtenComplaint: ReportedEvent | null; bankReply: BankReply | null },
  today: string,
): FidrecAvailability {
  const deadline = finalReplyDeadline(facts.bankReply);
  if (deadline) {
    const daysLeft = daysBetween(today, deadline);
    if (daysLeft < 0) return { available: false, reason: "fidrec_window_expired", deadline };
    return { available: true, route: "final_reply", deadline, daysLeft, deadlineSoon: daysLeft <= 30 };
  }

  const complaint = facts.writtenComplaint;
  if (complaint?.value === "yes" && complaint.date) {
    const availableFrom = addDays(complaint.date, FIDREC_RULES.earliestFilingDaysAfterComplaint.value);
    if (daysBetween(availableFrom, today) >= 0) return { available: true, route: "four_weeks", deadline: null };
    return { available: false, reason: "fidrec_too_early", availableFrom };
  }
  if (facts.reportedToBank?.value !== "yes" && complaint?.value !== "yes") return { available: false, reason: "complaint_not_raised" };
  return { available: false, reason: "fidrec_too_early", availableFrom: null };
}
