// Link statements (FIDReC standards brief v5, 4a "Link statements", decision 20) and the comparison writer the
// server-written comparison sections share (4a duty_time_checks, 4b mas_notice_comparison, 4c
// industry_practice_comparison, and the Section 8 check disputed_amount_charges).
//
// For account payments, after a `differs` line the section prints, once per section, the statement that matches the
// clause compared: `link.srf_4_2` against an SRF 4.2 duty, `link.eupg_s4` against an EUPG Section 4 duty,
// `bridge.mas_requirement` against an MAS notice or another requirement imposed by MAS. For card payments none of the
// three prints. Statements are printed from the corpus through the clause provider; no wording lives here.
//
// Dates, times, gaps, money and the complainant's pronouns come from the shared section writer
// (update/section-writer.ts, Lane 6 Step 0b). `ComparisonWriter` extends its `SectionWriter` with Lane 3's `compare`.
//
// Every line carries a clause key or a statement key. `expected` is the clause text as the provider returns it for the
// date (the corpus's words), never wording written in code. No line says whether a duty was met.

import type { Instrument } from "../keys.ts";
import type {
  AccessEvent,
  CardAuthEvent,
  ComparisonOutcome,
  ContractFactKey,
  ContractFacts,
  ContractFactValues,
  DeviceOwnership,
  DisputedPayment,
  IsoDate,
  IsoDateTime,
  SectionId,
  SectionInput,
} from "../update/contract.ts";
import { SectionWriter } from "../update/section-writer.ts";
import { appliesToInstrument } from "./instrument-scope.ts";

// ---------------------------------------------------------------------------------------------------------------
// Which link statement follows a `differs` line
// ---------------------------------------------------------------------------------------------------------------

export const LINK_STATEMENT_KEYS = {
  srf42: "link.srf_4_2",
  eupgS4: "link.eupg_s4",
  masRequirement: "bridge.mas_requirement",
} as const;

/**
 * The two bridge statements agreed in the review of 24 Nov 2026 (Decision 9). Neither follows a `differs` line.
 * `bridge.mas_requirement.cards` opens the MAS notice section for card payments (4b); `bridge.card_loss_sharing` is a
 * pointer in the wallet check (Decision 5, Part D).
 */
export const BRIDGE_STATEMENT_KEYS = {
  masRequirementCards: "bridge.mas_requirement.cards",
  cardLossSharing: "bridge.card_loss_sharing",
} as const;

/** Documents whose requirements MAS imposes on the institution (layer 2): the notices and the MPI circular. */
export function isMasRequirementDocument(documentKey: string): boolean {
  return /^mas\.(?:fsm-n\d+|notice|circular)/.test(documentKey);
}

/** The link statement for a clause compared, or null where none follows (for example SRF 7.x, EUPG 3.x, 7.x or 8.x). */
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

/**
 * A fact's value when it is confirmed or the complainant's own (as srfFactsFromSnapshot reads them); otherwise null.
 * A fact labelled `not_sure` is not read for a record line; whether it should be is open (PR #56, "Not decided here").
 * Whether a device is the complainant's follows the contract's three-state rule (`deviceOwnership`).
 */
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
// Times and day counts (facts only; no wording about duties). Dates, times and gaps are printed with the shared
// section writer: "3 July 2025", "21:06 on 3 July 2025", "11 hours 59 minutes".
// ---------------------------------------------------------------------------------------------------------------

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

function dayNumber(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / (24 * HOUR);
}

/** Calendar days from one date to a later one: 1 Jul to 31 Jul is 30. */
export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** The date a number of calendar days after another. */
export function addCalendarDays(date: IsoDate, days: number): IsoDate {
  return new Date((dayNumber(date) + days) * 24 * HOUR).toISOString().slice(0, 10);
}

