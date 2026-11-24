// The one section writer the FIDReC update sections share (review of 24 Nov 2026, cross-lane finding 3; Lane 6 Step 0b).
// Lanes 3, 4 and 5 each wrote their own; one pack must print dates, times, money, gaps and the complainant one way.
//
// - Dates: "3 July 2025" (brief examples). Times: "21:14 on 3 July 2025", the clock time as the record states it, with
//   no time-zone conversion (Decision 10: a record time with no zone is Singapore time).
// - Money: the pack's existing format (display.ts `formatMoney`): "S$7,550", "S$49,999.99", "USD 120".
// - Gaps: "22 minutes", "11 hours 59 minutes", "1 day 2 hours", rounded down, never up. Day counts: "1 calendar day",
//   "21 business days".
// - The complainant: "the complainant", "they", "their", "theirs". Never she / her / hers (Decision 2).
// - The standing sentence for card scheme rules, defined once.
// - `SectionWriter`: lines, pinned citations (3.2 rule 4) and run flags, reading clauses and statements only through the
//   ClauseProvider (3.2 rule 9).
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import { formatMoney as formatMoneyPack } from "../display.ts";
import type { Money } from "../keys.ts";
import type {
  ClauseAsOf,
  ClauseCitation,
  CreditAccountStatus,
  ComparisonLine,
  ConductLine,
  DeviceOwnership,
  DeviceRecognitionAnswer,
  IsoDate,
  IsoDateTime,
  NearestClause,
  QuotedPassage,
  SectionFlag,
  SectionFlagCode,
  SectionId,
  SectionInput,
  SectionLine,
  SectionResult,
  StatementLine,
  TwelveHourBlock,
} from "./contract.ts";
import { documentDatedAfterEvents, readUnderAsOfRule } from "./contract.ts";

// ---------------------------------------------------------------------------------------------------------------
// Dates, times, money, gaps
// ---------------------------------------------------------------------------------------------------------------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DATE_PART = /^(\d{4})-(\d{2})-(\d{2})/;

