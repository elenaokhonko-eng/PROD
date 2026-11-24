// The contract between the lanes of the FIDReC pack update (docs/agent-briefs/2026-11-23-agent-lanes-fidrec-update.md,
// Step 0). Shapes and keys come from brief v5 (docs/agent-briefs/2026-11-20-agent-brief-fidrec-technical-records-and-
// standards-corpus.md): Phase 3b (facts), 3c (IP locations), section 4 (the comparison form), 4a-4i (sections),
// 3.2 (as-of reads) and Phase 7 (card scheme statements).
//
// Frozen after Step 0: only Lane 6 changes this file, and it tells every lane when it does.
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type { FactValues, Institution, Instrument, Money, ReportedEvent, Transaction } from "../keys.ts";
import type { FactLabel } from "../snapshot.ts";
import { normaliseInstitution } from "../institutions.ts";

/** A calendar date, YYYY-MM-DD (the database's `date`). */
export type IsoDate = string;
/** A time with its offset, for example 2025-07-03T21:05:00+08:00. */
export type IsoDateTime = string;

// ---------------------------------------------------------------------------------------------------------------
// Document types (brief 3a). Only these two can supply or contradict access_events and card_auth_events.
// ---------------------------------------------------------------------------------------------------------------

export const TECHNICAL_RECORD_DOCUMENT_TYPES = ["bank_access_record", "card_authentication_record"] as const;
export type TechnicalRecordDocumentType = (typeof TECHNICAL_RECORD_DOCUMENT_TYPES)[number];

/**
 * Review of 24 Nov 2026, Decision 8 (Lane 2): a credit bureau report. Optional: never required to buy or generate a
 * pack, not part of the evidence check; the checklist suggests it for credit card cases. A new category of personal
 * data (privacy wording, export and deletion before release).
 */
export const CREDIT_BUREAU_REPORT_DOCUMENT_TYPE = "credit_bureau_report" as const;
export const OPTIONAL_UPDATE_DOCUMENT_TYPES = [CREDIT_BUREAU_REPORT_DOCUMENT_TYPE] as const;
export type OptionalUpdateDocumentType = (typeof OPTIONAL_UPDATE_DOCUMENT_TYPES)[number];

// ---------------------------------------------------------------------------------------------------------------
// Facts (brief 3b, and the 4a additions)
// ---------------------------------------------------------------------------------------------------------------

export const ACCESS_EVENT_KINDS = [
  "login",
  "new_device_login",
  "token_activated",
  "device_registered",
  "payee_added",
  "limit_changed",
  "notifications_disabled",
  "contact_details_changed",
  "otp_sent",
  "alert_sent",
  "payment_authenticated",
  "account_blocked",
  "other",
] as const;
export type AccessEventKind = (typeof ACCESS_EVENT_KINDS)[number];

/** One line of the institution's record of logins, devices and alerts (`bank_access_record`). */
export interface AccessEvent {
  timestamp: IsoDateTime | null;
  kind: AccessEventKind;
  deviceLabel: string | null;
  deviceRef: string | null;
  ip: string | null;
  channel: string | null;
  authorisedBy: string | null;
  sentTo: string | null;
  /**
   * The digital token the line names (review of 24 Nov 2026, Lane 4 issue 5), kept only when it appears in the line's
   * own quoted words. Lets step 8 of the sequence link a payment to a token by the record's statement that the payment
   * was approved with that token, not only by device.
   */
  tokenRef: string | null;
  /** Index into the `transactions` fact. */
  relatedTransactionIndex: number | null;
}

// The brief names the field without listing values; the corpus knows Visa and Mastercard (standard_documents.card_scheme).
export const CARD_SCHEMES = ["visa", "mastercard", "other", "not_known"] as const;
export type CardScheme = (typeof CARD_SCHEMES)[number];

