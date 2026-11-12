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

// One amount lost, with the account or card it left from when a source says so (finding A4).
export interface LossPortion {
  account: AccountType | null;
  amount: Money;
}

// Amount lost: a total, optionally split into portions. A candidate is one amount from one source; when the user
// ticks several amounts on the confirm screen the total is their sum and `portions` lists them.
export interface TotalLoss extends Money {
  account?: AccountType | null;
  portions?: LossPortion[];
}

export type InstitutionType = "bank" | "payment_service_provider" | "telco" | "other";

export interface Institution {
  name: string;
  type: InstitutionType;
}

// The four regulated categories offered on the confirm screen (finding A3) are the first four; "investment" and
// "other" stay valid for values recorded before, and "other" is what "Something else" stores.
export type AccountType = "savings_or_current" | "debit_card" | "credit_card" | "ewallet" | "investment" | "other";
export const ACCOUNT_CATEGORIES = ["savings_or_current", "debit_card", "credit_card", "ewallet"] as const satisfies readonly AccountType[];

// The scam types offered on the confirm screen (finding A5) come first. "digital_phishing", "non_digital_phishing"
// and "impersonation" are kept for values recorded before the split by channel.
export type ScamType =
  | "phishing_sms_or_message"
  | "phishing_email"
  | "phishing_call"
  | "fake_website_or_ad"
  | "romance"
  | "investment"
  | "job"
  | "government_impersonation"
  | "ecommerce"
  | "malware"
  | "other"
  | "digital_phishing"
  | "non_digital_phishing"
  | "impersonation";

export const SCAM_TYPE_OPTIONS = [
  "phishing_sms_or_message",
  "phishing_email",
  "phishing_call",
  "fake_website_or_ad",
  "romance",
  "investment",
  "job",
  "government_impersonation",
  "ecommerce",
  "malware",
  "other",
] as const satisfies readonly ScamType[];

const DIGITAL_PHISHING: ReadonlySet<ScamType> = new Set(["phishing_sms_or_message", "phishing_email", "fake_website_or_ad", "digital_phishing"]);
const NON_DIGITAL_PHISHING: ReadonlySet<ScamType> = new Set(["phishing_call", "non_digital_phishing"]);

export function isDigitalPhishing(type: ScamType): boolean {
  return DIGITAL_PHISHING.has(type);
}

export function isNonDigitalPhishing(type: ScamType): boolean {
  return NON_DIGITAL_PHISHING.has(type);
}

// SMS and messaging apps stay separate: the SRF's mobile operator duties apply to SMS only.
export type PhishingChannel =
  | "phone_call"
  | "sms"
  | "messaging_app"
  | "email"
  | "dating_app"
  | "social_media"
  | "website_or_ad"
  | "in_person"
  | "other";

export const PHISHING_CHANNEL_OPTIONS = [
  "phone_call",
  "sms",
  "messaging_app",
  "email",
  "dating_app",
  "social_media",
  "website_or_ad",
  "in_person",
  "other",
] as const satisfies readonly PhishingChannel[];

// Merges the spec's credentials_entry_point and clicked_link_or_installed_app (design 2.2a).
// given_directly means told over the phone; given_in_message means sent in a message (finding A6).
export type CredentialsShared =
  | "entered_on_fake_site_or_app"
  | "given_directly"
  | "given_in_message"
  | "installed_app_or_malware"
  | "not_shared"
  | "unsure";

export const CREDENTIALS_OPTIONS = [
  "entered_on_fake_site_or_app",
  "given_directly",
  "given_in_message",
  "installed_app_or_malware",
  "not_shared",
] as const satisfies readonly CredentialsShared[];

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
  total_loss: TotalLoss;
  reported_to_bank: ReportedEvent;
  // Separate from "told the bank" so a missing or different reference never contradicts the yes/no (finding A2).
  bank_case_reference: string;
  written_complaint_sent: ReportedEvent;
  bank_reply: BankReply;
  reported_to_police: ReportedEvent;
  police_report_number: string;
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
  "bank_case_reference",
  "written_complaint_sent",
  "bank_reply",
  "reported_to_police",
  "police_report_number",
  "amount_recovered_or_offered",
] as const satisfies readonly FactKey[];

// Facts that can truly have several values: the user may pick more than one value box (finding A1). Every other
// fact is single-select.
export const MULTI_SELECT_FACT_KEYS: ReadonlySet<FactKey> = new Set(["institution_names", "account_types", "transactions", "total_loss"]);

export const ANSWER_ONLY_FACT_KEYS = [
  "fidrec_filed",
  "date_discovered",
  "impersonated_entity_type",
] as const satisfies readonly FactKey[];

export const FACT_LABELS: Record<FactKey, string> = {
  institution_names: "Banks or payment providers involved",
  account_types: "Accounts or cards the money was taken from",
  scam_type: "Type of scam",
  phishing_channel: "How the scammer first contacted you",
  credentials_or_otp_shared: "Whether you shared a password or one-time code, and how",
  transactions: "The payments you dispute",
  total_loss: "Amount lost",
  reported_to_bank: "Whether you told your bank",
  bank_case_reference: "Your bank's case reference",
  written_complaint_sent: "Whether you sent a full written complaint",
  bank_reply: "Your bank's reply",
  reported_to_police: "Whether you reported this to the police",
  police_report_number: "Police report number",
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
  const phishing = scamTypes?.some((t) => isDigitalPhishing(t) || isNonDigitalPhishing(t)) ?? true;
  return STAGE_REQUIRED_FACTS[stage].filter((key) => key !== "phishing_channel" || phishing);
}
