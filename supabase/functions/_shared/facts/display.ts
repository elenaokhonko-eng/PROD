// Plain-English display of fact values (confirm screen, "Facts you confirmed") and validation of values the user
// types in on the confirm screen. Display text is built from the value only, so it never adds facts.

import type {
  BankReply,
  CredentialsShared,
  FactKey,
  Institution,
  Money,
  PhishingChannel,
  ReportedEvent,
  ScamType,
  Transaction,
} from "./keys.ts";
import { FACT_LABELS } from "./keys.ts";
import { normaliseInstitution } from "./institutions.ts";
import { normaliseDate, normaliseMoney, normaliseYesNo } from "./normalise.ts";

const CHANNEL_TEXT: Record<PhishingChannel, string> = {
  sms: "SMS",
  email: "Email",
  messaging_app: "WhatsApp or another messaging app",
  social_media: "Social media",
  website_or_ad: "A website or online advert",
  phone_call: "Phone call",
  other: "Other",
};

const CREDENTIALS_TEXT: Record<CredentialsShared, string> = {
  entered_on_fake_site_or_app: "Entered on a fake website or app",
  given_directly: "Given directly to the scammer",
  installed_app_or_malware: "Installed an app the scammer asked for",
  not_shared: "Not shared",
  unsure: "Not sure",
};

const SCAM_TEXT: Record<ScamType, string> = {
  digital_phishing: "Phishing by message, email or website",
  malware: "Malware or a remote-access app",
  non_digital_phishing: "Phishing by phone call or in person",
  impersonation: "Impersonation",
  investment: "Investment scam",
  job: "Job scam",
  romance: "Romance scam",
  ecommerce: "Online shopping scam",
  other: "Other",
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

export function formatMoney(money: Money): string {
  const amount = money.amount.toLocaleString("en-SG", { minimumFractionDigits: money.amount % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return money.currency === "SGD" ? `S$${amount}` : `${money.currency} ${amount}`;
}

function formatEvent(event: ReportedEvent): string {
  const base = event.value === "yes" ? "Yes" : event.value === "no" ? "No" : "Not sure";
  const parts = [base, formatDate(event.date), event.reference ? `reference ${event.reference}` : null].filter(Boolean);
  return parts.join(", ");
}

export function formatFactValue(key: FactKey, value: unknown): string {
  if (value === null || value === undefined) return "Not known";
  switch (key) {
    case "institution_names":
      return (value as Institution[]).map((i) => i.name).join(", ");
    case "account_types":
      return (value as string[]).map((v) => v.replace(/_/g, " ")).join(", ");
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
    case "amount_recovered_or_offered":
      return formatMoney(value as Money);
    case "reported_to_bank":
    case "reported_to_police":
    case "written_complaint_sent":
    case "fidrec_filed":
      return formatEvent(value as ReportedEvent);
    case "bank_reply": {
      const reply = value as BankReply;
      return [REPLY_TEXT[reply.status], formatDate(reply.date), reply.outcome?.replace(/_/g, " ")].filter(Boolean).join(", ");
    }
    case "date_discovered":
      return formatDate(value as string) ?? String(value);
    default:
      return String(value).replace(/_/g, " ");
  }
}

export function factLabel(key: FactKey): string {
  return FACT_LABELS[key];
}

// Values typed on the confirm screen, validated with the same normalisers as extraction. Returns null if invalid.
export function validateFactValue(key: FactKey, input: unknown): unknown | null {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  switch (key) {
    case "institution_names": {
      const names = Array.isArray(input) ? input : [input];
      const list = names.map((n) => normaliseInstitution(typeof n === "string" ? n : (n as { name?: unknown })?.name)).filter(Boolean) as Institution[];
      return list.length ? list : null;
    }
    case "total_loss":
    case "amount_recovered_or_offered":
      return normaliseMoney(typeof input === "number" || typeof input === "string" ? input : (record.amount as string | number | undefined) ?? null);
    case "reported_to_bank":
    case "reported_to_police":
    case "written_complaint_sent":
    case "fidrec_filed": {
      const value = normaliseYesNo(record.value);
      if (!value) return null;
      const date = record.date ? normaliseDate(record.date) : null;
      if (record.date && !date) return null;
      const reference = typeof record.reference === "string" && record.reference.trim() ? record.reference.trim().slice(0, 80) : null;
      return { value, date, reference, channel: null };
    }
    case "bank_reply": {
      const status = record.status;
      if (status !== "none" && status !== "acknowledged" && status !== "interim" && status !== "final_reply") return null;
      const date = record.date ? normaliseDate(record.date) : null;
      if (record.date && !date) return null;
      const outcome = ["rejected", "partial_offer", "full_offer", "other"].includes(record.outcome as string) ? record.outcome : null;
      return { status, date, outcome, qualifies: status === "final_reply" ? normaliseYesNo(record.qualifies) : null, reference: null };
    }
    case "date_discovered":
      return normaliseDate(input);
    case "transactions": {
      if (!Array.isArray(input)) return null;
      const list: Transaction[] = [];
      for (const raw of input) {
        const t = (raw ?? {}) as Record<string, unknown>;
        const amount = normaliseMoney(typeof t.amount === "number" || typeof t.amount === "string" ? t.amount : null);
        if (!amount || amount.amount <= 0) return null;
        const date = t.date ? normaliseDate(t.date) : null;
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
      return ["sms", "email", "messaging_app", "social_media", "website_or_ad", "phone_call", "other"].includes(input as string) ? input : null;
    case "credentials_or_otp_shared":
      return ["entered_on_fake_site_or_app", "given_directly", "installed_app_or_malware", "not_shared", "unsure"].includes(input as string) ? input : null;
    case "scam_type":
    case "account_types": {
      const allowed = key === "scam_type"
        ? ["digital_phishing", "malware", "non_digital_phishing", "impersonation", "investment", "job", "romance", "ecommerce", "other"]
        : ["savings_or_current", "credit_card", "debit_card", "ewallet", "investment", "other"];
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
          : fact.label === "claimant_only" ? `${formatFactValue(key, fact.value)} (no supporting document provided)`
          : formatFactValue(key, fact.value);
      return { factKey: key, label: FACT_LABELS[key], text };
    });
}

// Choices offered on the confirm screen for facts with a fixed set of values.
export const FACT_ENUM_OPTIONS: Partial<Record<FactKey, Array<{ value: string; label: string }>>> = {
  phishing_channel: Object.entries(CHANNEL_TEXT).map(([value, label]) => ({ value, label })),
  credentials_or_otp_shared: Object.entries(CREDENTIALS_TEXT).map(([value, label]) => ({ value, label })),
  scam_type: Object.entries(SCAM_TEXT).map(([value, label]) => ({ value, label })),
  account_types: [
    { value: "savings_or_current", label: "Savings or current account" },
    { value: "credit_card", label: "Credit card" },
    { value: "debit_card", label: "Debit card" },
    { value: "ewallet", label: "E-wallet" },
    { value: "investment", label: "Investment account" },
    { value: "other", label: "Other" },
  ],
  impersonated_entity_type: [
    { value: "bank_or_fi", label: "A bank or financial institution" },
    { value: "government", label: "A government agency" },
    { value: "other_business", label: "Another business" },
    { value: "private_person", label: "A private person" },
    { value: "unsure", label: "Not sure" },
  ],
};

export const BANK_REPLY_OPTIONS = Object.entries(REPLY_TEXT).map(([value, label]) => ({ value, label }));