export const ENTRY_MODES = ["chip", "contactless", "key_entered", "ecommerce", "wallet_token", "not_known"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export const CARD_AUTHENTICATIONS = [
  "three_ds_otp",
  "three_ds_in_app",
  "three_ds_digital_token",
  "wallet_device",
  "pin",
  "none_recorded",
  "not_known",
] as const;
export type CardAuthentication = (typeof CARD_AUTHENTICATIONS)[number];

// The brief names `authenticationResult` without listing values. The scheme lines need to tell an authenticated
// payment from an attempt only (4f: visa.3ds.attempted), so the result is one of these, not free text.
export const CARD_AUTHENTICATION_RESULTS = ["authenticated", "attempted", "failed", "not_known"] as const;
export type CardAuthenticationResult = (typeof CARD_AUTHENTICATION_RESULTS)[number];

export const WALLET_PROVISIONING_AUTHENTICATIONS = ["sms_otp", "in_app", "digital_token", "not_known"] as const;
export type WalletProvisioningAuthentication = (typeof WALLET_PROVISIONING_AUTHENTICATIONS)[number];

/** One card payment as the institution's record shows it (`card_authentication_record`). */
export interface CardAuthEvent {
  timestamp: IsoDateTime | null;
  /** Index into the `transactions` fact. */
  transactionIndex: number | null;
  /**
   * The amount as the card record states it (review of 24 Nov 2026, fix list). Null when the line states none (for
   * example a wallet provisioning line). Printed beside the `transactions` amount, never in place of it.
   */
  amount: Money | null;
  cardScheme: CardScheme;
  merchant: string | null;
  merchantCountry: string | null;
  entryMode: EntryMode;
  authentication: CardAuthentication;
  authenticationResult: CardAuthenticationResult;
  sentTo: string | null;
  deviceLabel: string | null;
  deviceRef: string | null;
  tokenRef: string | null;
  walletProvisionedAt: IsoDateTime | null;
  walletDeviceLabel: string | null;
  walletProvisioningAuthentication: WalletProvisioningAuthentication | null;
  walletProvisioningSentTo: string | null;
  walletTokenRemovedAt: IsoDateTime | null;
}

export const DEVICE_RECOGNITION_ANSWERS = ["mine", "not_mine", "not_sure"] as const;
export type DeviceRecognitionAnswer = (typeof DEVICE_RECOGNITION_ANSWERS)[number];

/** Answer-only, one per distinct device; always printed as "the complainant states". */
export interface DeviceRecognition {
  deviceRef: string | null;
  deviceLabel: string | null;
  /** The confirm screen lists each device with the time it was first seen in the records. */
  firstSeenAt: IsoDateTime | null;
  answer: DeviceRecognitionAnswer;
}

/** A device as a record line names it. */
export interface DeviceNamed {
  deviceRef: string | null;
  deviceLabel: string | null;
}

/** Same device: by reference where both have one, otherwise by label (Lane 4's rule, now shared). */
export function sameDevice(a: DeviceNamed, b: DeviceNamed): boolean {
  if (a.deviceRef && b.deviceRef) return a.deviceRef === b.deviceRef;
  return a.deviceLabel !== null && a.deviceLabel === b.deviceLabel;
}

/**
 * The device rule (review of 24 Nov 2026, Lane 4 issue 6; corrected by the second review). Three states:
 * - `mine`: only a clear answer `mine`, on a `device_recognition` fact labelled `confirmed` or `claimant_only`.
 *   Required for any line that rests on the device being the complainant's.
 * - `not_mine`: only a clear answer `not_mine`, on a fact with those labels. Required for any line that rests on the
 *   device not being the complainant's (for example the MAS notice row, which the brief limits to devices the
 *   complainant states are not theirs).
 * - `not_shown`: everything else: answer `not_sure`, no answer for the device, no device named by the record, or a
 *   fact labelled `not_sure` or `not_known`. A line that needs `mine` or `not_mine` prints "The records do not show …"
 *   instead (`SectionWriter.comparisonOnDevice`), never a comparison.
 *
 * Decision 1 in these terms: for card payments approved on a device, anything other than `mine` gives "The records do
 * not show who approved these payments." (`RECORDS_DO_NOT_SHOW_WHO_APPROVED`) and no "refers to" line.
 *
 * The state governs only which lines a section chooses. What the complainant said is still printed as said: a
 * `not_sure` answer prints as "they are not sure" (`deviceRecognitionSentence` in section-writer.ts).
 */
export const DEVICE_OWNERSHIP_STATES = ["mine", "not_mine", "not_shown"] as const;
export type DeviceOwnership = (typeof DEVICE_OWNERSHIP_STATES)[number];

export function deviceOwnership(
  recognition: ContractFact<DeviceRecognition[]> | undefined,
  device: DeviceNamed | null,
): DeviceOwnership {
  if (!device || (!device.deviceRef && !device.deviceLabel)) return "not_shown";
  if (!recognition || recognition.value === null) return "not_shown";
  if (recognition.label !== "confirmed" && recognition.label !== "claimant_only") return "not_shown";
  const answer = recognitionAnswerFor(recognition.value, device);
  return answer === "mine" || answer === "not_mine" ? answer : "not_shown";
}

/** The complainant's answer for a device, as given (for printing), or null when they gave none. */
export function recognitionAnswerFor(answers: readonly DeviceRecognition[], device: DeviceNamed): DeviceRecognitionAnswer | null {
  return answers.find((a) => sameDevice(a, device))?.answer ?? null;
}

export const CARD_DISPUTE_STATUSES = ["raised", "declined", "no_answer", "not_known"] as const;
export type CardDisputeStatus = (typeof CARD_DISPUTE_STATUSES)[number];

/** From the institution's letters only. */
export interface CardDisputeResponse {
  status: CardDisputeStatus;
  date: IsoDate | null;
  reasonStated: string | null;
  outcome: string | null;
}

/** The word or phrase the institution's final reply uses for the complainant's conduct, and the conduct it cites. */
export interface InstitutionFaultLabel {
  label: string;
  labelEvidenceId: string | null;
  conduct: string | null;
  conductEvidenceId: string | null;
}

export const TOKEN_ACTIVATION_METHODS = ["in_app", "sms_code", "mailed_code", "not_known"] as const;
export type TokenActivationMethod = (typeof TOKEN_ACTIVATION_METHODS)[number];

// SRF footnote 7: the default threshold, or the one the account holder set.
export const ALERT_THRESHOLD_SETTERS = ["default", "account_holder", "not_known"] as const;
export type AlertThresholdSetter = (typeof ALERT_THRESHOLD_SETTERS)[number];

export interface TransactionAlertThreshold {
  amount: Money;
  setBy: AlertThresholdSetter;
}

// ---------------------------------------------------------------------------------------------------------------
// Decision 8 (review of 24 Nov 2026): EUPG Section 8, charges and credit records while a transaction is disputed.
// ---------------------------------------------------------------------------------------------------------------

export const DISPUTED_AMOUNT_REQUEST_SOURCES = ["statement", "reminder", "letter", "other", "not_known"] as const;
export type DisputedAmountRequestSource = (typeof DISPUTED_AMOUNT_REQUEST_SOURCES)[number];

/** One request by the institution to pay the disputed amount (statements, reminders, letters). */
export interface DisputedAmountPaymentRequest {
  date: IsoDate | null;
  /** The amount the request asks for, where it says. */
  amount: Money | null;
  source: DisputedAmountRequestSource;
}

export const DISPUTED_AMOUNT_CHARGE_KINDS = ["late_fee", "interest", "other", "not_known"] as const;
export type DisputedAmountChargeKind = (typeof DISPUTED_AMOUNT_CHARGE_KINDS)[number];

/** One late fee, interest or other charge directly relating to the disputed transaction (statements). */
export interface ChargeOnDisputedAmount {
  date: IsoDate | null;
  amount: Money | null;
  kind: DisputedAmountChargeKind;
  /** The charge as the statement names it. */
  description: string | null;
  /** Index into the `transactions` fact, where the statement ties the charge to one payment. */
  relatedTransactionIndex: number | null;
}

/** Where a credit bureau report fact comes from; printed with the source ("the complainant states" for the last). */
export const CREDIT_BUREAU_REPORT_SOURCES = ["credit_bureau_report", "institution_letter", "complainant_statement"] as const;
export type CreditBureauReportSource = (typeof CREDIT_BUREAU_REPORT_SOURCES)[number];

/** One report of non-payment of the disputed amount to a licensed credit bureau. */
export interface CreditBureauReport {
  date: IsoDate | null;
  bureau: string | null;
  source: CreditBureauReportSource;
}

/** When dispute resolution with FIDReC started, when the institution was told, and when it was completed or closed. */
export interface FidrecDisputeDates {
  startedOn: IsoDate | null;
  institutionToldOn: IsoDate | null;
  completedOrClosedOn: IsoDate | null;
}

// ---------------------------------------------------------------------------------------------------------------
// The account's status as a credit bureau report shows it (Elena, 25 Nov 2026; the "account overdue" fact). A report
// that shows the card account overdue, without naming the disputed amount, is not a report of non-payment of the
// disputed amount (`credit_bureau_reports`, #81), but it bears on EUPG 8.3 and 8.4: it is printed beside them as a
// record line with no outcome, and it decides whether those rows may ever read "matches" (CREDIT_RECORDS_RULE below).
// ---------------------------------------------------------------------------------------------------------------

/** Where a status comes from. Read from documents only: a credit bureau report or the institution's letter. */
export const CREDIT_ACCOUNT_STATUS_SOURCES = ["credit_bureau_report", "institution_letter"] as const;
export type CreditAccountStatusSource = (typeof CREDIT_ACCOUNT_STATUS_SOURCES)[number];

/**
 * One account status a document shows, for example "30 days overdue" as at 15 October 2025. Lane 2 extracts it; it is
 * never sent to the model (a record value, printed by the server only).
 */
export interface CreditAccountStatus {
  /** The date the document gives the status for ("as at"); null when it gives none. */
  asOf: IsoDate | null;
  /** The status in the document's own words, verbatim, and inside `quote`. Never paraphrased or normalised. */
  statusText: string;
  /** The facility the status is for, as the document names it ("credit card ending 0001"); null when not named. */
  facility: string | null;
  /** The bureau as the report names it; null for an institution's letter or when not named. */
  bureau: string | null;
  source: CreditAccountStatusSource;
  /** The E-number of the document in the pack's evidence index, set when the pack is built; null before. */
  evidenceId: string | null;
  /** The line of the document the status was read from, word for word. */
  quote: string;
  // Review of 25 Nov 2026 (account and coverage). Optional until Lane 2 extracts them; absent = not known.
  /**
   * The account as the document names it, word for word ("Example Bank A credit card ending 0001"). Printed in the
   * status line. Lane 2: the account line's own words, inside `quote` or on the account's line of the document.
   */
  accountName?: string | null;
  /** The lender as the account line names it ("Example Bank A"). Lane 2: as printed; matched here to the case. */
  lender?: string | null;
  /** The card's last four digits where the account line gives them ("0001"). Lane 2: digits only. */
  last4?: string | null;
  /**
   * The report's own date (its "report date" or date of issue), the same on every status read from one report; for an
   * institution's letter, the letter's date. Lane 2: from the document's header.
   */
  reportDate?: IsoDate | null;
  // Review of 25 Nov 2026, gap c: the layout of a Credit Bureau Singapore report, which has one "Account Status
  // History" row per account and no status words, no per-status date and no legend. Lane 2: as the row shows them.
  /** The row's "Product Type", verbatim ("Credit Card"). */
  productType?: string | null;
  /** The row's "Overdue Balance"; zero when the row shows 0.00; null when the row shows none. */
  overdueBalance?: Money | null;
  /** The row's "Last 12 cycles" code string, verbatim ("AAAAAABAAAAA"). Never read for meaning: no legend is held. */
  cycleCodes?: string | null;
}

/**
 * Good standing, in words (gap c): the status's words, lower-cased with spaces collapsed and end punctuation removed,
 * must be one of these exactly. Anything else (a code string, words not on the list, a non-zero overdue balance) is
 * not good standing: the row carries no outcome and the status prints beside it. Codes are never interpreted.
 */
export const GOOD_STANDING_WORDS: readonly string[] = ["current", "paid as agreed", "no overdue amount", "up to date", "up-to-date"];

export function showsGoodStanding(status: Pick<CreditAccountStatus, "statusText"> & Partial<Pick<CreditAccountStatus, "cycleCodes" | "overdueBalance">>): boolean {
  if (status.cycleCodes && status.cycleCodes.trim()) return false;
  if (status.overdueBalance && status.overdueBalance.amount !== 0) return false;
  const words = status.statusText.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.;:!]+$/, "");
  return GOOD_STANDING_WORDS.includes(words);
}