/**
 * Business days after `from` up to and including `to`: Monday to Friday, less the public holidays given (Decision 11:
 * the Singapore list in sg-public-holidays.ts).
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
// The comparison writer: the shared SectionWriter with Lane 3's `compare` (instrument guard and link statements)
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
  /**
   * Skip the Phase 0b instrument guard. Only for EUPG Section 8 (Decision 3: 8.3 and 8.4 cover credit cards), whose
   * card scope instrument-scope.ts does not know until Lane 1's scope table is confirmed. The Section 8 check chooses
   * its payments itself.
   */
  skipInstrumentGuard?: boolean;
}

export class ComparisonWriter extends SectionWriter {
  constructor(sectionId: SectionId, input: Pick<SectionInput, "provider" | "evidenceIds">) {
    super(sectionId, input);
  }

  /** The clause text in force on the date, cited; null (with a `clause_not_held` flag) when no verified version holds it. */
  async clauseText(clauseKey: string, onDate: IsoDate | null): Promise<string | null> {
    if (!onDate) {
      this.flag("clause_not_held", clauseKey, "");
      return null;
    }
    return (await this.clause(clauseKey, onDate))?.text_content ?? null;
  }

  /**
   * One comparison. Returns false, printing nothing, when the instrument guard refuses the clause for these payments.
   * After a `differs` line on account payments, the matching link statement prints once in the section.
   */
  async compare(args: CompareArgs): Promise<boolean> {
    if (!args.payments.length) return false;
    if (!args.skipInstrumentGuard && !clauseAppliesToGroup(args.clauseKey, args.payments)) return false;
    const text = await this.clauseText(args.clauseKey, args.onDate);
    this.comparison({ clauseKey: args.clauseKey, record: args.record, expected: text ?? "", outcome: args.outcome, evidenceIds: args.evidenceIds, onDate: args.onDate });
    const [link] = linkStatementsFor([{ clauseKey: args.clauseKey, outcome: args.outcome, group: args.group }]);
    if (link) await this.statementOn(link, args.onDate, args.evidenceIds);
    return true;
  }

  /**
   * A comparison that rests on whether the device is the complainant's (contract `deviceOwnership`; the shared
   * `comparisonOnDevice`): it prints only when the state is the one required. On `not_shown` the section's "The
   * records do not show …" line prints instead; on the opposite state nothing prints. Same guard and link statements as
   * `compare`. Returns whether the comparison printed.
   */
  async compareOnDevice(args: CompareArgs & { ownership: DeviceOwnership; requires: "mine" | "not_mine"; notShownLine: string }): Promise<boolean> {
    if (!args.payments.length) return false;
    if (!args.skipInstrumentGuard && !clauseAppliesToGroup(args.clauseKey, args.payments)) return false;
    if (args.ownership !== args.requires && args.ownership !== "not_shown") return false;
    const text = args.ownership === args.requires ? await this.clauseText(args.clauseKey, args.onDate) : null;
    const printed = this.comparisonOnDevice({
      ownership: args.ownership,
      requires: args.requires,
      comparison: { clauseKey: args.clauseKey, record: args.record, expected: text ?? "", outcome: args.outcome, evidenceIds: args.evidenceIds, onDate: args.onDate },
      notShownLine: args.notShownLine,
    });
    if (printed) {
      const [link] = linkStatementsFor([{ clauseKey: args.clauseKey, outcome: args.outcome, group: args.group }]);
      if (link) await this.statementOn(link, args.onDate, args.evidenceIds);
    }
    return printed;
  }

  /** A reviewed statement once per section, read for the date. With no date it prints as under review. */
  async statementOn(statementKey: string, onDate: IsoDate | null, evidenceIds: string[] = []): Promise<boolean> {
    if (onDate) return this.statement(statementKey, onDate, evidenceIds);
    if (this.undatedStatements.has(statementKey)) return false;
    this.undatedStatements.add(statementKey);
    this.flag("statement_under_review", statementKey, "");
    this.lines.push({ kind: "statement", statement: { statementKey, onDate: "", statementId: null, revision: null, text: null, clauseKeys: [], evidenceIds } });
    return false;
  }

  private readonly undatedStatements = new Set<string>();
}
