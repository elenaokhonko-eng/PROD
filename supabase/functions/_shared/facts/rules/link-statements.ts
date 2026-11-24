// Link statements (FIDReC standards brief v5, 4a "Link statements", decision 20) and the section writer the
// server-written comparison sections share (4a duty_time_checks, 4b mas_notice_comparison, 4c
// industry_practice_comparison).
//
// For account payments, after a `differs` line the section prints, once per section, the statement that matches the
// clause compared: `link.srf_4_2` against an SRF 4.2 duty, `link.eupg_s4` against an EUPG Section 4 duty,
// `bridge.mas_requirement` against an MAS notice or another requirement imposed by MAS. For card payments none of the
// three prints. Statements are printed from the corpus through the clause provider; no wording lives here.
//
// Every line carries a clause key or a statement key. `expected` is the clause text as the provider returns it for the
// date (the corpus's words), never wording written in code. No line says whether a duty was met.

import type { Instrument } from "../keys.ts";
import type {
  AccessEvent,
  CardAuthEvent,
  ClauseCitation,
  ClauseProvider,
  ComparisonOutcome,
  ContractFactKey,
  ContractFacts,
  ContractFactValues,
  DisputedPayment,
  IsoDate,
  IsoDateTime,
  SectionFlag,
  SectionId,
  SectionInput,
  SectionLine,
  SectionResult,
} from "../update/contract.ts";
import { appliesToInstrument } from "./instrument-scope.ts";

// ---------------------------------------------------------------------------------------------------------------
// Which link statement follows a `differs` line
// ---------------------------------------------------------------------------------------------------------------

export const LINK_STATEMENT_KEYS = {
  srf42: "link.srf_4_2",
  eupgS4: "link.eupg_s4",
  masRequirement: "bridge.mas_requirement",
} as const;

/** Documents whose requirements MAS imposes on the institution (layer 2): the notices and the MPI circular. */
export function isMasRequirementDocument(documentKey: string): boolean {
  return /^mas\.(?:fsm-n\d+|notice|circular)/.test(documentKey);
}

/** The link statement for a clause compared, or null where none follows (for example SRF 7.x, EUPG 3.x or 7.x). */
export function linkStatementKeyFor(clauseKey: string): string | null {
  const [documentKey, paragraph = ""] = clauseKey.split("/");
  if (documentKey === "mas.srf" && /^4\.2(?:\.|$)/.test(paragraph)) return LINK_STATEMENT_KEYS.srf42;
  if (documentKey === "mas.eupg" && /^4\.\d+$/.test(paragraph)) return LINK_STATEMENT_KEYS.eupgS4;
  if (isMasRequirementDocument(documentKey)) return LINK_STATEMENT_KEYS.masRequirement;
  return null;
}