/** What the rule needs to know about the dispute: the case's institution and the disputed cards' last four digits. */
export interface DisputeAccounts {
  /** The case's institution as confirmed (institution_names[0].name). */
  institutionName: string | null;
  /** The last four digits of every disputed card payment (Transaction.last4), de-duplicated. */
  disputedLast4: readonly string[];
}

const sameInstitution = (a: string, b: string): boolean => {
  const x = normaliseInstitution(a)?.name.toLowerCase();
  const y = normaliseInstitution(b)?.name.toLowerCase();
  return Boolean(x && y && (x === y || a.toLowerCase().includes(y) || x.includes(y)));
};

/**
 * Whether a status is about the disputed account (review of 25 Nov 2026, gap a). A bureau report lists every account
 * the person holds, so a status counts only when:
 * - its account names the case's institution (the lender, else the account name, matched through the institutions
 *   list and its aliases, normaliseInstitution); a status from the institution's own letter is the institution's; and
 * - where it gives a card's last four digits, they are those of a disputed card (and some are known).
 * Anything unknown or unmatched is not about the dispute: it neither blocks "matches" nor prints.
 */
export function statusBelongsToDispute(status: CreditAccountStatus, dispute: DisputeAccounts): boolean {
  if (status.source !== "institution_letter") {
    if (!dispute.institutionName) return false;
    const named = [status.lender, status.accountName].filter((n): n is string => typeof n === "string" && n.trim() !== "");
    if (!named.some((n) => sameInstitution(n, dispute.institutionName!))) return false;
  }
  const last4 = status.last4?.replace(/\D/g, "") ?? "";
  if (last4) return dispute.disputedLast4.includes(last4);
  return true;
}

const dayBefore = (date: IsoDate): IsoDate => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Words that mark a status as overdue (any of them, anywhere in `statusText`). Deliberately wide: a status that names
 * overdue in any way, even "no overdue amount", counts, because the only effect is that 8.3 and 8.4 print the status
 * line with no outcome instead of "matches". It never makes a row "differs".
 */
export const OVERDUE_STATUS_WORDS =
  /\b(?:overdue|past due|arrears?|delinquen\w*|default(?:ed)?|days? late|late payment|\d+\s*dpd|written off|write-off|charged off|charge-off|collections?)\b/i;

export function showsOverdue(status: Pick<CreditAccountStatus, "statusText">): boolean {
  return OVERDUE_STATUS_WORDS.test(status.statusText);
}

/**
 * CREDIT_RECORDS_RULE (Elena, 25 Nov 2026): how EUPG 8.3 and 8.4(a) read the credit bureau evidence for one period
 * ("between those dates": `from` inclusive, `until` exclusive; `until` null = still running, read up to `today`).
 * Lane 3 calls `creditRecordsReading` and wires `creditBureauReportRead` from it; nothing else decides "matches".
 *
 * - `matches` only if a credit bureau report was read (a ready document classified `credit_bureau_report` whose text
 *   was read) AND no status shows the account overdue in the period.
 * - `overdue`: some status shows the account overdue in the period, or shows it overdue with no date (it cannot be
 *   placed outside the period). The section prints each such status as an `account_status` line beside the row, and
 *   the row carries no outcome: no "matches", no "differs", no ending.
 * - `not_read`: no bureau report was read and nothing shows the account overdue. The row keeps its existing outcome
 *   from the other facts (`not_shown` today); never "matches".
 *
 * A status from the institution's letter counts towards `overdue`, never towards `matches`.
 *
 * `dispute` is required (review of 25 Nov 2026, enforced by Lane 3), and two more conditions always apply:
 * - (a) account: only statuses about the disputed account count (`statusBelongsToDispute`); the others neither block
 *   nor print;
 * - (b) coverage: `matches` also needs the period to have ended (`until` set and on or before `today`) and a read
 *   bureau report dated on or after the period's last day (a status's `reportDate`, from a `credit_bureau_report`).
 *   Otherwise the reading is `not_read` with its `reason`, printed as `not_shown`, never "matches".
 *   `matches` also needs at least one status of the disputed account from a bureau report (otherwise `not_read`,
 *   reason `account_not_listed`).
 *
 * Gap c (review of 25 Nov 2026): a status counts towards `matches` only when it states good standing in words from
 * GOOD_STANDING_WORDS (`showsGoodStanding`); the allowlist decides, so "no overdue amount" is good standing. Every other
 * status of the disputed account in the period, or with no date (a code string such as a Credit Bureau Singapore "Last
 * 12 cycles" row, a non-zero overdue balance, words not on the list, the overdue words above), makes the reading
 * `overdue`: the row carries no outcome and each such status prints beside it. The kind keeps its name for the
 * callers; read it as "no outcome: print these statuses". Codes are never interpreted: no legend is held.
 */
export type CreditRecordsReading =
  | { kind: "matches" }
  | { kind: "overdue"; statuses: CreditAccountStatus[] }
  | { kind: "not_read"; reason: "no_report_read" | "period_running" | "report_before_period_end" | "account_not_listed" };

export function creditRecordsReading(args: {
  bureauReportRead: boolean;
  statuses: readonly CreditAccountStatus[];
  from: IsoDate;
  until: IsoDate | null;
  today: IsoDate;
  /** The dispute's institution and cards (gaps a and b). Required: there is no reading without it. */
  dispute: DisputeAccounts;
}): CreditRecordsReading {
  const end = args.until ?? args.today;
  const inPeriod = (s: CreditAccountStatus) => s.asOf === null || (s.asOf >= args.from && (args.until === null ? s.asOf <= end : s.asOf < end));
  const dispute = args.dispute;
  const relevant = args.statuses.filter((s) => statusBelongsToDispute(s, dispute));
  // Gap c: every status in the period that does not state good standing in words is printed with no outcome.
  const noOutcome = relevant.filter((s) => inPeriod(s) && !showsGoodStanding(s));
  if (noOutcome.length) return { kind: "overdue", statuses: noOutcome };
  if (!args.bureauReportRead) return { kind: "not_read", reason: "no_report_read" };
  if (args.until === null || args.until > args.today) return { kind: "not_read", reason: "period_running" };
  if (!relevant.some((s) => s.source === "credit_bureau_report")) return { kind: "not_read", reason: "account_not_listed" };
  const lastDay = dayBefore(args.until);
  // The report's date is the report's, whatever account a status is about.
  const covered = args.statuses.some((s) => s.source === "credit_bureau_report" && typeof s.reportDate === "string" && s.reportDate >= lastDay);
  return covered ? { kind: "matches" } : { kind: "not_read", reason: "report_before_period_end" };
}

/** The new facts (stages `bank` and `fidrec`), keyed as the facts tables key them. */
export interface UpdateFactValues {
  access_events: AccessEvent[];
  card_auth_events: CardAuthEvent[];
  device_recognition: DeviceRecognition[];
  /** Whether the complainant asked the institution for these records, and the answer. */
  access_record_requested: ReportedEvent;
  /** Whether the complainant asked the institution to dispute the card payments, when, and how. */
  card_dispute_requested: ReportedEvent;
  card_dispute_response: CardDisputeResponse;
  institution_fault_label: InstitutionFaultLabel;
  /** From `bank_statement` only. */
  balance_before_first_disputed_payment: Money;
  /** From an answer or the institution's record. */
  transaction_alert_threshold: TransactionAlertThreshold;
  token_activation_method: TokenActivationMethod;
  /** Decision 8. */
  disputed_amount_payment_requests: DisputedAmountPaymentRequest[];
  /** Decision 8. */
  charges_on_disputed_amount: ChargeOnDisputedAmount[];
  /** Decision 8. */
  credit_bureau_reports: CreditBureauReport[];
  /** Decision 8. */
  fidrec_dispute_dates: FidrecDisputeDates;
  /** The account's status as a credit bureau report or the institution's letter shows it (25 Nov 2026). */
  credit_account_status: CreditAccountStatus[];
}

export type UpdateFactKey = keyof UpdateFactValues;

