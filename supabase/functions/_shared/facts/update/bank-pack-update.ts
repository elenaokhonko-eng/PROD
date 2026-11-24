// The bank pack's lines from the FIDReC update (Lane 6, assembly), printed only with FIDREC_UPDATE_SECTIONS_ENABLED on:
//
// 1. The request for missing technical records (brief v5, decision 9; acceptance: a case without a card
//    authentication record gets the bank-pack request). When the case has no access record, the pack asks for one;
//    when it has card payments and no card authentication record, it asks for that too.
// 2. What EUPG Section 8 says (review of 24 Nov 2026, Decision 8), for a dispute reported on or after 16 June 2025, as
//    reviewed statements with their paragraph references and link: `eupg.section8.charges` in every such case,
//    `eupg.section8.credit_records` where a disputed payment was made with a credit card, then
//    `eupg.section8.outofscope`. The lines state what the Guidelines say; they say nothing about what the institution
//    has or has not done. A statement with no approved revision for the wording in force is not printed (flagged).
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type { AccountType, ReportedEvent } from "../keys.ts";
import { creditCardPayments, SECTION_8_FROM } from "../rules/dispute-charges-checks.ts";
import type { SnapshotFacts } from "../validate-output.ts";
import type { ClauseCitation, ClauseProvider, IsoDate, SectionFlag } from "./contract.ts";
import { isTechnicalRecordDocument } from "./model-guard.ts";
import { clauseWords } from "./render.ts";
import { disputedPayments } from "./section-input.ts";
import { SectionWriter } from "./section-writer.ts";

// wording awaiting Elena's approval: the bank pack's requests for the institution's technical records (first person,
// as the rest of the bank pack).
export const RECORD_REQUESTS = {
  access:
    "Please give me the bank's record of the logins to my account, the devices used or registered, any digital token activation, the IP addresses recorded, and the alerts and one-time codes sent, around the time of the disputed payments.",
  card:
    "Please give me the bank's record of how each disputed card payment was approved: the authentication used (for example 3-D Secure with a one-time code or a digital token), where any code was sent, the device or token that approved it, and any card added to a mobile wallet.",
} as const;

export const SECTION_8_STATEMENT_KEYS = {
  charges: "eupg.section8.charges",
  creditRecords: "eupg.section8.credit_records",
  outOfScope: "eupg.section8.outofscope",
} as const;

export interface BankPackUpdate {
  /** The requests for missing technical records, in order. */
  requests: string[];
  /** What Section 8 says: each approved statement with its paragraph references and link. */
  section8: Array<{ statementKey: string; text: string; references: string }>;
  /** Pinned (3.2 rule 4): the clauses behind the printed statements, and the statement revisions. */
  citations: ClauseCitation[];
  statements: Array<{ statementKey: string; statementId: string; revision: number; onDate: IsoDate }>;
  flags: SectionFlag[];
  generatedOn: IsoDate;
}

const usable = <T>(facts: SnapshotFacts, key: string): T | null => {
  const fact = facts[key as keyof SnapshotFacts];
  return fact && (fact.label === "confirmed" || fact.label === "claimant_only") ? (fact.value as T) : null;
};

function hasRecord(facts: SnapshotFacts, key: "access_events" | "card_auth_events"): boolean {
  const value = usable<unknown[]>(facts, key);
  return Array.isArray(value) && value.length > 0;
}

export async function buildBankPackUpdate(args: {
  facts: SnapshotFacts;
  /** evidence_processed_v2 types of the case's ready documents (verified_document_type). */
  documentTypes: ReadonlyArray<string | null>;
  provider: ClauseProvider;
  generatedOn: IsoDate;
}): Promise<BankPackUpdate> {
  const { facts } = args;
  const payments = disputedPayments(facts);
  const types = args.documentTypes.filter(isTechnicalRecordDocument);
  const requests: string[] = [];
  if (!hasRecord(facts, "access_events") && !types.includes("RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA")) requests.push(RECORD_REQUESTS.access);
  const cardPayments = payments.filter((p) => p.instrument === "sg_card");
  if (cardPayments.length && !hasRecord(facts, "card_auth_events") && !types.includes("CARD_AUTHENTICATION_RECORD")) {
    requests.push(RECORD_REQUESTS.card);
  }

  const w = new SectionWriter("disputed_amount_charges", { provider: args.provider, evidenceIds: {} });
  const section8: BankPackUpdate["section8"] = [];
  const statements: BankPackUpdate["statements"] = [];
  const reported = usable<ReportedEvent>(facts, "reported_to_bank");
  const reportedOn = reported?.value === "yes" && reported.date ? reported.date.slice(0, 10) : null;
  if (reportedOn && reportedOn >= SECTION_8_FROM && payments.length) {
    const accountTypes = usable<AccountType[]>(facts, "account_types") ?? [];
    const keys: string[] = [SECTION_8_STATEMENT_KEYS.charges];
    if (creditCardPayments(payments, accountTypes).length) keys.push(SECTION_8_STATEMENT_KEYS.creditRecords);
    keys.push(SECTION_8_STATEMENT_KEYS.outOfScope);
    for (const key of keys) {
      const line = await w.readStatement(key, reportedOn);
      if (line.text === null || line.statementId === null || line.revision === null) continue;
      const cited = line.clauseKeys.map((k) => w.citations.find((c) => c.clauseKey === k && c.onDate === reportedOn)).filter((c): c is ClauseCitation => Boolean(c));
      const title = cited[0]?.documentTitle ?? null;
      const refs = cited.map((c) => clauseWords(c.clauseKey, c.clauseRef ?? null));
      const url = cited.find((c) => c.sourceUrl)?.sourceUrl ?? null;
      section8.push({ statementKey: key, text: line.text, references: [refs.join(", "), title, url].filter(Boolean).join("; ") });
      statements.push({ statementKey: key, statementId: line.statementId, revision: line.revision, onDate: reportedOn });
    }
  }
  return { requests, section8, citations: w.citations, statements, flags: w.flags, generatedOn: args.generatedOn };
}

