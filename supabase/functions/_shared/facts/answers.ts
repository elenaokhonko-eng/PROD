// Answers to candidate facts without a model (design 4.1). Structured answers map directly; free text that the
// normalisers can't read is returned separately so the caller can extract it one answer at a time.

import type {
  BankReply,
  BankReplyOutcome,
  BankReplyStatus,
  FactKey,
  PhishingChannel,
  ReportedEvent,
} from "./keys.ts";
import type { FactCandidate } from "./reconcile.ts";
import { institutionsIn } from "./institutions.ts";
import { normaliseDate, normaliseMoney, normaliseYesNo } from "./normalise.ts";

export interface AnswerRow {
  questionKey: string;
  value: string | null;
  revisionId: string;
}

// Journey question keys (design section 5). The journey UI writes these to case_responses.
export const JOURNEY_KEYS = {
  reportedToBank: "journey_reported_to_bank",
  reportedToBankDate: "journey_reported_to_bank_date",
  reportedToBankChannel: "journey_reported_to_bank_channel",
  reportedToBankReference: "journey_reported_to_bank_reference",
  writtenComplaint: "journey_written_complaint",
  writtenComplaintDate: "journey_written_complaint_date",
  bankReplyStatus: "journey_bank_reply_status",
  bankReplyDate: "journey_bank_reply_date",
  bankReplyOutcome: "journey_bank_reply_outcome",
  finalReplyQualifies: "journey_final_reply_qualifies",
  policeReport: "journey_police_report",
  policeReportDate: "journey_police_report_date",
  policeReportNumber: "journey_police_report_number",
  fidrecFiled: "journey_fidrec_filed",
  fidrecDate: "journey_fidrec_date",
  fidrecReference: "journey_fidrec_reference",
  institutionTypes: "journey_institution_types",
} as const;

// Free-text answers worth extracting with the model when they don't parse.
export const FREE_TEXT_ANSWER_KEYS = ["incident_summary", "account_details", "financial_impact", "contact_details"] as const;

const CHANNELS: Record<string, PhishingChannel> = {
  sms: "sms",
  email: "email",
  whatsapp: "messaging_app",
  telegram: "messaging_app",
  messaging_app: "messaging_app",
  social_media: "social_media",
  website: "website_or_ad",
  website_or_ad: "website_or_ad",
  phone_call: "phone_call",
  banking_app: "other",
  other: "other",
};