/** The statements a set of lines calls for, in the order of the first line that calls each; none for card payments. */
export function linkStatementsFor(lines: ReadonlyArray<{ clauseKey: string; outcome: ComparisonOutcome; group: PaymentGroup }>): string[] {
  const keys: string[] = [];
  for (const line of lines) {
    if (line.outcome !== "differs" || line.group !== "account") continue;
    const key = linkStatementKeyFor(line.clauseKey);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

// ---------------------------------------------------------------------------------------------------------------
// Payment groups and instrument routing (brief 4a "Route by instrument"; Phase 0b)
// ---------------------------------------------------------------------------------------------------------------

/** Account payments (bank transfers and e-wallet payments) and card payments are compared under different rows. */
export type PaymentGroup = "account" | "card";

export function groupOf(instrument: Instrument | null): PaymentGroup | null {
  if (instrument === "account_transfer" || instrument === "ewallet") return "account";
  if (instrument === "sg_card") return "card";
  return null;
}

export function paymentsIn(payments: readonly DisputedPayment[], group: PaymentGroup): DisputedPayment[] {
  return payments.filter((p) => groupOf(p.instrument) === group);
}

/** The guard every comparison passes (Phase 0b): a clause is never set against a payment kind it does not apply to. */
export function clauseAppliesToGroup(clauseKey: string, payments: readonly DisputedPayment[]): boolean {
  const [documentKey, clauseRef = ""] = clauseKey.split("/");
  const instruments = [...new Set(payments.map((p) => p.instrument).filter((i): i is Instrument => Boolean(i)))];
  return instruments.every((instrument) => appliesToInstrument({ document_key: documentKey, clause_ref: clauseRef }, instrument));
}

// ---------------------------------------------------------------------------------------------------------------
// Reading facts
// ---------------------------------------------------------------------------------------------------------------

/** A fact's value when it is confirmed or the complainant's own (as srfFactsFromSnapshot reads them); otherwise null. */
export function factValue<K extends ContractFactKey>(facts: ContractFacts, key: K): ContractFactValues[K] | null {
  const fact = facts[key];
  if (!fact || fact.value === null || fact.value === undefined) return null;
  return fact.label === "confirmed" || fact.label === "claimant_only" ? (fact.value as ContractFactValues[K]) : null;
}

export function evidenceFor(input: Pick<SectionInput, "evidenceIds">, ...keys: ContractFactKey[]): string[] {
  const ids = keys.flatMap((k) => input.evidenceIds[k] ?? []);
  return [...new Set(ids)].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// ---------------------------------------------------------------------------------------------------------------
// Times and dates (facts only; no wording about duties)
// ---------------------------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function ms(timestamp: IsoDateTime | null | undefined): number | null {
  if (!timestamp) return null;
  const t = Date.parse(timestamp);
  return Number.isNaN(t) ? null : t;
}

/** The calendar date as the record states it (the part before "T"), so the institution's own offset is kept. */
export function localDate(timestamp: IsoDateTime): IsoDate {
  return timestamp.slice(0, 10);
}

export function formatDate(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "21:06 on 3 Jul 2025", in the time zone the record gives. */
export function formatTime(timestamp: IsoDateTime): string {
  const time = timestamp.slice(11, 16);
  return time ? `${time} on ${formatDate(localDate(timestamp))}` : formatDate(localDate(timestamp));
}

/** "11 h 59 min", "3 days 2 h 0 min". */
export function formatDuration(milliseconds: number): string {
  const minutes = Math.round(milliseconds / MINUTE);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const rest = minutes % 60;
  const time = `${hours} h ${rest} min`;
  return days ? `${days} day${days === 1 ? "" : "s"} ${time}` : time;
}

function dayNumber(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / (24 * HOUR);
}

/** Calendar days from one date to a later one: 1 Jul to 31 Jul is 30. */
export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

/**
 * Business days after `from` up to and including `to`: Monday to Friday, less the public holidays given. The brief does
 * not name a holiday list; the builder takes one as an option (none by default), and the record line says which applied.
 */
export function businessDaysBetween(from: IsoDate, to: IsoDate, holidays: ReadonlySet<IsoDate> = new Set()): number {
  let count = 0;
  for (let day = dayNumber(from) + 1; day <= dayNumber(to); day++) {
    const date = new Date(day * 24 * HOUR);
    const weekday = date.getUTCDay();
    const iso = date.toISOString().slice(0, 10);
    if (weekday !== 0 && weekday !== 6 && !holidays.has(iso)) count++;
  }
  return count;
}

export function earliestDate(dates: ReadonlyArray<string | null | undefined>): IsoDate | null {
  const known = dates.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10));
  return known.length ? known.sort()[0] : null;
}

/** The time of a disputed payment as the institution's records give it: access record first, then card record. */
export function paymentTime(
  payment: DisputedPayment,
  access: readonly AccessEvent[],
  cards: readonly CardAuthEvent[],
): IsoDateTime | null {
  const fromAccess = access.find((e) => e.kind === "payment_authenticated" && e.relatedTransactionIndex === payment.index && e.timestamp);
  if (fromAccess?.timestamp) return fromAccess.timestamp;
  const fromCard = cards.find((e) => e.transactionIndex === payment.index && e.timestamp);
  return fromCard?.timestamp ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Section writer: comparisons, statements and fixed lines, with pinned citations and run flags
// ---------------------------------------------------------------------------------------------------------------

export interface CompareArgs {
  clauseKey: string;
  /** The date whose version is read: the payment date for 4a and 4b, the event date for 4c. */
  onDate: IsoDate | null;
  record: string;
  outcome: ComparisonOutcome;
  evidenceIds: string[];
  /** The payments the line is about; the instrument guard runs against them and link statements follow account lines. */
  group: PaymentGroup;
  payments: readonly DisputedPayment[];
}

export class SectionWriter {
  readonly lines: SectionLine[] = [];
  readonly citations: ClauseCitation[] = [];
  readonly flags: SectionFlag[] = [];
  private readonly statementsPrinted = new Set<string>();

  constructor(readonly sectionId: SectionId, readonly provider: ClauseProvider) {}

  private flag(code: SectionFlag["code"], key: string, onDate: IsoDate | null): void {
    const date = onDate ?? "";
    if (!this.flags.some((f) => f.code === code && f.key === key && f.onDate === date)) this.flags.push({ code, key, onDate: date });
  }

  /** Reads the clause in force on the date and pins it; null (with a flag) when no verified version holds it. */
  async clauseText(clauseKey: string, onDate: IsoDate | null): Promise<string | null> {
    const clause = onDate ? await this.provider.getClauseAsOf(clauseKey, onDate) : null;
    if (!clause || !onDate) {
      this.flag("clause_not_held", clauseKey, onDate);
      return null;
    }
    if (!this.citations.some((c) => c.clauseKey === clauseKey && c.onDate === onDate)) {
      this.citations.push({
        clauseKey,
        onDate,
        clauseId: clause.clause_id,
        textSha256: clause.text_sha256,
        versionId: clause.version_id,
        versionLabel: clause.version_label,
      });
    }
    return clause.text_content;
  }

  /**
   * One comparison. Returns false, printing nothing, when the instrument guard refuses the clause for these payments.
   * After a `differs` line on account payments, the matching link statement prints once in the section.
   */
  async compare(args: CompareArgs): Promise<boolean> {
    if (!args.payments.length || !clauseAppliesToGroup(args.clauseKey, args.payments)) return false;
    const text = await this.clauseText(args.clauseKey, args.onDate);
    this.lines.push({
      kind: "comparison",
      comparison: {
        clauseKey: args.clauseKey,
        record: args.record,
        expected: text ?? "",
        outcome: args.outcome,
        evidenceIds: args.evidenceIds,
      },
    });
    const [link] = linkStatementsFor([{ clauseKey: args.clauseKey, outcome: args.outcome, group: args.group }]);
    if (link) await this.statement(link, args.onDate, args.evidenceIds);
    return true;
  }

  /** A reviewed statement, once per section. Text is null and the run is flagged when no approved revision fits the date. */
  async statement(statementKey: string, onDate: IsoDate | null, evidenceIds: string[] = []): Promise<void> {
    if (this.statementsPrinted.has(statementKey)) return;
    this.statementsPrinted.add(statementKey);
    const row = onDate ? await this.provider.getStatementAsOf(statementKey, onDate) : null;
    if (!row) this.flag("statement_under_review", statementKey, onDate);
    this.lines.push({
      kind: "statement",
      statement: {
        statementKey,
        onDate: onDate ?? "",
        statementId: row?.statement_id ?? null,
        revision: row?.revision ?? null,
        text: row?.text ?? null,
        clauseKeys: row?.clause_keys ?? [],
        evidenceIds,
      },
    });
  }

  /** A fixed line of facts chosen by code (dates, times, labels from the record); never wording about a duty. */
  text(text: string, evidenceIds: string[], clauseKeys: string[] = []): void {
    this.lines.push({ kind: "text", text, step: null, evidenceIds, clauseKeys });
  }

  result(): SectionResult {
    return { sectionId: this.sectionId, lines: this.lines, citations: this.citations, flags: this.flags };
  }
}
