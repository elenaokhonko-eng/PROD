// Plain-English display of fact values (confirm screen, "Facts you confirmed") and validation of values the user
// types in on the confirm screen. Display text is built from the value only, so it never adds facts.

import {
  ACCOUNT_CATEGORIES,
  type AccountType,
  type BankReply,
  CREDENTIALS_OPTIONS,
  type CredentialsShared,
  type FactKey,
  type Institution,
  type LossPortion,
  type Money,
  PHISHING_CHANNEL_OPTIONS,
  type PhishingChannel,
  type ReportedEvent,
  SCAM_TYPE_OPTIONS,
  type ScamType,
  type TotalLoss,
  type Transaction,
} from "./keys.ts";
import { FACT_LABELS } from "./keys.ts";
import { normaliseInstitution } from "./institutions.ts";
import { normaliseDate, normaliseMoney, normaliseYesNo } from "./normalise.ts";
import { DATE_PATTERN } from "./validate-output.ts";
import { deviceKey, type RecordedDevice } from "./reconcile.ts";
import {
  type CardDisputeResponse,
  DEVICE_RECOGNITION_ANSWERS,
  type DeviceRecognition,
  type DeviceRecognitionAnswer,
  type InstitutionFaultLabel,
  TOKEN_ACTIVATION_METHODS,
  type TokenActivationMethod,
  type TransactionAlertThreshold,
} from "./update/contract.ts";

const CHANNEL_TEXT: Record<PhishingChannel, string> = {
  phone_call: "Phone call",
  sms: "SMS",
  messaging_app: "WhatsApp or another messaging app",
  email: "Email",
  dating_app: "Dating app",
  social_media: "Social media",
  website_or_ad: "A website or online advert",
  in_person: "In person",
  other: "Other",
};

const CREDENTIALS_TEXT: Record<CredentialsShared, string> = {
  entered_on_fake_site_or_app: "Yes: entered on a fake website or app",
  given_directly: "Yes: told to someone over the phone",
  given_in_message: "Yes: sent in a message",
  installed_app_or_malware: "Yes: installed an app the scammer asked for",
  not_shared: "No: never shared",
  unsure: "Not sure",
};

const SCAM_TEXT: Record<ScamType, string> = {
  phishing_sms_or_message: "Phishing by SMS or messaging app",
  phishing_email: "Phishing by email",
  phishing_call: "Phishing by phone call",
  fake_website_or_ad: "Fake website or advert",
  romance: "Dating or romance scam",
  investment: "Investment scam",
  job: "Job scam",
  government_impersonation: "Someone pretending to be a government official",
  ecommerce: "Online shopping scam",
  malware: "Malware or a remote-access app",
  other: "Other",
  digital_phishing: "Phishing by message, email or website",
  non_digital_phishing: "Phishing by phone call or in person",
  impersonation: "Impersonation",
};

const ACCOUNT_TEXT: Record<AccountType, string> = {
  savings_or_current: "Bank account",
  debit_card: "Debit card",
  credit_card: "Credit card",
  ewallet: "E-wallet or e-money account with a payment service provider",
  investment: "Investment account",
  other: "Something else",
};

const REPLY_TEXT: Record<BankReply["status"], string> = {
  none: "No reply yet",
  acknowledged: "Acknowledged only",
  interim: "Interim reply",
  final_reply: "Final reply",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

// FIDReC update (Lane 2): draft wording for Elena.
const DEVICE_ANSWER_TEXT: Record<DeviceRecognitionAnswer, string> = {
  mine: "mine",
  not_mine: "not mine",
  not_sure: "not sure",
};

const TOKEN_ACTIVATION_TEXT: Record<TokenActivationMethod, string> = {
  in_app: "In the bank's app",
  sms_code: "With a code sent by SMS",
  mailed_code: "With a code sent by post",
  not_known: "Not known",
};

const DISPUTE_STATUS_TEXT: Record<CardDisputeResponse["status"], string> = {
  raised: "The bank raised a dispute",
  declined: "The bank declined to raise a dispute",
  no_answer: "The bank has not answered",
  not_known: "Not known",
};

export const UNNAMED_DEVICE_TEXT = "A device the records do not name";

/** A record's time as the record gives it, for example "12 Sep 2025, 20:10" (the record's own zone). */
export function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = formatDate(iso.slice(0, 10));
  const time = /T(\d{2}:\d{2})/.exec(iso)?.[1];
  return time ? `${date}, ${time}` : date;
}

