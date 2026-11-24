// The contract between the lanes of the FIDReC pack update (docs/agent-briefs/2026-11-23-agent-lanes-fidrec-update.md,
// Step 0). Shapes and keys come from brief v5 (docs/agent-briefs/2026-11-20-agent-brief-fidrec-technical-records-and-
// standards-corpus.md): Phase 3b (facts), 3c (IP locations), section 4 (the comparison form), 4a-4i (sections),
// 3.2 (as-of reads) and Phase 7 (card scheme statements).
//
// Frozen after Step 0: only Lane 6 changes this file, and it tells every lane when it does.
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type { FactValues, Institution, Instrument, Money, ReportedEvent, Transaction } from "../keys.ts";
import type { FactLabel } from "../snapshot.ts";

/** A calendar date, YYYY-MM-DD (the database's `date`). */
export type IsoDate = string;
/** A time with its offset, for example 2025-07-03T21:05:00+08:00. */
export type IsoDateTime = string;

// ---------------------------------------------------------------------------------------------------------------
// Document types (brief 3a). Only these two can supply or contradict access_events and card_auth_events.
// ---------------------------------------------------------------------------------------------------------------

export const TECHNICAL_RECORD_DOCUMENT_TYPES = ["bank_access_record", "card_authentication_record"] as const;
export type TechnicalRecordDocumentType = (typeof TECHNICAL_RECORD_DOCUMENT_TYPES)[number];

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

/** The new sections, in the order the pack prints them: after the existing sections, before the arguments. */
export const SECTION_IDS = [
  "access_records",
  "card_authentication_records",
  "ip_locations",
  "account_access_sequence",
  "duty_time_checks",
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
}

export type SectionLine =
  | { kind: "comparison"; comparison: ComparisonLine }
  | { kind: "statement"; statement: StatementLine }
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
}

export const SECTION_FLAG_CODES = ["statement_under_review", "clause_not_held"] as const;
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

export const BINDING_LEVELS = [
  "guideline",
  "notice",
  "circular",
  "industry_code",
  "announcement",
  "contract",
  "scheme_rule",
  "forum_rules",
] as const;
export type BindingLevel = (typeof BINDING_LEVELS)[number];

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
}

// ---------------------------------------------------------------------------------------------------------------
// Keys: the clauses the rules cite, and the statements the sections print
// ---------------------------------------------------------------------------------------------------------------

/**
 * Clause keys cited by the server-written comparisons, per section, as the brief names the paragraphs (4a, 4b, 4g,
 * Phase 7). Format: document_key/paragraph (standard_clauses.clause_key). Sections that print only statements
 * (4d, 4f) cite through the statements' own clause_keys. Not yet listed, because the brief leaves them to be located
 * at ingestion: FSM-N05's customer-information paragraph (4b), the MAS–ABS and ABS releases (4c), the Mastercard
 * Chargeback Guide sections (Phase 7). Lane 6 adds them when Lane 1 has loaded them.
 */
export const CLAUSE_KEYS = {
  duty_time_checks: [
    // Cooling-off
    "mas.srf/2.1",
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
  mas_notice_comparison: [
    // Technology-risk notice for non-bank card licensees, customer-information clause.
    "mas.fsm-n07/9",
  ],
  card_dispute_comparison: [
    "visa.core_rules/11.2.2",
    "visa.core_rules/11.3.2",
    "visa.core_rules/11.8.4",
    "visa.core_rules/11.8.5",
  ],
  customer_conduct_comparison: [
    "mas.eupg/5.2",
    "mas.eupg/fn20",
    "mas.srf/3.1",
    "abs.card_code/5",
    "abs.card_code/6",
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
  ],
  srf: [
    "srf.fault.terms",
    "srf.fault.userduties",
    "srf.fault.allocation",
    "srf.fault.section6",
    "srf.fidrec.scope",
    "srf.fault.cards",
    "srf.newdevice.bank",
  ],
  abs: ["abs.fault.term", "abs.fault.undefined", "abs.fault.finder", "abs.fault.effect", "abs.fault.status"],
  mas_reply: ["mas.reply.20250107.3ds", "mas.reply.20250107.no3ds"],
  link: ["link.srf_4_2", "link.eupg_s4", "bridge.mas_requirement"],
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

function clausesInForce(corpus: FakeCorpus, onDate: IsoDate): ClauseAsOf[] {
  const rows: ClauseAsOf[] = [];
  for (const v of corpus.versions) {
    if (v.status !== "verified") continue;
    if (v.effective_to !== null && !(v.effective_to > onDate)) continue;
    for (const c of v.clauses) {
      const start = c.effective_from_override ?? v.effective_from;
      if (start === null || !(start <= onDate)) continue;
      rows.push({
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
      });
    }
  }
  return rows;
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
  };
}