/** The YYYY-MM-DD part of a date or a timestamp as written (no time-zone conversion), or null. */
export function datePart(value: string | null | undefined): IsoDate | null {
  const m = DATE_PART.exec(value ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "3 July 2025" from YYYY-MM-DD or the date part of a timestamp. A value that is not a date is returned as given. */
export function formatDate(value: IsoDate | IsoDateTime): string {
  const m = DATE_PART.exec(value);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return value;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "21:14 on 3 July 2025": the clock time as the record states it. A date with no time prints as the date. */
export function formatDateTime(value: IsoDateTime): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return formatDate(value);
  return `${m[2]}:${m[3]} on ${formatDate(m[1])}`;
}

/** One amount: "S$7,550", "S$49,999.99", "USD 120" (the pack's existing format). */
export function formatMoney(money: Money): string {
  return formatMoneyPack(money);
}

/** Totals per currency in first-seen order, joined with "and": "S$7,550 and USD 120". */
export function formatMoneyTotal(amounts: readonly Money[]): string {
  const totals = new Map<string, number>();
  for (const a of amounts) totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.amount);
  return [...totals.entries()]
    .map(([currency, amount]) => {
      const rounded = Math.round(amount * 100) / 100;
      return formatMoneyPack({ amount: rounded, currency, amountSgd: currency === "SGD" ? rounded : null });
    })
    .join(" and ");
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * A gap between two record times: "40 seconds", "22 minutes", "1 hour", "11 hours 59 minutes", "1 day 2 hours 5
 * minutes". Rounded down to the minute (to the second under a minute), so a gap is never printed longer than it was.
 */
export function formatGap(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);
  if (ms < MINUTE_MS) return unit(Math.floor(ms / 1000), "second");
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  const parts: string[] = [];
  if (days) parts.push(unit(days, "day"));
  if (hours) parts.push(unit(hours, "hour"));
  if (minutes) parts.push(unit(minutes, "minute"));
  return parts.join(" ");
}

/** The gap between two timestamps (later minus earlier), or null when either does not parse. */
export function gapBetween(from: IsoDateTime | null, to: IsoDateTime | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isNaN(a) || Number.isNaN(b) ? null : b - a;
}

/** "1 calendar day", "30 calendar days". */
export function formatCalendarDays(days: number): string {
  return `${days} calendar day${days === 1 ? "" : "s"}`;
}

/** "1 business day", "21 business days". */
export function formatBusinessDays(days: number): string {
  return `${days} business day${days === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The complainant (Decision 2): one neutral form in every server-written line. Screens that speak to the user keep
// "you" and "your".
// ---------------------------------------------------------------------------------------------------------------

export const COMPLAINANT = {
  /** "the complainant" */
  noun: "the complainant",
  /** "The complainant" (sentence start) */
  Noun: "The complainant",
  /** "they" */
  subject: "they",
  /** "them" */
  object: "them",
  /** "their" */
  possessive: "their",
  /** "theirs" */
  possessivePronoun: "theirs",
} as const;

/** Words a server-written line must never contain about the complainant (Decision 2). For tests. */
export const GENDERED_PRONOUNS = /\b(she|her|hers|herself|he|him|his|himself)\b/i;

/**
 * What the complainant states about a device, as they said it (the not-sure rule in contract.ts governs which lines a
 * section chooses, not this sentence). With a label: "the device labelled 'X'"; without: "this device".
 */
export function deviceRecognitionSentence(answer: DeviceRecognitionAnswer | null, deviceLabel: string | null): string {
  const device = deviceLabel ? `the device labelled '${deviceLabel}'` : "this device";
  switch (answer) {
    case "not_mine":
      return `The complainant states that ${device} is not theirs.`;
    case "mine":
      return `The complainant states that ${device} is theirs.`;
    case "not_sure":
      return `The complainant states that they are not sure whether ${device} is theirs.`;
    default:
      return `The complainant has not said whether ${device} is theirs.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Fixed lines defined once
// ---------------------------------------------------------------------------------------------------------------

/** The standing sentence for card scheme rules (brief section 4, layer 5). Printed once per section that shows scheme rules. */
export const SCHEME_STANDING_SENTENCE =
  "Card scheme rules are an agreement between the card scheme and the card issuer. The cardholder is not a party to them. They are shown here as the process available to the issuer.";

/**
 * Decision 1 (verbatim): for card payments approved on a device whose state is not `mine` (contract.ts
 * `deviceOwnership`). No "refers to" line follows it.
 */
export const RECORDS_DO_NOT_SHOW_WHO_APPROVED = "The records do not show who approved these payments.";

// Approved by Elena (SW-1; review of 24 Nov 2026, "Still open" item 1).
/** The fallback where the edition in force on the payment date is not held (brief 3.2 rule 6; Decision 12). */
export const NEAREST_VERSION_FALLBACK = (scheme: string, paymentDate: IsoDate, nearestEditionDate: IsoDate): string =>
  `This pack does not hold ${scheme}'s rules as in force on ${formatDate(paymentDate)}. The nearest edition held is dated ${formatDate(nearestEditionDate)}. The lines below are from that edition.`;

// Approved by Elena (SW-2; review of 24 Nov 2026, Decision 6 and "Still open" item 3).
/** Added after a statement whose `documentDatedAfterEvents` is set. */
export const afterTheEventsLine = (documentDate: IsoDate): string =>
  `This reply is dated ${formatDate(documentDate)}, after the events in this case.`;

// wording awaiting Elena's approval (25 Nov 2026): the account status a document shows, printed beside EUPG 8.3 and
// 8.4 with no outcome (contract CREDIT_RECORDS_RULE). The status is the document's own words, verbatim. Without a
// bureau name: "The credit bureau report shows …"; without a date the "as at" part is left out; a status from the
// institution's letter: "The institution's letter shows the card account as … as at …".
export function creditAccountStatusLine(status: Pick<CreditAccountStatus, "asOf" | "statusText" | "bureau" | "source">): string {
  const asAt = status.asOf ? ` as at ${formatDate(status.asOf)}` : "";
  const who = status.source === "institution_letter"
    ? "The institution's letter"
    : `The credit bureau report${status.bureau ? ` from ${status.bureau}` : ""}`;
  return `${who} shows the card account as ${status.statusText}${asAt}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------------------------------------------

/**
 * Collects a section's lines, the clauses it cited (pinned once per clause and date) and its run flags (once per code,
 * key and date). Clauses and statements are read only through the provider.
 */
export class SectionWriter {
  readonly lines: SectionLine[] = [];
  private readonly citationMap = new Map<string, ClauseCitation>();
  private readonly flagMap = new Map<string, SectionFlag>();
  private readonly printedStatements = new Set<string>();

  constructor(readonly sectionId: SectionId, readonly input: Pick<SectionInput, "provider" | "evidenceIds">) {}

  get citations(): ClauseCitation[] {
    return [...this.citationMap.values()];
  }

  get flags(): SectionFlag[] {
    return [...this.flagMap.values()];
  }

  /** The evidence IDs behind the given facts, de-duplicated, in E-number order. */
  evidence(...keys: Array<keyof SectionInput["evidenceIds"]>): string[] {
    const ids = [...new Set(keys.flatMap((k) => this.input.evidenceIds[k] ?? []))];
    return ids.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)) || (a < b ? -1 : a > b ? 1 : 0));
  }

  flag(code: SectionFlagCode, key: string, onDate: IsoDate): void {
    const id = `${code}|${key}|${onDate}`;
    if (!this.flagMap.has(id)) this.flagMap.set(id, { code, key, onDate });
  }

  cite(clause: ClauseAsOf, onDate: IsoDate): void {
    const id = `${clause.clause_id}@${onDate}`;
    if (this.citationMap.has(id)) return;
    this.citationMap.set(id, {
      clauseKey: clause.clause_key,
      onDate,
      clauseId: clause.clause_id,
      textSha256: clause.text_sha256,
      versionId: clause.version_id,
      versionLabel: clause.version_label,
      clauseRef: clause.clause_ref,
      documentKey: clause.document_key,
      documentTitle: clause.title,
      effectiveFrom: clause.effective_from,
      sourceUrl: clause.source_url,
    });
  }

  /** The clause in force on the date, cited; null and a `clause_not_held` flag when no verified version holds it. */
  async clause(clauseKey: string, onDate: IsoDate): Promise<ClauseAsOf | null> {
    const clause = await this.input.provider.getClauseAsOf(clauseKey, onDate);
    if (clause) this.cite(clause, onDate);
    else this.flag("clause_not_held", clauseKey, onDate);
    return clause;
  }

  /**
   * The clause in force on the date, else the nearest version held (3.2 rule 6). A nearest version is cited for the
   * date asked and raises `nearest_version_held`; the section prints the fallback line before it. Null and a
   * `clause_not_held` flag when no version holds the clause at all.
   */
  async nearestClause(clauseKey: string, onDate: IsoDate): Promise<NearestClause | null> {
    const nearest = await this.input.provider.getNearestClause(clauseKey, onDate);
    if (!nearest) {
      this.flag("clause_not_held", clauseKey, onDate);
      return null;
    }
    this.cite(nearest.clause, onDate);
    if (nearest.relation !== "in_force") this.flag("nearest_version_held", clauseKey, onDate);
    return nearest;
  }

  /**
   * Reads a statement as of the date without printing it; its clauses are cited. With no approved revision for the
   * wording in force, `text` is null and the run is flagged ("summary under review").
   */
  async readStatement(statementKey: string, onDate: IsoDate, evidenceIds: string[] = []): Promise<StatementLine> {
    const row = await this.input.provider.getStatementAsOf(statementKey, onDate);
    if (!row) {
      this.flag("statement_under_review", statementKey, onDate);
      return { statementKey, onDate, statementId: null, revision: null, text: null, clauseKeys: [], evidenceIds };
    }
    for (const key of row.clause_keys) {
      const clause = await this.input.provider.getClauseAsOf(key, onDate);
      if (clause) this.cite(clause, onDate);
    }
    return {
      statementKey,
      onDate,
      statementId: row.statement_id,
      revision: row.revision,
      text: row.text,
      clauseKeys: [...row.clause_keys],
      evidenceIds,
    };
  }

  /**
   * Reads and prints a statement, once per section (a second call with the same key prints nothing and returns false).
   * Returns whether approved wording printed.
   */
  async statement(statementKey: string, onDate: IsoDate, evidenceIds: string[] = [], extra: Pick<StatementLine, "documentDatedAfterEvents"> = {}): Promise<boolean> {
    if (this.printedStatements.has(statementKey)) return false;
    this.printedStatements.add(statementKey);
    const line = await this.readStatement(statementKey, onDate, evidenceIds);
    this.lines.push({ kind: "statement", statement: { ...line, ...extra } });
    return line.text !== null;
  }

  /** A fixed line chosen by code, or a numbered step of the sequence. Never wording about whether a duty was met. */
  text(text: string, opts: { step?: number | null; evidenceIds?: string[]; clauseKeys?: string[] } = {}): void {
    this.lines.push({ kind: "text", text, step: opts.step ?? null, evidenceIds: opts.evidenceIds ?? [], clauseKeys: opts.clauseKeys ?? [] });
  }

  /** A comparison line, already built (Record, Expected from the provider, outcome). Not for the conduct section. */
  comparison(comparison: ComparisonLine): void {
    this.lines.push({ kind: "comparison", comparison });
  }

  /**
   * A comparison that rests on the device being the complainant's (`requires: 'mine'`) or not (`requires: 'not_mine'`).
   * It prints only when the device state is exactly that. With `not_shown` the section's "The records do not show …"
   * line prints instead; with the opposite state the row does not apply and nothing prints. Never a comparison on
   * `not_shown`. Returns whether the comparison printed.
   */
  comparisonOnDevice(args: {
    ownership: DeviceOwnership;
    requires: "mine" | "not_mine";
    comparison: ComparisonLine;
    /** The full "The records do not show …" sentence, chosen by the section. Printed when the state is `not_shown`. */
    notShownLine: string;
  }): boolean {
    if (args.ownership === args.requires) {
      this.comparison(args.comparison);
      return true;
    }
    if (args.ownership === "not_shown") {
      this.text(args.notShownLine, { evidenceIds: args.comparison.evidenceIds, clauseKeys: [args.comparison.clauseKey] });
    }
    return false;
  }

  /** A conduct-section line (Decision 1). */
  conduct(conduct: ConductLine, evidenceIds: string[] = []): void {
    this.lines.push({ kind: "conduct", conduct, evidenceIds });
  }

  /** An account status beside the 8.3 or 8.4 row `clauseKey` (25 Nov 2026; CREDIT_RECORDS_RULE). No outcome. */
  accountStatus(status: CreditAccountStatus, clauseKey: string, evidenceIds: string[] = []): void {
    this.lines.push({ kind: "account_status", status, clauseKey, evidenceIds });
  }

  /** A 12-hour block (Decision 4). */
  twelveHours(block: TwelveHourBlock): void {
    this.lines.push({ kind: "twelve_hours", block });
  }

  /**
   * A document quoted word for word, with no outcome (Decision 5, Part B). Each clause is read under the document's
   * as-of rule (`readUnderAsOfRule`) and cited; a clause not held is flagged and left out. With no clause held nothing
   * prints and it returns false. `caseEventDates` decide whether the document is dated after the events (Decision 6).
   */
  async quotation(args: {
    documentKey: string;
    clauseKeys: string[];
    eventDate: IsoDate;
    generatedOn: IsoDate;
    caseEventDates: ReadonlyArray<IsoDate | null>;
    introStatementKey?: string | null;
    evidenceIds?: string[];
  }): Promise<boolean> {
    const passages: QuotedPassage[] = [];
    let first: { clause: ClauseAsOf; readOn: IsoDate } | null = null;
    for (const key of args.clauseKeys) {
      const r = await readUnderAsOfRule(this.input.provider, args.documentKey, key, args.eventDate, args.generatedOn);
      if (!r.clause) {
        this.flag("clause_not_held", key, r.readOn);
        continue;
      }
      this.cite(r.clause, r.readOn);
      first ??= { clause: r.clause, readOn: r.readOn };
      passages.push({ clauseKey: key, clauseRef: r.clause.clause_ref, text: r.clause.text_content });
    }
    if (!first) return false;
    const rule = await this.input.provider.getAsOfRule(args.documentKey);
    const documentDate = first.clause.effective_from;
    const evidenceIds = args.evidenceIds ?? [];
    this.lines.push({
      kind: "quotation",
      quotation: {
        documentKey: args.documentKey,
        documentDate,
        readOn: first.readOn,
        intro: args.introStatementKey ? await this.readStatement(args.introStatementKey, first.readOn, evidenceIds) : null,
        passages,
        sourceUrl: first.clause.source_url,
        documentDatedAfterEvents: rule === "any_date" ? documentDatedAfterEvents(documentDate, args.caseEventDates) : null,
        evidenceIds,
      },
    });
    return true;
  }

  /** A table row (access records, card authentication records, IP locations). */
  record(fields: Record<string, string | null>, evidenceIds: string[] = []): void {
    this.lines.push({ kind: "record", fields, evidenceIds });
  }

  result(): SectionResult {
    return { sectionId: this.sectionId, lines: this.lines, citations: this.citations, flags: this.flags };
  }
}