export function deviceName(device: { deviceLabel: string | null }): string {
  return device.deviceLabel ?? UNNAMED_DEVICE_TEXT;
}

// The record lists hold device identifiers and IP addresses, so they are summarised by count and dates, never listed.
function formatRecordSpan(events: ReadonlyArray<{ timestamp: string | null }>): string {
  const dates = events.map((e) => e.timestamp?.slice(0, 10)).filter((d): d is string => Boolean(d)).sort();
  const count = `${events.length} ${events.length === 1 ? "line" : "lines"}`;
  if (!dates.length) return count;
  const first = formatDate(dates[0]);
  const last = formatDate(dates[dates.length - 1]);
  return first === last ? `${count} on ${first}` : `${count} from ${first} to ${last}`;
}

function formatDevices(devices: ReadonlyArray<RecordedDevice & { answer?: DeviceRecognitionAnswer }>): string {
  return devices
    .map((d) => {
      const seen = formatDateTime(d.firstSeenAt);
      const name = seen ? `${deviceName(d)} (first seen ${seen})` : deviceName(d);
      return d.answer ? `${name}: ${DEVICE_ANSWER_TEXT[d.answer]}` : name;
    })
    .join("; ");
}

/**
 * The complainant's answers for the devices a finding lists, checked against that list: one answer per device, the
 * device's reference, label and first-seen time taken from the records, not from the request. Null if any is missing.
 */
export function answerDevices(recorded: readonly RecordedDevice[], input: unknown): DeviceRecognition[] | null {
  if (!Array.isArray(input) || !recorded.length) return null;
  const answers = new Map<string, DeviceRecognitionAnswer>();
  for (const raw of input) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const answer = (DEVICE_RECOGNITION_ANSWERS as readonly unknown[]).includes(r.answer) ? (r.answer as DeviceRecognitionAnswer) : null;
    const ref = typeof r.deviceRef === "string" ? r.deviceRef : null;
    const label = typeof r.deviceLabel === "string" ? r.deviceLabel : null;
    if (!answer) return null;
    answers.set(deviceKey({ deviceRef: ref, deviceLabel: label }), answer);
  }
  if (answers.size !== input.length || answers.size !== recorded.length) return null;
  const out: DeviceRecognition[] = [];
  for (const device of recorded) {
    const answer = answers.get(deviceKey(device));
    if (!answer) return null;
    out.push({ deviceRef: device.deviceRef, deviceLabel: device.deviceLabel, firstSeenAt: device.firstSeenAt, answer });
  }
  return out;
}

// Cutover checklist, week one: the model's summary writes dates in whatever form it likes; every date in it is
// rewritten in the facts list's form ("3 Oct 2026"), so the evaluation uses one date format. A date that does not
// parse is left as written.
export function harmoniseDates(text: string): string {
  return text.replace(DATE_PATTERN, (match) => formatDate(normaliseDate(match)) ?? match);
}