export const UPDATE_FACT_KEYS = [
  "access_events",
  "card_auth_events",
  "device_recognition",
  "access_record_requested",
  "card_dispute_requested",
  "card_dispute_response",
  "institution_fault_label",
  "balance_before_first_disputed_payment",
  "transaction_alert_threshold",
  "token_activation_method",
  "disputed_amount_payment_requests",
  "charges_on_disputed_amount",
  "credit_bureau_reports",
  "fidrec_dispute_dates",
  "credit_account_status",
] as const satisfies readonly UpdateFactKey[];

export type ContractFactValues = FactValues & UpdateFactValues;
export type ContractFactKey = keyof ContractFactValues;

/** A confirmed fact as a section reads it: the snapshot's value and label, with the value typed. */
export interface ContractFact<T> {
  value: T | null;
  label: FactLabel;
}

export type ContractFacts = { [K in ContractFactKey]?: ContractFact<ContractFactValues[K]> };

/**
 * A disputed payment with what code sets from its type. `excludedFromDrainTest` is the brief's
 * `excluded_from_drain_test` (4a; SRF footnote 8): recurring standing instructions, GIRO/eGIRO deductions, bill
 * payments to billing organisations maintained by the institution, debit card payments, own-account intrabank transfers.
 */
export interface DisputedPayment extends Transaction {
  /** Index into the `transactions` fact. */
  index: number;
  excludedFromDrainTest: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// IP locations (brief 3c): looked up in a database loaded into our own environment, never sent to a third party.
// ---------------------------------------------------------------------------------------------------------------

export const IP_NETWORK_FLAGS = ["hosting", "vpn", "proxy"] as const;
export type IpNetworkFlag = (typeof IP_NETWORK_FLAGS)[number];

export interface IpLocation {
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  accuracyRadiusKm: number | null;
  asn: number | null;
  organisation: string | null;
  /** Only where the database says so. */
  flags: IpNetworkFlag[];
  database: string;
  databaseEdition: IsoDate;
  /** Where the institution's record states a location itself; printed beside the lookup, each attributed. */
  institutionStatedLocation: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Sections (brief 4i) and the comparison form (brief section 4)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The new sections, in the order the pack prints them: after the existing sections, before the arguments. Brief 4i's
 * order, plus `disputed_amount_charges` after `duty_time_checks` (review of 24 Nov 2026, Decision 8; brief v6 will
 * carry it).
 */
export const SECTION_IDS = [
  "access_records",
  "card_authentication_records",
  "ip_locations",
  "account_access_sequence",
  "duty_time_checks",
  "disputed_amount_charges",
  "mas_notice_comparison",
  "industry_practice_comparison",
  "card_dispute_comparison",
  "customer_fault_definitions",
  "customer_conduct_comparison",
  "standards",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The existing report fields the new sections come before ("arguments for each side", 4i). */
export const ARGUMENT_SECTION_IDS = ["arguments_for_claimant", "arguments_for_institution"] as const;

export const COMPARISON_OUTCOMES = ["differs", "matches", "not_shown", "not_applicable"] as const;
export type ComparisonOutcome = (typeof COMPARISON_OUTCOMES)[number];

/**
 * One server-written comparison (Phase 4). The renderer prints Record, Expected, and the ending chosen by `outcome`:
 * differs / matches / not_shown / not_applicable. No field carries verdict wording.
 */
export interface ComparisonLine {
  clauseKey: string;
  record: string;
  expected: string;
  outcome: ComparisonOutcome;
  evidenceIds: string[];
  /**
   * The date the clause was read for (Lane 6, assembly). Lets the renderer give the line the reference number of the
   * version it was compared with when a section cites one clause for several dates. Absent: the section's first
   * citation of the clause.
   */
  onDate?: IsoDate | null;
}

/** A reviewed statement as printed. `text` is null when no revision is approved for the wording in force ("summary under review"). */
export interface StatementLine {
  statementKey: string;
  onDate: IsoDate;
  statementId: string | null;
  revision: number | null;
  text: string | null;
  clauseKeys: string[];
  evidenceIds: string[];
  /**
   * Decision 6: set to the document's own date when the statement rests on a document read whatever the event date
   * (`as_of_rule = 'any_date'`, a MAS reply) and that date is after the events in the case. The renderer then adds the
   * "after the events" line (`afterTheEventsLine` in section-writer.ts). Absent or null otherwise.
   */
  documentDatedAfterEvents?: IsoDate | null;
}

// ---------------------------------------------------------------------------------------------------------------
// The conduct section (4g) after Decision 1 (review of 24 Nov 2026): no `matches`, no `differs`, no ComparisonLine.
// For each kind of conduct and each document it prints what the record shows (text lines) and, separately, whether
// the document refers to that kind of conduct. Nothing joins the two.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The seven topic markers and the topic each prints (Decision 1, verbatim). The topic is a neutral name for the kind of
 * conduct, not a description of what this complainant did.
 */
export const CONDUCT_TOPICS = {
  credentials_entered: "entering credentials, card details or a code on a website or app",
  credentials_given: "giving credentials, card details or a code to another person",
  app_installed: "apps installed on the device",
  card_payment_approved: "authenticating a card payment",
  alerts_and_report: "notifications and alerts from the institution",
  block_used: "blocking access",
  police_report: "reporting to the police",
} as const;
export type ConductMarker = keyof typeof CONDUCT_TOPICS;
export const CONDUCT_MARKERS = Object.keys(CONDUCT_TOPICS) as ConductMarker[];

/**
 * The four conduct lines (Decision 1), printed by the renderer as:
 * - `refers_to`: "[Document] refers to [topic] in [clause reference] (R#)."
 * - `does_not_refer_to`: "[Document] does not refer to [topic]."
 * - `no_conduct_test`: "[Document] has no test of the account user's conduct." (the SRF Guidelines)
 * - `records_do_not_show`: "The records provided do not show [X]."
 * The section never pairs a record line with a "refers to" line, and never passes through the comparison endings.
 */
export const CONDUCT_LINE_KINDS = ["refers_to", "does_not_refer_to", "no_conduct_test", "records_do_not_show"] as const;
export type ConductLineKind = (typeof CONDUCT_LINE_KINDS)[number];

export type ConductLine =
  | { kind: "refers_to"; marker: ConductMarker; documentKey: string; clauseKey: string; onDate: IsoDate }
  | { kind: "does_not_refer_to"; marker: ConductMarker; documentKey: string; clauseKey: null; onDate: IsoDate }
  | { kind: "no_conduct_test"; marker: null; documentKey: string; clauseKey: null; onDate: IsoDate }
  /** `notShown` is the [X], chosen by code from the marker. */
  | { kind: "records_do_not_show"; marker: ConductMarker; documentKey: null; clauseKey: null; notShown: string; onDate: IsoDate };

// ---------------------------------------------------------------------------------------------------------------
// "The 12 hours after the digital token was activated" (Decision 4): at the top of `duty_time_checks`, one block per
// token activation (and per new-device login for an account issued by a payment service provider). In every case,
// card-only included. No outcome, no link statement, and no "high-risk" in the pack's own words.
// ---------------------------------------------------------------------------------------------------------------

/** Headings, verbatim from Decision 4. */
export const TWELVE_HOUR_BLOCK_HEADINGS = {
  block: "The 12 hours after the digital token was activated",
  named: "Activities the definitions name",
  other: "Other activities the record shows in the 12 hours",
} as const;

export const TWELVE_HOUR_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Group 1: the activities the SRF and EUPG definitions name. */
export const TWELVE_HOUR_NAMED_KINDS = [
  "payee_added",
  "limit_changed",
  "notifications_disabled",
  "contact_details_changed",
] as const satisfies readonly AccessEventKind[];

/** The institution's own messages: never listed as activities (they stay in the sequence and alert rows). */
export const TWELVE_HOUR_EXCLUDED_KINDS = ["otp_sent", "alert_sent"] as const satisfies readonly AccessEventKind[];

/** An activity in the block: an access-record line, a card added to a wallet, or a card payment. */
export interface TwelveHourActivity {
  at: IsoDateTime;
  /** Time from the activation, in milliseconds (printed with `formatGap`). */
  sinceActivationMs: number;
  source:
    | { fact: "access_events"; index: number; kind: AccessEventKind }
    | { fact: "card_auth_events"; index: number; kind: "wallet_provisioned" | "card_payment" };
  deviceLabel: string | null;
  deviceRef: string | null;
  evidenceIds: string[];
}

export interface TwelveHourBlock {
  trigger: "token_activated" | "new_device_login";
  activation: {
    at: IsoDateTime;
    /** Index into `access_events`. */
    index: number;
    deviceLabel: string | null;
    deviceRef: string | null;
    tokenRef: string | null;
    evidenceIds: string[];
  };
  /** Group 1, in time order. */
  named: TwelveHourActivity[];
  /** Group 2, in time order. */
  other: TwelveHourActivity[];
  /**
   * The documents, as reviewed statements: `srf.highrisk.definition` and `eupg.highrisk.definition` in every case;
   * `eupg.section4.cards` where there are card payments.
   */
  statements: StatementLine[];
  /** True when the record shows a card added to a wallet: the block points to the wallet check (Decision 5). */
  walletCheckPointer: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// A quoted document (Decision 5, Part B): a document's own words printed word for word, with its date, clause
// reference and link, and no outcome. For MAS written replies and other `any_date` documents.
// ---------------------------------------------------------------------------------------------------------------

export interface QuotedPassage {
  clauseKey: string;
  clauseRef: string | null;
  /** The clause text exactly as the provider returns it; never wording written in code. */
  text: string;
}

export interface QuotationLine {
  documentKey: string;
  /** The document's own date (its version's effective_from), always printed. */
  documentDate: IsoDate;
  /** The date the clauses were read for (the generation date for an `any_date` document). */
  readOn: IsoDate;
  /** The reviewed statement that introduces the quotation (e.g. `mas.reply.20260113.wallet`), or null. */
  intro: StatementLine | null;
  /** The passages held, in the order asked. A quotation with no passage held is not printed (the run is flagged). */
  passages: QuotedPassage[];
  sourceUrl: string | null;
  /** Decision 6: set when the document is dated after the events in the case (the after-the-events line follows). */
  documentDatedAfterEvents: IsoDate | null;
  evidenceIds: string[];
}

/**
 * Line kinds that carry no comparison outcome (review fix list, items 1, 4, 5): the conduct section's lines, the
 * 12-hour block and quoted documents; and the account status a credit bureau report shows (25 Nov 2026). None of them
 * may pass through the comparison endings.
 */
export const NO_OUTCOME_LINE_KINDS = ["conduct", "twelve_hours", "quotation", "account_status"] as const;
export type NoOutcomeLineKind = (typeof NO_OUTCOME_LINE_KINDS)[number];

export type SectionLine =
  | { kind: "comparison"; comparison: ComparisonLine }
  | { kind: "statement"; statement: StatementLine }
  /** Decision 1: the conduct section's own lines. */
  | { kind: "conduct"; conduct: ConductLine; evidenceIds: string[] }
  /** Decision 4: one block per activation. */
  | { kind: "twelve_hours"; block: TwelveHourBlock }
  /** Decision 5, Part B: a document quoted word for word, with no outcome. */
  | { kind: "quotation"; quotation: QuotationLine }
  /**
   * 25 Nov 2026: one account status a credit bureau report (or the institution's letter) shows, printed beside EUPG 8.3
   * and 8.4 with no outcome (CREDIT_RECORDS_RULE). `clauseKey` is the row it stands beside.
   */
  | { kind: "account_status"; status: CreditAccountStatus; clauseKey: string; evidenceIds: string[] }
  /** A fixed line chosen by code, or a numbered step of the sequence (4f). */
  | { kind: "text"; text: string; step: number | null; evidenceIds: string[]; clauseKeys: string[] }
  /** A table row: access records, card authentication records, IP locations. */
  | { kind: "record"; fields: Record<string, string | null>; evidenceIds: string[] };

/** What a report pins for each clause it cited (3.2 rule 4): re-opening the report prints the same text. */
export interface ClauseCitation {
  clauseKey: string;
  onDate: IsoDate;
  clauseId: string;
  textSha256: string;
  versionId: string;
  versionLabel: string;
  /** What the renderer prints beside the reference number (Lane 6, assembly). Set by SectionWriter.cite. */
  clauseRef?: string | null;
  documentKey?: string;
  documentTitle?: string;
  /** The version's effective_from. */
  effectiveFrom?: IsoDate;
  sourceUrl?: string | null;
}

/**
 * `nearest_version_held`: the version in force on the date is not held and the section printed from the nearest
 * version held (brief 3.2 rule 6; review Decision 12), with the fallback line.
 */
export const SECTION_FLAG_CODES = ["statement_under_review", "clause_not_held", "nearest_version_held"] as const;
export type SectionFlagCode = (typeof SECTION_FLAG_CODES)[number];

/** A run-level flag: the section printed a fallback because the corpus had no verified text for the date. */
export interface SectionFlag {
  code: SectionFlagCode;
  key: string;
  onDate: IsoDate;
}

/** The case as a known institution (standard_institutions.code), for the institution's own terms. */
export interface CaseInstitution extends Institution {
  code: string | null;
}

export interface SectionInput {
  facts: ContractFacts;
  payments: DisputedPayment[];
  institution: CaseInstitution | null;
  instruments: Instrument[];
  ipLocations: IpLocation[];
  /** The evidence IDs (E1…) of the documents behind each fact, from the pack's evidence index. */
  evidenceIds: { [K in ContractFactKey]?: string[] };
  provider: ClauseProvider;
  /**
   * The day the pack is generated (YYYY-MM-DD, Singapore date). Documents read whatever the event date (`as_of_rule =
   * 'any_date'`, Decision 6) are read as of this day. Replaces the builders' own `generatedOn` options (Lane 6).
   */
  generatedOn: IsoDate;
}

/** An empty `lines` means the section prints nothing (a stub, or nothing in the records to compare). */
export interface SectionResult {
  sectionId: SectionId;
  lines: SectionLine[];
  citations: ClauseCitation[];
  flags: SectionFlag[];
}

/** One per pack section. Async because the provider reads the corpus. */
export type SectionBuilder = (input: SectionInput) => Promise<SectionResult>;

// ---------------------------------------------------------------------------------------------------------------
// Clause provider: the only way pack code reads clause text (3.2 rule 9). Mirrors the database's as-of functions
// (supabase/migrations/20261201120000_standards_corpus.sql, 20261202120000_standards_review_links.sql).
// ---------------------------------------------------------------------------------------------------------------

export const AS_OF_FUNCTIONS = {
  getClauseAsOf: "get_clause_as_of_v1",
  getClausesByTag: "get_clauses_by_tag_v1",
  getStatementAsOf: "get_statement_as_of_v1",
} as const;

export const CORPUS_INSTRUMENTS = ["account_transfer", "sg_card", "ewallet"] as const;
export type CorpusInstrument = (typeof CORPUS_INSTRUMENTS)[number];

/**
 * `published_page` (review of 24 Nov 2026, Decision 7; Lane 1, #68): an institution's published web page, such as its
 * page on adding cards to mobile wallets. Never printed as a contract. The database CHECK gains it in Lane 1's migration.
 */
export const BINDING_LEVELS = [
  "guideline",
  "notice",
  "circular",
  "industry_code",
  "announcement",
  "contract",
  "scheme_rule",
  "forum_rules",
  "published_page",
] as const;
export type BindingLevel = (typeof BINDING_LEVELS)[number];

/**
 * Which date a document is read for (review of 24 Nov 2026, Decision 6), as a marker on `standard_documents`:
 * - `event_date` (the default): guidelines, notices, circulars, codes, institutions' terms and published pages, scheme
 *   rules, FIDReC's rules, and announced measures. The version in force on the date of the event.
 * - `any_date`: MAS written replies and other official clarifications only. Printed whatever the date of the event,
 *   always with the document's own date, read as of the day the pack is generated (`readDateFor`). Applies to
 *   `mas.reply.20250107` and `mas.reply.20260113`.
 * The database column is Lane 1's (a new migration, Elena's OK first); until then the fake provider carries it.
 */
export const AS_OF_RULES = ["event_date", "any_date"] as const;
export type AsOfRule = (typeof AS_OF_RULES)[number];

/** The date to read a document for: the event date, or the generation date for an `any_date` document. */
export function readDateFor(rule: AsOfRule, eventDate: IsoDate, generatedOn: IsoDate): IsoDate {
  return rule === "any_date" ? generatedOn : eventDate;
}

/**
 * Decision 6: the document's own date when it is after every event in the case, else null. The value for
 * `StatementLine.documentDatedAfterEvents`. `eventDates` are the case's event dates (payments, reports, replies).
 */
export function documentDatedAfterEvents(documentDate: IsoDate, eventDates: ReadonlyArray<IsoDate | null>): IsoDate | null {
  const known = eventDates.filter((d): d is IsoDate => typeof d === "string" && d.length >= 10).map((d) => d.slice(0, 10));
  if (!known.length) return null;
  const last = known.sort()[known.length - 1];
  return documentDate > last ? documentDate : null;
}

export const AS_OF_RULE_OUTCOMES = ["held", "not_held", "held_after_the_events"] as const;
export type AsOfRuleOutcome = (typeof AS_OF_RULE_OUTCOMES)[number];

/**
 * One row of the shared as-of rule table (tests/fixtures/fidrec-update/as-of-rule-cases.json). The fake provider's
 * test and Lane 1's SQL test both run every row, so the rule is defined by one set of cases.
 */
export interface AsOfRuleCase {
  id: string;
  standsFor: string;
  documentKey: string;
  clauseKey: string;
  asOfRule: AsOfRule;
  /** The version's effective_from (for a reply, the reply's date). */
  documentDate: IsoDate;
  /** effective_from_override, or null when the clause starts with its document. */
  clauseStart: IsoDate | null;
  eventDate: IsoDate;
  generatedOn: IsoDate;
  expected: AsOfRuleOutcome;
}

/**
 * Decision 6 in one read: the document's as-of rule picks the date, the clause is read as of it, and a clause from an
 * `any_date` document dated after the event comes back as `held_after_the_events`.
 */
export async function readUnderAsOfRule(
  provider: ClauseProvider,
  documentKey: string,
  clauseKey: string,
  eventDate: IsoDate,
  generatedOn: IsoDate,
): Promise<{ outcome: AsOfRuleOutcome; clause: ClauseAsOf | null; readOn: IsoDate }> {
  const rule = await provider.getAsOfRule(documentKey);
  const readOn = readDateFor(rule, eventDate, generatedOn);
  const clause = await provider.getClauseAsOf(clauseKey, readOn);
  if (!clause) return { outcome: "not_held", clause: null, readOn };
  const after = rule === "any_date" && documentDatedAfterEvents(clause.effective_from, [eventDate]) !== null;
  return { outcome: after ? "held_after_the_events" : "held", clause, readOn };
}

export const STATEMENT_FRAMEWORKS = ["eupg", "srf", "abs_card_code", "mas_reply", "scheme", "institution_terms"] as const;
export type StatementFramework = (typeof STATEMENT_FRAMEWORKS)[number];

/** Tags given to contract clauses at ingestion (brief section 2). */
export const CLAUSE_TAGS = [
  "definition_gross_negligence",
  "definition_negligence",
  "definition_recklessness",
  "customer_security_duty",
  "liability_unauthorised",
  "notification_deadline",
  "dispute_chargeback",
  "conclusive_evidence",
  "bank_may_block",
] as const;
export type ClauseTag = (typeof CLAUSE_TAGS)[number];

/** A row of get_clause_as_of_v1 / get_clauses_by_tag_v1, columns as the database names them. */
export interface ClauseAsOf {
  clause_id: string;
  clause_key: string;
  clause_ref: string | null;
  heading_path: string[];
  text_content: string;
  text_sha256: string;
  tags: string[];
  version_id: string;
  version_label: string;
  effective_from: IsoDate;
  effective_to: IsoDate | null;
  document_key: string;
  title: string;
  publisher: string;
  binding_level: BindingLevel;
  institution: string | null;
  card_scheme: "visa" | "mastercard" | null;
  source_url: string | null;
  coverage: "full" | "selected_sections";
  instrument_scope: CorpusInstrument[];
}

/** A row of get_statement_as_of_v1. */
export interface StatementAsOf {
  statement_id: string;
  statement_key: string;
  revision: number;
  framework: StatementFramework;
  applies_to_instrument: CorpusInstrument[];
  text: string;
  clause_keys: string[];
  clauses_as_of: IsoDate;
  approved_by: string;
  approved_at: string;
}

/**
 * As-of reads. A clause is in force on a date when its version is verified, the clause's start
 * (effective_from_override, else the version's effective_from) is on or before the date, and the version's
 * effective_to is after it (exclusive). A statement prints only in a revision approved against the clause wording
 * in force on the date.
 */
export interface ClauseProvider {
  /** get_clause_as_of_v1(p_clause_key, p_on_date). Null when no verified version holds the clause on that date. */
  getClauseAsOf(clauseKey: string, onDate: IsoDate): Promise<ClauseAsOf | null>;
  /** get_clauses_by_tag_v1(p_tag, p_institution, p_on_date): another institution's contract is never returned. */
  getClausesByTag(tag: ClauseTag, institution: string | null, onDate: IsoDate): Promise<ClauseAsOf[]>;
  /** get_statement_as_of_v1(p_statement_key, p_on_date). */
  getStatementAsOf(statementKey: string, onDate: IsoDate): Promise<StatementAsOf | null>;
  /**
   * The "nearest version held" read (brief 3.2 rule 6; review Decision 12). The clause from the version in force on the
   * date when one is held (`relation: 'in_force'`); otherwise the clause from the verified version nearest the date,
   * before or after it, with `relation` saying which. Null when no verified version holds the clause at all. A section
   * that prints a non-`in_force` result prints the fallback line first (`NEAREST_VERSION_FALLBACK` in section-writer.ts)
   * and raises a `nearest_version_held` flag; it never presents that version as the one that applied.
   * Database side: a new function (proposed name in PROPOSED_AS_OF_FUNCTIONS), Lane 1, migration needs Elena's OK.
   */
  getNearestClause(clauseKey: string, onDate: IsoDate): Promise<NearestClause | null>;
  /** The document's as-of rule (Decision 6); `event_date` when the document is not held or carries no marker. */
  getAsOfRule(documentKey: string): Promise<AsOfRule>;
}

export const NEAREST_CLAUSE_RELATIONS = ["in_force", "earlier_version", "later_version"] as const;
export type NearestClauseRelation = (typeof NEAREST_CLAUSE_RELATIONS)[number];

export interface NearestClause {
  clause: ClauseAsOf;
  relation: NearestClauseRelation;
  /** The date asked for. */
  onDate: IsoDate;
}

/**
 * Database functions for the two newer reads: `get_document_as_of_rule_v1` is Lane 1's (20261204120000);
 * `get_clause_nearest_v1` is Lane 6's (20261205120000_standards_clause_nearest.sql; Elena's approval at merge).
 */
export const PROPOSED_AS_OF_FUNCTIONS = {
  getNearestClause: "get_clause_nearest_v1",
  getAsOfRule: "get_document_as_of_rule_v1",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Keys: the clauses the rules cite, and the statements the sections print
// ---------------------------------------------------------------------------------------------------------------

/**
 * Clause keys cited by the server-written comparisons, per section, as the brief names the paragraphs (4a, 4b, 4g,
 * Phase 7). Format: document_key/paragraph (standard_clauses.clause_key). Sections that print only statements
 * (4d, 4f) cite through the statements' own clause_keys. Not yet listed, because the brief leaves them to be located
 * at ingestion: the MAS–ABS releases of 2022 (4c token-activation checks). Lane 6 adds them when Lane 1 has loaded them.
 *
 * Step 0b (review of 24 Nov 2026): keys renamed or added to match what Lanes 1 and 5 loaded. Cite the definitions in
 * 2.1 by their own clause (`…/2.1(high-risk-activities)`), not the 2.1 chapeau (Lane 1, #44).
 */
export const NAMED_CLAUSE_KEYS = {
  srfHighRiskDefinition: "mas.srf/2.1(high-risk-activities)",
  eupgHighRiskDefinition: "mas.eupg/2.1(high-risk-activities)",
  /** FSM-N05's customer-information paragraph (Lane 1). */
  fsmN05CustomerInformation: "mas.fsm-n05/9",
  /** ABS media statement of 17 Feb 2025 (Lane 1). */
  absProvisioningVerification: "abs.media_2025_02_card_provisioning/para4.verification",
  absProvisioningRemoval: "abs.media_2025_02_card_provisioning/para4.removal",
  /** MAS reply of 7 Jan 2025, the 3-D Secure sentence (Lane 1). Not `mas.reply_20250107/3ds`. */
  masReply3ds: "mas.reply.20250107/3(a).3ds",
  /** Mastercard Chargeback Guide 4837 (Lane 5). Not `…/no_cardholder_authorization`. */
  mastercardIssuerChargeback: "mastercard.chargeback_guide/dms.4837.issuer-chargeback",
  mastercardIneligible: "mastercard.chargeback_guide/dms.4837.ineligible",
} as const;

export const CLAUSE_KEYS = {
  duty_time_checks: [
    // Cooling-off
    NAMED_CLAUSE_KEYS.srfHighRiskDefinition,
    NAMED_CLAUSE_KEYS.eupgHighRiskDefinition,
    "mas.srf/4.2.1",
    "mas.srf/fn5",
    "mas.eupg/4.7",
    // Alerts: token, new device, high-risk activity
    "mas.srf/4.2.2",
    "mas.eupg/4.9",
    // Alerts: outgoing payments
    "mas.srf/4.2.3",
    "mas.srf/fn7",
    "mas.eupg/4.10",
    "mas.eupg/4.11",
    "mas.eupg/4.12",
    // Reporting channel and self-service block
    "mas.srf/4.2.4",
    "mas.srf/4.3",
    "mas.eupg/4.14",
    "mas.eupg/4.15",
    "mas.eupg/4.16",
    // Fraud surveillance
    "mas.srf/4.2.5",
    "mas.srf/fn8",
    "mas.srf/4.4",
    "mas.eupg/4.21",
    // Investigation time
    "mas.srf/7.9",
    "mas.eupg/4.26",
    // Written outcome
    "mas.srf/7.10",
    "mas.eupg/7.7",
    // Information on enquiry
    "mas.srf/7.5",
    "mas.eupg/4.25",
    // Account holder's reporting time
    "mas.srf/7.3",
    "mas.eupg/3.14",
  ],
  // Decision 8: EUPG Section 8 (from 16 June 2025). 8.3 and 8.4 for credit cards and other unsecured credit only.
  disputed_amount_charges: [
    "mas.eupg/8.1",
    "mas.eupg/8.2",
    "mas.eupg/8.3",
    "mas.eupg/8.4",
    "mas.eupg/8.5",
    "mas.eupg/fn26",
    "mas.eupg/fn27",
  ],
  mas_notice_comparison: [
    // Technology-risk notice for non-bank card licensees, customer-information clause (FSM-N07 not loaded yet).
    "mas.fsm-n07/9",
    // Technology-risk notice for banks, customer-information clause. Appended, so existing indexes stay as they were.
    NAMED_CLAUSE_KEYS.fsmN05CustomerInformation,
  ],
  industry_practice_comparison: [
    NAMED_CLAUSE_KEYS.absProvisioningVerification,
    NAMED_CLAUSE_KEYS.absProvisioningRemoval,
  ],
  card_dispute_comparison: [
    "visa.core_rules/11.2.2",
    "visa.core_rules/11.3.2",
    "visa.core_rules/11.8.4",
    "visa.core_rules/11.8.5",
    NAMED_CLAUSE_KEYS.mastercardIssuerChargeback,
    NAMED_CLAUSE_KEYS.mastercardIneligible,
  ],
  customer_conduct_comparison: [
    "mas.eupg/5.2",
    "mas.eupg/fn20",
    "mas.srf/3.1",
    "abs.card_code/5",
    "abs.card_code/6",
    // `card_payment_approved`, "refers to" line only where the complainant recognises the device (Decision 1).
    NAMED_CLAUSE_KEYS.masReply3ds,
  ],
} as const satisfies { readonly [K in SectionId]?: readonly string[] };

export type RuleClauseKey = (typeof CLAUSE_KEYS)[keyof typeof CLAUSE_KEYS][number];

export const RULE_CLAUSE_KEYS: readonly RuleClauseKey[] = [...new Set(Object.values(CLAUSE_KEYS).flat())] as RuleClauseKey[];

/** Statement keys (definition_statements.statement_key): 4d seeds, 4a statements, link statements, Phase 7 seeds. */
export const STATEMENT_KEYS = {
  eupg: [
    "eupg.fault.term",
    "eupg.fault.examples",
    "eupg.fault.level1",
    "eupg.fault.level2",
    "eupg.fault.institution",
    "eupg.fault.reasons",
    "eupg.fault.cards",
    // Decision 9 (review of 24 Nov 2026)
    "eupg.highrisk.definition",
    "eupg.section4.cards",
    "eupg.section8.charges",
    "eupg.section8.credit_records",
    "eupg.section8.outofscope",
  ],
  srf: [
    "srf.fault.terms",
    "srf.fault.userduties",
    "srf.fault.allocation",
    "srf.fault.section6",
    "srf.fidrec.scope",
    "srf.fault.cards",
    "srf.newdevice.bank",
    // Decision 9
    "srf.highrisk.definition",
  ],
  abs: ["abs.fault.term", "abs.fault.undefined", "abs.fault.finder", "abs.fault.effect", "abs.fault.status"],
  mas_reply: [
    "mas.reply.20250107.3ds",
    "mas.reply.20250107.no3ds",
    // Decision 9 (wallet check, Part B)
    "mas.reply.20260113.wallet",
  ],
  link: [
    "link.srf_4_2",
    "link.eupg_s4",
    "bridge.mas_requirement",
    // Decision 9
    "bridge.mas_requirement.cards",
    "bridge.card_loss_sharing",
  ],
  visa: [
    "visa.parties",
    "visa.resolve",
    "visa.dispute.permitted",
    "visa.report",
    "visa.3ds.authenticated",
    "visa.3ds.attempted",
    "visa.token.authenticated",
    "visa.no3ds",
    "visa.cardholder",
  ],
  mastercard: ["mc.dispute.permitted", "mc.report", "mc.authenticated", "mc.pin", "mc.cardholder"],
} as const;

export type StatementKey = (typeof STATEMENT_KEYS)[keyof typeof STATEMENT_KEYS][number];

export const ALL_STATEMENT_KEYS: readonly StatementKey[] = Object.values(STATEMENT_KEYS).flat() as StatementKey[];

/**
 * The statement keys agreed in the review of 24 Nov 2026 (Decision 9), which brief v5 does not name. Wording is
 * Elena's to confirm; Lane 1 drafts the seeds and checks them against the loaded text. `srf.highrisk.definition` and
 * `eupg.highrisk.definition` replace Lane 3's proposed `srf.highrisk.wallet` and `eupg.highrisk.wallet`.
 */
export const DECIDED_STATEMENT_KEYS_2026_11_24 = [
  "srf.highrisk.definition",
  "eupg.highrisk.definition",
  "eupg.section4.cards",
  "mas.reply.20260113.wallet",
  "eupg.section8.charges",
  "eupg.section8.credit_records",
  "eupg.section8.outofscope",
  "bridge.mas_requirement.cards",
  "bridge.card_loss_sharing",
] as const satisfies readonly StatementKey[];

// ---------------------------------------------------------------------------------------------------------------
// Term requests: what the person records on a `wallet_provisioning` row (Decision 5, Part A)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The term-request purpose for an institution's published page on adding its cards to mobile wallets (Decision 5;
 * the page is a versioned institution document, Decision 7).
 */
export const WALLET_PROVISIONING_PURPOSE = "wallet_provisioning" as const;

/**
 * Every term-request purpose, named once (`institution_term_requests.purpose`). The first six are those of the
 * corpus migration's CHECK (20261201120000) and Lane 4's `TERM_PURPOSES` today; `wallet_provisioning` is new
 * (Decision 5). Lane 4's list should become this constant, Lane 1's migration check should list exactly these, and
 * Lane 5's seed rows use only these.
 */
export const TERM_REQUEST_PURPOSES = [
  "fault_definition",
  "customer_security_duty",
  "liability_unauthorised",
  "notification_deadline",
  "dispute_chargeback",
  "conclusive_evidence",
  WALLET_PROVISIONING_PURPOSE,
] as const;
export type TermRequestPurpose = (typeof TERM_REQUEST_PURPOSES)[number];

/**
 * What the page states, recorded by a person on the request row. The wallet check compares the record with it; one
 * institution's page is never set against another institution.
 */
export interface WalletProvisioningPractice {
  /** The waiting period after the digital token is set up, in hours; "none_stated" when the page states none. */
  waitingPeriodHours: number | "none_stated";
  /** The authentication the page says is required to add a card; "none_stated" when it states none. */
  authenticationRequired: WalletProvisioningAuthentication | "none_stated";
  /** The date from which the page says this applies (for example "From 1 July 2025"); null when the page gives none. */
  appliesFrom: IsoDate | null;
}

// ---------------------------------------------------------------------------------------------------------------
// In-memory provider for tests. Same rules as the SQL functions; no database needed.
// ---------------------------------------------------------------------------------------------------------------

export type CorpusVersionStatus = "draft" | "verified" | "withdrawn";
export type StatementStatus = "draft" | "approved" | "retired";

export interface FakeCorpusClause {
  clause_id: string;
  clause_key: string;
  clause_ref?: string | null;
  heading_path?: string[];
  text_content: string;
  /** Given, not computed, so the fake needs no hashing library. */
  text_sha256: string;
  tags?: string[];
  effective_from_override?: IsoDate | null;
  /** Narrower than the document's scope; null or absent means the document's. */
  instrument_scope?: CorpusInstrument[] | null;
}

export interface FakeCorpusVersion {
  version_id: string;
  document_key: string;
  title: string;
  publisher: string;
  binding_level: BindingLevel;
  institution: string | null;
  card_scheme: "visa" | "mastercard" | null;
  /** standard_documents.instrument_scope */
  document_instrument_scope: CorpusInstrument[];
  version_label: string;
  effective_from: IsoDate | null;
  effective_to: IsoDate | null;
  status: CorpusVersionStatus;
  source_url: string | null;
  coverage: "full" | "selected_sections";
  /** standard_documents.as_of_rule (Decision 6); absent means `event_date`. */
  as_of_rule?: AsOfRule;
  clauses: FakeCorpusClause[];
}

export interface FakeStatement {
  statement_id: string;
  statement_key: string;
  revision: number;
  framework: StatementFramework;
  applies_to_instrument: CorpusInstrument[];
  text: string;
  clause_keys: string[];
  status: StatementStatus;
  clauses_as_of: IsoDate | null;
  approved_by: string | null;
  approved_at: string | null;
  /** definition_statement_clauses: each clause wording (by hash) the statement was checked against. */
  checked_wording: Array<{ clause_key: string; text_sha256: string }>;
}

export interface FakeCorpus {
  versions: FakeCorpusVersion[];
  statements: FakeStatement[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(onDate: IsoDate): void {
  if (!ISO_DATE.test(onDate)) throw new Error(`fake clause provider: not a date: ${onDate}`);
}

function clauseRow(v: FakeCorpusVersion, c: FakeCorpusClause): ClauseAsOf {
  return {
    clause_id: c.clause_id,
    clause_key: c.clause_key,
    clause_ref: c.clause_ref ?? null,
    heading_path: c.heading_path ?? [],
    text_content: c.text_content,
    text_sha256: c.text_sha256,
    tags: c.tags ?? [],
    version_id: v.version_id,
    version_label: v.version_label,
    effective_from: v.effective_from as IsoDate,
    effective_to: v.effective_to,
    document_key: v.document_key,
    title: v.title,
    publisher: v.publisher,
    binding_level: v.binding_level,
    institution: v.institution,
    card_scheme: v.card_scheme,
    source_url: v.source_url,
    coverage: v.coverage,
    instrument_scope: c.instrument_scope ?? v.document_instrument_scope,
  };
}

function clausesInForce(corpus: FakeCorpus, onDate: IsoDate): ClauseAsOf[] {
  const rows: ClauseAsOf[] = [];
  for (const v of corpus.versions) {
    if (v.status !== "verified") continue;
    if (v.effective_to !== null && !(v.effective_to > onDate)) continue;
    for (const c of v.clauses) {
      const start = c.effective_from_override ?? v.effective_from;
      if (start === null || !(start <= onDate)) continue;
      rows.push(clauseRow(v, c));
    }
  }
  return rows;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (d: IsoDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS;

/**
 * Nearest verified version holding the clause, when none is in force on the date. Distance in days from the date to
 * the clause's period [start, effective_to). On a tie the earlier version wins.
 */
function nearestClause(corpus: FakeCorpus, clauseKey: string, onDate: IsoDate): NearestClause | null {
  const inForce = clauseAsOf(corpus, clauseKey, onDate);
  if (inForce) return { clause: inForce, relation: "in_force", onDate };
  let best: { row: ClauseAsOf; distance: number; relation: NearestClauseRelation } | null = null;
  for (const v of corpus.versions) {
    if (v.status !== "verified") continue;
    for (const c of v.clauses) {
      if (c.clause_key !== clauseKey) continue;
      const start = c.effective_from_override ?? v.effective_from;
      if (start === null) continue;
      const relation: NearestClauseRelation = onDate < start ? "later_version" : "earlier_version";
      const distance = relation === "later_version"
        ? dayNumber(start) - dayNumber(onDate)
        : dayNumber(onDate) - dayNumber(v.effective_to as IsoDate) + 1;
      const better = !best || distance < best.distance ||
        (distance === best.distance && relation === "earlier_version" && best.relation === "later_version");
      if (better) best = { row: clauseRow(v, c), distance, relation };
    }
  }
  return best ? { clause: best.row, relation: best.relation, onDate } : null;
}

function clauseAsOf(corpus: FakeCorpus, clauseKey: string, onDate: IsoDate): ClauseAsOf | null {
  const rows = clausesInForce(corpus, onDate).filter((r) => r.clause_key === clauseKey);
  // The database allows one current verified version per document, so two rows mean the test corpus is wrong.
  if (rows.length > 1) throw new Error(`fake clause provider: ${clauseKey} is in force in ${rows.length} versions on ${onDate}`);
  return rows[0] ?? null;
}

export function createFakeClauseProvider(corpus: FakeCorpus): ClauseProvider {
  return {
    getClauseAsOf(clauseKey, onDate) {
      requireDate(onDate);
      return Promise.resolve(clauseAsOf(corpus, clauseKey, onDate));
    },
    getClausesByTag(tag, institution, onDate) {
      requireDate(onDate);
      const rows = clausesInForce(corpus, onDate)
        .filter((r) => r.tags.includes(tag) && (r.institution === null || r.institution === institution))
        .sort((a, b) =>
          a.document_key === b.document_key
            ? (a.clause_key < b.clause_key ? -1 : a.clause_key > b.clause_key ? 1 : 0)
            : a.document_key < b.document_key ? -1 : 1
        );
      return Promise.resolve(rows);
    },
    getStatementAsOf(statementKey, onDate) {
      requireDate(onDate);
      const match = corpus.statements
        .filter((s) => s.statement_key === statementKey && s.status === "approved")
        .filter((s) =>
          s.clause_keys.every((key) => {
            const clause = clauseAsOf(corpus, key, onDate);
            return clause !== null &&
              s.checked_wording.some((w) => w.clause_key === key && w.text_sha256 === clause.text_sha256);
          })
        )
        .sort((a, b) => b.revision - a.revision)[0];
      if (!match) return Promise.resolve(null);
      return Promise.resolve({
        statement_id: match.statement_id,
        statement_key: match.statement_key,
        revision: match.revision,
        framework: match.framework,
        applies_to_instrument: match.applies_to_instrument,
        text: match.text,
        clause_keys: match.clause_keys,
        clauses_as_of: match.clauses_as_of as IsoDate,
        approved_by: match.approved_by as string,
        approved_at: match.approved_at as string,
      });
    },
    getNearestClause(clauseKey, onDate) {
      requireDate(onDate);
      return Promise.resolve(nearestClause(corpus, clauseKey, onDate));
    },
    getAsOfRule(documentKey) {
      const v = corpus.versions.find((x) => x.document_key === documentKey && x.as_of_rule !== undefined);
      return Promise.resolve(v?.as_of_rule ?? "event_date");
    },
  };
}
