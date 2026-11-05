// Canonical fact keys for the SRF / scam route (design: docs/release/fact-reconciliation-design.md, section 2).
// Shared by the Next.js server (through lib/facts) and the Edge Functions, so the rules are written once.

export type SourceType = "story" | "answer" | "document";
export type Stage = "free" | "bank" | "fidrec";
export type YesNoUnsure = "yes" | "no" | "unsure";

export interface Money {
  amount: number;
  currency: string;
  // Converted only when the currency is SGD; other currencies stay null rather than guessing a rate.
  amountSgd: number | null;
}

export type InstitutionType = "bank" | "payment_service_provider" | "telco" | "other";

export interface Institution {
  name: string;
  type: InstitutionType;
}

export type AccountType = "savings_or_current" | "credit_card" | "debit_card" | "ewallet" | "investment" | "other";

export type ScamType =
  | "digital_phishing"
  | "malware"
  | "non_digital_phishing"
  | "impersonation"
  | "investment"
  | "job"
  | "romance"
  | "ecommerce"
  | "other";

export type PhishingChannel =
  | "sms"
  | "email"
  | "messaging_app"
  | "social_media"
  | "website_or_ad"
  | "phone_call"
  | "other";

// Merges the spec's credentials_entry_point and clicked_link_or_installed_app (design 2.2a).
export type CredentialsShared =
  | "entered_on_fake_site_or_app"
  | "given_directly"
  | "installed_app_or_malware"
  | "not_shared"
  | "unsure";

// sg_card: a Singapore-issued credit, charge or debit card, outside the SRF (design 8.3).
export type Instrument = "account_transfer" | "sg_card" | "ewallet" | "other";

export interface Transaction {
  date: string | null;
  amount: Money;
  channel: string | null;
  payee: string | null;
  last4: string | null;
  instrument: Instrument | null;
}

export interface ReportedEvent {
  value: YesNoUnsure;
  date: string | null;
  reference: string | null;
  channel: string | null;
}

export type BankReplyStatus = "none" | "acknowledged" | "interim" | "final_reply";
export type BankReplyOutcome = "rejected" | "partial_offer" | "full_offer" | "other";

export interface BankReply {
  status: BankReplyStatus;
  date: string | null;
  outcome: BankReplyOutcome | null;
  // ToR Rule 13(2): the letter says it is the final reply and mentions FIDReC within six months.
  qualifies: YesNoUnsure | null;
  reference: string | null;
}

export type ImpersonatedEntityType = "bank_or_fi" | "government" | "other_business" | "private_person" | "unsure";

export interface FactValues {
  institution_names: Institution[];
  account_types: AccountType[];
  scam_type: ScamType[];
  phishing_channel: PhishingChannel;
  credentials_or_otp_shared: CredentialsShared;
  transactions: Transaction[];
  total_loss: Money;
  reported_to_bank: ReportedEvent;
  written_complaint_sent: ReportedEvent;
  bank_reply: BankReply;
  reported_to_police: ReportedEvent;
  amount_recovered_or_offered: Money;
  // Taken from answers or the story without reconciliation at launch (design 2.2a).
  fidrec_filed: ReportedEvent;
  date_discovered: string;
  impersonated_entity_type: ImpersonatedEntityType;
}

export type FactKey = keyof FactValues;

export const RECONCILED_FACT_KEYS = [
  "institution_names",
  "account_types",
  "scam_type",
  "phishing_channel",
  "credentials_or_otp_shared",
  "transactions",
  "total_loss",
  "reported_to_bank",
  "written_complaint_sent",
  "bank_reply",
  "reported_to_police",
  "amount_recovered_or_offered",
] as const satisfies readonly FactKey[];

export const ANSWER_ONLY_FACT_KEYS = [
  "fidrec_filed",
  "date_discovered",
  "impersonated_entity_type",
] as const satisfies readonly FactKey[];

export const FACT_LABELS: Record<FactKey, string> = {
  institution_names: "Banks or payment providers involved",
  account_types: "Accounts or cards used",
  scam_type: "Type of scam",
  phishing_channel: "How the scammer first contacted you",
  credentials_or_otp_shared: "Whether you shared a password or one-time code, and how",
  transactions: "The payments you dispute",
  total_loss: "Amount lost",
  reported_to_bank: "Whether you told your bank",
  written_complaint_sent: "Whether you sent a full written complaint",
  bank_reply: "Your bank's reply",
  reported_to_police: "Whether you reported this to the police",
  amount_recovered_or_offered: "Amount recovered or offered",
  fidrec_filed: "Whether you have filed with FIDReC",
  date_discovered: "When you found out",
  impersonated_entity_type: "Who the scammer pretended to be",
};

// Facts each stage needs before it can be generated (spec section 7, adapted to the launch set).
// phishing_channel is required only when the confirmed scam type includes phishing.
const FREE_REQUIRED: FactKey[] = ["institution_names", "scam_type", "phishing_channel", "reported_to_bank", "bank_reply"];
const BANK_REQUIRED: FactKey[] = [
  ...FREE_REQUIRED,
  "transactions",
  "total_loss",
  "credentials_or_otp_shared",
  "reported_to_police",
];
const FIDREC_REQUIRED: FactKey[] = [...BANK_REQUIRED, "written_complaint_sent", "amount_recovered_or_offered"];

export const STAGE_REQUIRED_FACTS: Record<Stage, readonly FactKey[]> = {
  free: FREE_REQUIRED,
  bank: BANK_REQUIRED,
  fidrec: FIDREC_REQUIRED,
};

export function requiredFactsFor(stage: Stage, scamTypes: readonly ScamType[] | null): FactKey[] {
  const phishing = scamTypes?.some((t) => t === "digital_phishing" || t === "non_digital_phishing") ?? true;
  return STAGE_REQUIRED_FACTS[stage].filter((key) => key !== "phishing_channel" || phishing);
}
