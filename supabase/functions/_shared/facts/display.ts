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
  type Instrument,
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
  answered: "Gave its answer",
  final_reply: "Final reply",
  not_final: "No final reply yet",
};

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
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

// Elena, 27 Nov 2026: payments are shown in a table; summaries give only how many there are and their total.
export function summariseTransactions(list: readonly Transaction[]): string {
  const totals = new Map<string, number>();
  for (const t of list) totals.set(t.amount.currency, (totals.get(t.amount.currency) ?? 0) + t.amount.amount);
  const total = [...totals].map(([currency, amount]) =>
    formatMoney({ amount: Math.round(amount * 100) / 100, currency, amountSgd: currency === "SGD" ? amount : null })).join(" and ");
  return `${list.length} payment${list.length === 1 ? "" : "s"}, ${total} in total`;
}

/** A fact as a person reads it in a summary. The model, and the table, get every payment. */
export function displayFactValue(key: FactKey, value: unknown): string {
  return key === "transactions" && Array.isArray(value) && value.length
    ? summariseTransactions(value as Transaction[])
    : formatFactValue(key, value);
}

const METHOD_LABELS: Record<Instrument, string> = {
  account_transfer: "Bank account payment",
  sg_card: "Card payment",
  ewallet: "E-wallet payment",
  other: "Other payment",
};

export function transactionRows(list: readonly Transaction[]): Array<Record<string, string>> {
  return list.map((t) => ({
    Date: formatDate(t.date) ?? "Not known",
    Amount: formatMoney(t.amount),
    "Paid to": t.payee ?? "Not known",
    Method: t.channel ?? (t.instrument ? METHOD_LABELS[t.instrument] : null) ?? "Not known",
  }));
}

/** The free evaluation's payments table as stored, and read back. Null when no payment is confirmed. */
export function paymentsTable(facts: Partial<Record<FactKey, { value: unknown; label: string }>>): string | null {
  const fact = facts.transactions;
  if (!fact || (fact.label !== "confirmed" && fact.label !== "claimant_only") || !Array.isArray(fact.value) || !fact.value.length) return null;
  return JSON.stringify(transactionRows(fact.value as Transaction[]));
}

export function parsePaymentsTable(text: string): Array<Record<string, string>> | null {
  try {
    const rows = JSON.parse(text) as unknown;
    return Array.isArray(rows) && rows.length ? (rows as Array<Record<string, string>>) : null;
  } catch {
    return null;
  }
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
    case "fidrec_filed": {
      const value = normaliseYesNo(record.value);
      if (!value) return null;
      const date = record.date ? plausibleDate(record.date) : null;
      if (record.date && !date) return null;
      const reference = typeof record.reference === "string" && record.reference.trim() ? record.reference.trim().slice(0, 80) : null;
      return { value, date, reference, channel: null };
    }
    case "bank_reply": {
      const status = record.status;
      if (status !== "none" && status !== "acknowledged" && status !== "interim" && status !== "answered" && status !== "final_reply") return null;
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
          : fact.label === "claimant_only" ? `${displayFactValue(key, fact.value)} (no supporting document provided)`
          : displayFactValue(key, fact.value);
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
};

export const BANK_REPLY_OPTIONS = Object.entries(REPLY_TEXT).map(([value, label]) => ({ value, label }));