export function formatMoney(money: Money): string {
  const amount = money.amount.toLocaleString("en-SG", { minimumFractionDigits: money.amount % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return money.currency === "SGD" ? `S$${amount}` : `${money.currency} ${amount}`;
}

// The bank and police references are their own facts (finding A2), so only the FIDReC reference is shown here.
function formatEvent(event: ReportedEvent, withReference: boolean): string {
  const base = event.value === "yes" ? "Yes" : event.value === "no" ? "No" : "Not sure";
  const parts = [base, formatDate(event.date), withReference && event.reference ? `reference ${event.reference}` : null].filter(Boolean);
  return parts.join(", ");
}

function formatLoss(loss: TotalLoss): string {
  if (loss.portions && loss.portions.length > 1) {
    return `${formatMoney(loss)} in total: ${loss.portions.map((p) => `${p.account ? `${ACCOUNT_TEXT[p.account]} ` : ""}${formatMoney(p.amount)}`).join(", ")}`;
  }
  return loss.account ? `${ACCOUNT_TEXT[loss.account]}: ${formatMoney(loss)}` : formatMoney(loss);
}

export function formatFactValue(key: FactKey, value: unknown): string {
  if (value === null || value === undefined) return "Not known";
  switch (key) {
    case "institution_names":
      return (value as Institution[]).map((i) => i.name).join(", ");
    case "account_types":
      return (value as AccountType[]).map((v) => ACCOUNT_TEXT[v] ?? String(v).replace(/_/g, " ")).join(", ");
    case "scam_type":
      return (value as ScamType[]).map((v) => SCAM_TEXT[v] ?? v).join(", ");
    case "phishing_channel":
      return CHANNEL_TEXT[value as PhishingChannel] ?? String(value);
    case "credentials_or_otp_shared":
      return CREDENTIALS_TEXT[value as CredentialsShared] ?? String(value);
    case "transactions":
      return (value as Transaction[])
        .map((t) => [formatMoney(t.amount), formatDate(t.date), t.payee ? `to ${t.payee}` : null, t.instrument === "sg_card" ? "(card)" : null]
          .filter(Boolean).join(" "))
        .join("; ");
    case "total_loss":
      return formatLoss(value as TotalLoss);
    case "amount_recovered_or_offered":
      return formatMoney(value as Money);
    case "reported_to_bank":
    case "reported_to_police":
    case "written_complaint_sent":
      return formatEvent(value as ReportedEvent, false);
    case "fidrec_filed":
      return formatEvent(value as ReportedEvent, true);
    case "bank_case_reference":
    case "police_report_number":
      return String(value);
    case "bank_reply": {
      const reply = value as BankReply;
      return [REPLY_TEXT[reply.status], formatDate(reply.date), reply.outcome?.replace(/_/g, " ")].filter(Boolean).join(", ");
    }
    case "date_discovered":
      return formatDate(value as string) ?? String(value);
    case "access_events":
    case "card_auth_events":
      return formatRecordSpan(value as Array<{ timestamp: string | null }>);
    case "device_recognition":
      return formatDevices(value as Array<RecordedDevice & { answer?: DeviceRecognitionAnswer }>);
    case "access_record_requested":
    case "card_dispute_requested":
      return formatEvent(value as ReportedEvent, false);
    case "card_dispute_response": {
      const response = value as CardDisputeResponse;
      return [DISPUTE_STATUS_TEXT[response.status], formatDate(response.date), response.reasonStated].filter(Boolean).join(", ");
    }
    case "institution_fault_label": {
      const fault = value as InstitutionFaultLabel;
      return fault.conduct ? `“${fault.label}”, for: ${fault.conduct}` : `“${fault.label}”`;
    }
    case "balance_before_first_disputed_payment":
      return formatMoney(value as Money);
    case "transaction_alert_threshold": {
      const threshold = value as TransactionAlertThreshold;
      const by = threshold.setBy === "account_holder" ? " (set by you)" : threshold.setBy === "default" ? " (the bank's default)" : "";
      return `${formatMoney(threshold.amount)}${by}`;
    }
    case "token_activation_method":
      return TOKEN_ACTIVATION_TEXT[value as TokenActivationMethod] ?? String(value);
    default: {
      const option = FACT_ENUM_OPTIONS[key]?.find((o) => o.value === value);
      return option?.label ?? String(value).replace(/_/g, " ");
    }
  }
}

export function factLabel(key: FactKey): string {
  return FACT_LABELS[key];
}

// Values typed on the confirm screen, validated with the same normalisers as extraction. Returns null if invalid.
// A date a person types or changes is refused when it cannot be right: after today in Singapore (one day's
// margin) or before 2000 (walkthrough, 9 Nov: a 2027 date was accepted).
function plausibleDate(input: unknown, now = Date.now()): string | null {
  const date = normaliseDate(input);
  const latest = new Date(now + (8 + 24) * 3_600_000).toISOString().slice(0, 10);
  return date && date >= "2000-01-01" && date <= latest ? date : null;
}

export function validateFactValue(key: FactKey, input: unknown): unknown | null {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  switch (key) {
    case "institution_names": {
      const names = Array.isArray(input) ? input : [input];
      const list = names.map((n) => normaliseInstitution(typeof n === "string" ? n : (n as { name?: unknown })?.name)).filter(Boolean) as Institution[];
      return list.length ? list : null;
    }
    case "total_loss": {
      // One or more amounts, each optionally with its account; the total is their sum.
      const rows = Array.isArray(input) ? input : [input];
      const portions: LossPortion[] = [];
      for (const row of rows) {
        const r = (row && typeof row === "object" ? row : { amount: row }) as Record<string, unknown>;
        const amount = normaliseMoney(typeof r.amount === "number" || typeof r.amount === "string" ? r.amount : null);
        if (!amount || amount.amount <= 0) return null;
        const account = (ACCOUNT_CATEGORIES as readonly string[]).includes(r.account as string) || r.account === "other" ? (r.account as AccountType) : null;
        portions.push({ account, amount });
      }
      if (!portions.length || portions.some((p) => p.amount.currency !== portions[0].amount.currency)) return null;
      const amount = Math.round(portions.reduce((s, p) => s + p.amount.amount, 0) * 100) / 100;
      const currency = portions[0].amount.currency;
      return portions.length === 1
        ? { ...portions[0].amount, account: portions[0].account }
        : { amount, currency, amountSgd: currency === "SGD" ? amount : null, account: null, portions };
    }
    case "amount_recovered_or_offered":
      return normaliseMoney(typeof input === "number" || typeof input === "string" ? input : (record.amount as string | number | undefined) ?? null);
    case "bank_case_reference":
    case "police_report_number": {
      const text = typeof input === "string" ? input.trim() : "";
      return text && text.length <= 80 ? text : null;
    }
    case "reported_to_bank":
    case "reported_to_police":
    case "written_complaint_sent":
    case "fidrec_filed":
    case "access_record_requested":
    case "card_dispute_requested": {
      const value = normaliseYesNo(record.value);
      if (!value) return null;
      const date = record.date ? plausibleDate(record.date) : null;
      if (record.date && !date) return null;
      const reference = typeof record.reference === "string" && record.reference.trim() ? record.reference.trim().slice(0, 80) : null;
      return { value, date, reference, channel: null };
    }
    case "bank_reply": {
      const status = record.status;
      if (status !== "none" && status !== "acknowledged" && status !== "interim" && status !== "final_reply") return null;
      const date = record.date ? plausibleDate(record.date) : null;
      if (record.date && !date) return null;
      const outcome = ["rejected", "partial_offer", "full_offer", "other"].includes(record.outcome as string) ? record.outcome : null;
      return { status, date, outcome, qualifies: status === "final_reply" ? normaliseYesNo(record.qualifies) : null, reference: null };
    }
    case "date_discovered":
      return plausibleDate(input);
    case "transactions": {
      if (!Array.isArray(input)) return null;
      const list: Transaction[] = [];
      for (const raw of input) {
        const t = (raw ?? {}) as Record<string, unknown>;
        const amount = normaliseMoney(typeof t.amount === "number" || typeof t.amount === "string" ? t.amount : null);
        if (!amount || amount.amount <= 0) return null;
        const date = t.date ? plausibleDate(t.date) : null;
        if (t.date && !date) return null;
        const instrument = ["account_transfer", "sg_card", "ewallet", "other"].includes(t.instrument as string) ? t.instrument as Transaction["instrument"] : null;
        list.push({
          date,
          amount,
          channel: null,
          payee: typeof t.payee === "string" && t.payee.trim() ? t.payee.trim().slice(0, 120) : null,
          last4: typeof t.last4 === "string" && /^\d{4}$/.test(t.last4) ? t.last4 : null,
          instrument,
        });
      }
      return list.length ? list : null;
    }
    case "phishing_channel":
      return (PHISHING_CHANNEL_OPTIONS as readonly string[]).includes(input as string) ? input : null;
    case "credentials_or_otp_shared":
      return (CREDENTIALS_OPTIONS as readonly string[]).includes(input as string) ? input : null;
    case "scam_type": {
      // Single-select (finding A5): the scam type decides which rules apply, so exactly one.
      const list = Array.isArray(input) ? input : [input];
      return list.length === 1 && (SCAM_TYPE_OPTIONS as readonly string[]).includes(list[0] as string) ? [list[0]] : null;
    }
    case "account_types": {
      const allowed = [...ACCOUNT_CATEGORIES, "other"];
      const list = (Array.isArray(input) ? input : [input]).filter((v) => allowed.includes(v as string));
      return list.length ? [...new Set(list)] : null;
    }
    case "impersonated_entity_type":
      return ["bank_or_fi", "government", "other_business", "private_person", "unsure"].includes(input as string) ? input : null;
    case "token_activation_method":
      return (TOKEN_ACTIVATION_METHODS as readonly string[]).includes(input as string) ? input : null;
    case "balance_before_first_disputed_payment": {
      const money = normaliseMoney(typeof input === "number" || typeof input === "string" ? input : (record.amount as string | number | undefined) ?? null);
      return money && money.amount >= 0 ? money : null;
    }
    case "transaction_alert_threshold": {
      const amount = normaliseMoney(typeof record.amount === "number" || typeof record.amount === "string" ? record.amount : null);
      const setBy = ["default", "account_holder", "not_known"].includes(record.setBy as string) ? record.setBy : "not_known";
      return amount ? { amount, setBy } : null;
    }
    // The record lists come only from the institution's records, the dispute response and the fault label only from
    // its letters (brief 3b), and device answers are checked against the finding's devices (answerDevices): none is
    // typed in here.
    default:
      return null;
  }
}

// The "Facts you confirmed" section every stage report includes (design 4.3). Rendered by the server from the
// snapshot, never by the model, so it always matches what the user confirmed.
export function factsYouConfirmed(
  facts: Partial<Record<FactKey, { value: unknown; label: "confirmed" | "not_sure" | "claimant_only" | "not_known" }>>,
): Array<{ factKey: FactKey; label: string; text: string }> {
  const order = Object.keys(FACT_LABELS) as FactKey[];
  return order
    .filter((key) => facts[key])
    .map((key) => {
      const fact = facts[key]!;
      const text =
        fact.label === "not_sure" ? "Not sure"
          : fact.label === "not_known" ? "Not known"
          : fact.label === "claimant_only" ? `${formatFactValue(key, fact.value)} (no supporting document provided)`
          : formatFactValue(key, fact.value);
      return { factKey: key, label: FACT_LABELS[key], text };
    });
}

// Choices offered on the confirm screen for facts with a fixed set of values: the full list is always shown, as
// boxes (findings A3, A5, A6). "Other" is not offered separately; "Something else" covers it.
export const FACT_ENUM_OPTIONS: Partial<Record<FactKey, Array<{ value: string; label: string }>>> = {
  phishing_channel: PHISHING_CHANNEL_OPTIONS.filter((v) => v !== "other").map((value) => ({ value, label: CHANNEL_TEXT[value] })),
  credentials_or_otp_shared: CREDENTIALS_OPTIONS.map((value) => ({ value, label: CREDENTIALS_TEXT[value] })),
  scam_type: SCAM_TYPE_OPTIONS.filter((v) => v !== "other").map((value) => ({ value, label: SCAM_TEXT[value] })),
  account_types: ACCOUNT_CATEGORIES.map((value) => ({ value, label: ACCOUNT_TEXT[value] })),
  impersonated_entity_type: [
    { value: "bank_or_fi", label: "A bank or financial institution" },
    { value: "government", label: "A government agency" },
    { value: "other_business", label: "Another business" },
    { value: "private_person", label: "A private person" },
    { value: "unsure", label: "Not sure" },
  ],
  token_activation_method: TOKEN_ACTIVATION_METHODS.filter((v) => v !== "not_known").map((value) => ({ value, label: TOKEN_ACTIVATION_TEXT[value] })),
};

export const BANK_REPLY_OPTIONS = Object.entries(REPLY_TEXT).map(([value, label]) => ({ value, label }));