const REPLY_STATUSES: ReadonlySet<BankReplyStatus> = new Set(["none", "acknowledged", "interim", "final_reply"]);
const REPLY_OUTCOMES: ReadonlySet<BankReplyOutcome> = new Set(["rejected", "partial_offer", "full_offer", "other"]);

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function answerCandidates(rows: readonly AnswerRow[]): { candidates: FactCandidate[]; freeText: AnswerRow[] } {
  const latest = new Map<string, AnswerRow>();
  for (const row of rows) latest.set(row.questionKey, row);
  const get = (key: string) => latest.get(key);
  const value = (key: string) => text(get(key)?.value);

  const candidates: FactCandidate[] = [];
  const freeText: AnswerRow[] = [];
  const add = <K extends FactKey>(factKey: K, v: unknown, keys: string[]) => {
    const used = keys.map(get).filter((r): r is AnswerRow => Boolean(r));
    candidates.push({
      factKey,
      value: v,
      sourceType: "answer",
      sourceRef: { questionKeys: used.map((r) => r.questionKey), revisionIds: used.map((r) => r.revisionId) },
    } as FactCandidate);
  };

  const event = (yesKey: string, dateKey: string | null, referenceKey: string | null, channelKey: string | null): ReportedEvent | null => {
    const answer = normaliseYesNo(value(yesKey));
    if (!answer) return null;
    return {
      value: answer,
      date: dateKey ? normaliseDate(value(dateKey)) : null,
      reference: referenceKey ? value(referenceKey) : null,
      channel: channelKey ? value(channelKey) : null,
    };
  };

  // Intake form
  const institutions = institutionsIn(value("institution_name"));
  if (institutions.length) add("institution_names", institutions, ["institution_name"]);
  const previousContact = normaliseYesNo(value("previous_contact"));
  if (previousContact) {
    add("reported_to_bank", { value: previousContact, date: null, reference: null, channel: null }, ["previous_contact"]);
  }
  const impact = normaliseMoney(value("financial_impact"));
  if (impact) add("total_loss", impact, ["financial_impact"]);
  for (const key of FREE_TEXT_ANSWER_KEYS) {
    const row = get(key);
    if (row && text(row.value) && !(key === "financial_impact" && impact)) freeText.push(row);
  }

  // Journey questions
  const toBank = event(JOURNEY_KEYS.reportedToBank, JOURNEY_KEYS.reportedToBankDate, JOURNEY_KEYS.reportedToBankReference, JOURNEY_KEYS.reportedToBankChannel);
  if (toBank) add("reported_to_bank", toBank, [JOURNEY_KEYS.reportedToBank, JOURNEY_KEYS.reportedToBankDate, JOURNEY_KEYS.reportedToBankReference, JOURNEY_KEYS.reportedToBankChannel]);
  const complaint = event(JOURNEY_KEYS.writtenComplaint, JOURNEY_KEYS.writtenComplaintDate, null, null);
  if (complaint) add("written_complaint_sent", complaint, [JOURNEY_KEYS.writtenComplaint, JOURNEY_KEYS.writtenComplaintDate]);
  const police = event(JOURNEY_KEYS.policeReport, JOURNEY_KEYS.policeReportDate, JOURNEY_KEYS.policeReportNumber, null);
  if (police) add("reported_to_police", police, [JOURNEY_KEYS.policeReport, JOURNEY_KEYS.policeReportDate, JOURNEY_KEYS.policeReportNumber]);
  const fidrec = event(JOURNEY_KEYS.fidrecFiled, JOURNEY_KEYS.fidrecDate, JOURNEY_KEYS.fidrecReference, null);
  if (fidrec) add("fidrec_filed", fidrec, [JOURNEY_KEYS.fidrecFiled, JOURNEY_KEYS.fidrecDate, JOURNEY_KEYS.fidrecReference]);

  const status = value(JOURNEY_KEYS.bankReplyStatus) as BankReplyStatus | null;
  if (status && REPLY_STATUSES.has(status)) {
    const outcome = value(JOURNEY_KEYS.bankReplyOutcome) as BankReplyOutcome | null;
    const reply: BankReply = {
      status,
      date: normaliseDate(value(JOURNEY_KEYS.bankReplyDate)),
      outcome: outcome && REPLY_OUTCOMES.has(outcome) ? outcome : null,
      qualifies: status === "final_reply" ? normaliseYesNo(value(JOURNEY_KEYS.finalReplyQualifies)) : null,
      reference: null,
    };
    add("bank_reply", reply, [JOURNEY_KEYS.bankReplyStatus, JOURNEY_KEYS.bankReplyDate, JOURNEY_KEYS.bankReplyOutcome, JOURNEY_KEYS.finalReplyQualifies]);
  }

  // Follow-up answers use the extract's field paths as question keys.
  const followUpInstitution = institutionsIn(value("case_meta.institution_name"));
  if (followUpInstitution.length) add("institution_names", followUpInstitution, ["case_meta.institution_name"]);
  const channel = CHANNELS[(value("incident.channel") ?? "").toLowerCase()];
  if (channel) add("phishing_channel", channel, ["incident.channel"]);
  const followUpLoss = normaliseMoney(value("reported_loss.amount"));
  if (followUpLoss) add("total_loss", followUpLoss, ["reported_loss.amount"]);
  const policeDate = normaliseDate(value("timeline.reported_to_police_at"));
  if (policeDate) {
    add("reported_to_police", { value: "yes", date: policeDate, reference: null, channel: null }, ["timeline.reported_to_police_at"]);
  }
  const bankDate = normaliseDate(value("timeline.reported_to_institution_at"));
  if (bankDate) {
    add("reported_to_bank", { value: "yes", date: bankDate, reference: null, channel: null }, ["timeline.reported_to_institution_at"]);
  }

  return { candidates, freeText };
}
