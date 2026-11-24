// EUPG Section 8: charges and credit records while a transaction is disputed (review of 24 Nov 2026, Decision 8).
// Section `disputed_amount_charges`, printed after `duty_time_checks`.
//
// One row per paragraph, in the usual form: Record, Expected (the paragraph's text from the provider) and `differs` /
// `matches` / `not_shown` / `not_applicable`. Each request to pay, charge or credit bureau report is placed in its
// period by date.
//
// - Section 8 took effect on 16 June 2025 (EUPG 1.5): a report before that date prints `not_applicable` with the date.
// - 8.3 and 8.4 print only for credit cards (Decision 3). The data model has no payment type for other unsecured credit
//   facilities yet (Lane 1 reports; Elena decides).
// - 8.4(a) is compared like 8.2(a) where the loaded text states its period (the days are read from it). 8.4(b) names no
//   period ("after the completion of mediation and/or adjudication by FIDReC …", Lane 1's reading of 24 Nov 2026), so it
//   prints as a quotation of 8.4 beside a record line, with no outcome. 8.5 is a row only where the record shows a
//   request and a later report outside the periods and before FIDReC's process started; otherwise it is quoted.
// - Footnotes 26 and 27 print as a statement (`eupg.section8.outofscope`) wherever the institution's reply says the
//   transaction was authorised. The pack does not say whether the footnote applies.
// - No link statement follows: Section 8 is not a Section 4 duty.
// - The instrument guard (instrument-scope.ts) still reads the EUPG's card scope from paragraph 4.1 only, so it would
//   refuse every Section 8 paragraph for cards. Until Lane 1's scope table is confirmed, this check chooses its payments
//   itself and skips the guard.
//
// Record wording approved by Elena on 24 Nov 2026 (wording sheet, items S8-1 to S8-25).

import type { AccountType, BankReply } from "../keys.ts";
import {
  type ChargeOnDisputedAmount,
  CLAUSE_KEYS,
  type ComparisonOutcome,
  type CreditAccountStatus,
  type CreditBureauReport,
  CREDIT_BUREAU_REPORT_DOCUMENT_TYPE,
  creditRecordsReading,
  type DisputeAccounts,
  type DisputedAmountPaymentRequest,
  type DisputedPayment,
  type IsoDate,
  type SectionBuilder,
  type SectionInput,
  type SectionResult,
} from "../update/contract.ts";
import { formatCalendarDays, formatDate, formatMoney } from "../update/section-writer.ts";
import { addCalendarDays, calendarDaysBetween, ComparisonWriter, evidenceFor, factValue, type PaymentGroup, paymentsIn } from "./link-statements.ts";

/** EUPG 1.5: Section 8 applies from 16 June 2025 (Lane 1's finding; Decision 8). */
export const SECTION_8_FROM: IsoDate = "2025-06-16";

const [P8_1, P8_2, P8_3, P8_4, P8_5, FN26, FN27] = CLAUSE_KEYS.disputed_amount_charges;
export const SECTION_8_CLAUSES = { p8_1: P8_1, p8_2: P8_2, p8_3: P8_3, p8_4: P8_4, p8_5: P8_5, fn26: FN26, fn27: FN27 } as const;

/** Rows that wait for wording. None since Lane 1 confirmed 8.4(b) (24 Nov 2026). */
export const SECTION_8_ROWS_AWAITING_WORDING: readonly string[] = [];

/** Decision 9 key; printed where the institution's reply says the transaction was authorised. */
export const SECTION_8_OUT_OF_SCOPE_STATEMENT_KEY = "eupg.section8.outofscope";

/** 8.2(a): 30 calendar days after the institution informs the account holder of the outcome. */
const DAYS_AFTER_OUTCOME = 30;

interface Period {
  from: IsoDate;
  /** Exclusive; null while the period is still running. */
  until: IsoDate | null;
}

const within = (date: IsoDate | null, p: Period) => date !== null && date >= p.from && (p.until === null || date < p.until);

/** Credit card payments, as the confirmed account types say (a case naming both a credit and a debit card is not decided). */
export function creditCardPayments(payments: readonly DisputedPayment[], accountTypes: readonly AccountType[]): DisputedPayment[] {
  if (!accountTypes.includes("credit_card") || accountTypes.includes("debit_card")) return [];
  return paymentsIn(payments, "card");
}

/**
 * Whether the institution's reply says the transaction was authorised (its own words, from its letter). No fact holds
 * this yet; the check reads the reason and label the institution stated. Open: a dedicated fact (Lane 2).
 */
export function replySaysAuthorised(input: Pick<SectionInput, "facts">): boolean {
  const words = [
    factValue(input.facts, "card_dispute_response")?.reasonStated,
    factValue(input.facts, "institution_fault_label")?.label,
    factValue(input.facts, "institution_fault_label")?.conduct,
  ].filter((x): x is string => typeof x === "string");
  return words.some((w) => /(?<!un)authori[sz]ed\b/i.test(w));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How the record sentences name the window they are about: one window (8.1, 8.3, 8.4(a)) or several (8.2). */
export type WindowWords = "between those dates" | "in those periods";

function requestWords(items: readonly DisputedAmountPaymentRequest[]): string {
  return items.map((r) => `${formatDate(r.date!)}${r.amount ? ` (${formatMoney(r.amount)})` : ""}`).join(", ");
}

function chargeWords(items: readonly ChargeOnDisputedAmount[]): string {
  return items
    .map((c) => `${formatDate(c.date!)}${c.description ? ` '${c.description}'` : c.kind === "late_fee" ? " late fee" : c.kind === "interest" ? " interest" : ""}${c.amount ? ` ${formatMoney(c.amount)}` : ""}`)
    .join(", ");
}

/** "(source: the credit bureau report)", "(source: the institution's letter)", "(source: the complainant's statement)". */
const reportSource = (r: CreditBureauReport) =>
  `source: ${r.source === "complainant_statement" ? "the complainant's statement" : r.source === "institution_letter" ? "the institution's letter" : "the credit bureau report"}`;

/** "on [date], to [bureau] (source: …)", joined with commas. */
function reportWords(items: readonly CreditBureauReport[]): string {
  return items.map((r) => `on ${formatDate(r.date!)}${r.bureau ? `, to ${r.bureau}` : ""} (${reportSource(r)})`).join("; ");
}

/**
 * 8.4(a)'s period in days, read from the loaded clause: the figure in "up to [n] calendar days after" in the part before
 * "(b)". Null where the text states no such period; 8.4(a) is then treated like 8.4(b) (quoted, no outcome). Any
 * whitespace may separate the words (line breaks and non-breaking spaces from the source included).
 */
export function periodDaysIn84a(text: string): number | null {
  const at = text.search(/\(\s*b\s*\)/);
  const partA = at >= 0 ? text.slice(0, at) : text;
  if (!/\(\s*a\s*\)/.test(partA)) return null;
  const m = /up\s+to\s+(\d{1,3})\s+calendar\s+days?\s+after/i.exec(partA);
  return m ? Number(m[1]) : null;
}

/**
 * The single number of calendar days a clause states (8.5's "[n] calendar days"), or null where it states none or
 * several. Any whitespace may separate the words.
 */
export function calendarDaysStatedIn(text: string): number | null {
  const figures = new Set([...text.matchAll(/\b(\d{1,3})\s+calendar\s+days?\b/gi)].map((m) => Number(m[1])));
  return figures.size === 1 ? [...figures][0] : null;
}

export const REPAYMENT_NOT_SHOWN = "The records provided do not show whether the amount was repaid.";

/** S8-5: one sentence per outcome the reply states. */
const OUTCOME_SENTENCES: Record<NonNullable<BankReply["outcome"]>, string> = {
  rejected: "The reply rejects the claim.",
  partial_offer: "The reply makes a partial offer.",
  full_offer: "The reply makes a full offer.",
  other: "The reply states another outcome.",
};

/** "The institution's final reply is dated [date]." and the outcome sentence. */
function outcomeWords(reply: BankReply): string {
  return `The institution's final reply is dated ${formatDate(reply.date!)}.${reply.outcome ? ` ${OUTCOME_SENTENCES[reply.outcome]}` : ""}`;
}

/** S8-12: "Counted from the date of the final reply, the [n] calendar days run from [date] to [date]." */
function countedWords(replyDate: IsoDate, days: number): string {
  return `Counted from the date of the final reply, the ${formatCalendarDays(days)} run from ${formatDate(replyDate)} to ${formatDate(addCalendarDays(replyDate, days))}.`;
}

/** What the records show of FIDReC's process (8.2(b), 8.4(b), 8.5). */
function fidrecWords(fidrec: { startedOn: IsoDate | null; institutionToldOn: IsoDate | null; completedOrClosedOn: IsoDate | null } | null): string {
  const aware = fidrec?.institutionToldOn ?? null;
  if (aware) {
    return `The records show the institution was told on ${formatDate(aware)} that dispute resolution with FIDReC had started${fidrec?.completedOrClosedOn ? `, and FIDReC's process was completed or closed on ${formatDate(fidrec.completedOrClosedOn)}` : ""}.`;
  }
  if (fidrec?.startedOn) return `The records show dispute resolution with FIDReC started on ${formatDate(fidrec.startedOn)}. They do not show when the institution was told.`;
  return "The records provided do not show dispute resolution with FIDReC starting.";
}

const BUREAU_NOT_SHOWN = "The records provided do not show whether non-payment of the disputed amount was reported to a credit bureau.";

/** How 8.3 and 8.4(a) read the credit records for one period: a row with its outcome, or the account shown overdue. */
type CreditRecordsRow =
  | { kind: "row"; sentence: string; outcome: ComparisonOutcome }
  | { kind: "overdue"; statuses: CreditAccountStatus[] };

/**
 * Credit bureau reports in a period (8.3, 8.4(a)). A report of non-payment of the disputed amount in the period is
 * `differs`. Otherwise the contract's CREDIT_RECORDS_RULE decides (`creditRecordsReading`, Lane 6, 25 Nov 2026):
 * - `matches` ("no report") only where a credit bureau report document was read, the period has ended, a read report is
 *   dated on or after its last day, and no status about the disputed account shows it overdue in the period;
 * - `overdue`: a status about the disputed account (from a bureau report or the institution's letter) shows it overdue
 *   in the period, or with no date. The row then carries no outcome, and each status prints beside it as an
 *   `account_status` line (the account named as the document names it, `accountName`);
 * - `not_read`, whatever its reason (no report read, period still running, report dated before the period ended):
 *   `not_shown`. Statuses about other accounts neither block nor print.
 */
function bureauInPeriod(
  bureau: CreditBureauReport[] | null,
  period: Period,
  window: WindowWords,
  records: { bureauReportRead: boolean; statuses: readonly CreditAccountStatus[]; today: IsoDate; dispute: DisputeAccounts },
): CreditRecordsRow {
  const inPeriod = (bureau ?? []).filter((r) => within(r.date, period));
  if (inPeriod.length) {
    return { kind: "row", sentence: `The records show ${plural(inPeriod.length, "report")} of non-payment of the disputed amount to a credit bureau ${window}: ${reportWords(inPeriod)}.`, outcome: "differs" };
  }
  const reading = creditRecordsReading({ bureauReportRead: records.bureauReportRead, statuses: records.statuses, from: period.from, until: period.until, today: records.today, dispute: records.dispute });
  if (reading.kind === "overdue") return { kind: "overdue", statuses: reading.statuses };
  if (reading.kind === "not_read") return { kind: "row", sentence: BUREAU_NOT_SHOWN, outcome: "not_shown" };
  return { kind: "row", sentence: `The records show no report of non-payment of the disputed amount to a credit bureau ${window}.`, outcome: "matches" };
}

/**
 * The two names a credit bureau report document goes by: evidence_processed_v2's `verified_document_type`
 * ("CREDIT_BUREAU_REPORT", what run_fidrec_pack_v1's documents carry) and the extraction type ("credit_bureau_report").
 * Compared case-insensitively, these two values only.
 */
const CREDIT_BUREAU_REPORT_TYPE_NAMES: ReadonlySet<string> = new Set(["CREDIT_BUREAU_REPORT", CREDIT_BUREAU_REPORT_DOCUMENT_TYPE].map((n) => n.toLowerCase()));

/**
 * The ready documents show a credit bureau report that was read: a document classified as a credit bureau report
 * (either name) with text. What the registry passes as `creditBureauReportRead` (run_fidrec_pack_v1 has the ready
 * documents).
 */
export function creditBureauReportReadFrom(documents: ReadonlyArray<{ evidenceType: string | null; text: string | null }>): boolean {
  return documents.some((d) => d.evidenceType !== null && CREDIT_BUREAU_REPORT_TYPE_NAMES.has(d.evidenceType.toLowerCase()) && Boolean(d.text?.trim()));
}

/** Every credit bureau report the records show, with no period (the record line beside 8.4(b) or a quoted 8.5). */
function bureauWords(bureau: CreditBureauReport[] | null, bureauReportRead: boolean): string {
  const dated = (bureau ?? []).filter((r) => r.date !== null);
  if (dated.length) return `The records show ${plural(dated.length, "report")} of non-payment of the disputed amount to a credit bureau: ${reportWords(dated)}.`;
  if (!bureauReportRead) return BUREAU_NOT_SHOWN;
  return "The records show no report of non-payment of the disputed amount to a credit bureau.";
}

/** Every request to pay the disputed amount the records show, with no period (the record line beside a quoted 8.5). */
function requestListWords(requests: DisputedAmountPaymentRequest[] | null): string {
  const dated = (requests ?? []).filter((r) => r.date !== null);
  if (dated.length) return `The records show ${plural(dated.length, "request")} to pay the disputed amount: ${requestWords(dated)}.`;
  if (requests === null) return "The records provided do not show requests to pay the disputed amount.";
  return "The records show no request to pay the disputed amount.";
}

/** Requests and charges in a set of periods: the record sentence and the outcome. */
function settlementInPeriods(
  requests: DisputedAmountPaymentRequest[] | null,
  charges: ChargeOnDisputedAmount[] | null,
  periods: readonly Period[],
  window: WindowWords,
): { sentences: string[]; outcome: ComparisonOutcome } {
  const inAny = (d: IsoDate | null) => periods.some((p) => within(d, p));
  const req = (requests ?? []).filter((r) => inAny(r.date));
  const chg = (charges ?? []).filter((c) => inAny(c.date));
  const sentences: string[] = [];
  if (req.length) sentences.push(`The records show ${plural(req.length, "request")} to pay the disputed amount ${window}: ${requestWords(req)}.`);
  if (chg.length) sentences.push(`The records show ${plural(chg.length, "charge")} on the disputed amount ${window}: ${chargeWords(chg)}.`);
  if (req.length || chg.length) return { sentences, outcome: "differs" };
  if (requests === null || charges === null) {
    sentences.push(
      requests === null && charges === null
        ? "The records provided do not show requests to pay the disputed amount or charges on it."
        : requests === null
          ? `The records show no charge on the disputed amount ${window}. The records provided do not show requests to pay the disputed amount.`
          : `The records show no request to pay the disputed amount ${window}. The records provided do not show charges on the disputed amount.`,
    );
    return { sentences, outcome: "not_shown" };
  }
  sentences.push(`The records show no request to pay the disputed amount and no charge on it ${window}.`);
  return { sentences, outcome: "matches" };
}

export interface DisputeChargesCheckOptions {
  /**
   * Whether a credit bureau report document (`credit_bureau_report`) is in the case's records and was read. Only then
   * can "no report" print as `matches`. SectionInput does not carry the documents read; the registry passes it from the
   * ready documents (`creditBureauReportReadFrom`, run_fidrec_pack_v1). Default: false (never "no report").
   */
  creditBureauReportRead?: (input: SectionInput) => boolean;
}

export function createDisputeChargesChecks(options: DisputeChargesCheckOptions = {}): SectionBuilder {
  return async (input: SectionInput): Promise<SectionResult> => {
    const w = new ComparisonWriter("disputed_amount_charges", input);
    const payments = input.payments.filter((p) => p.instrument !== null);
    if (!payments.length) return w.result();
    const group: PaymentGroup = paymentsIn(payments, "account").length ? "account" : "card";
    const credit = creditCardPayments(payments, factValue(input.facts, "account_types") ?? []);
    const base = { group, skipInstrumentGuard: true };
    const bureauReportRead = options.creditBureauReportRead?.(input) ?? false;
    const statuses = factValue(input.facts, "credit_account_status") ?? [];
    // The dispute the credit records are read for (review of 25 Nov 2026): the case's institution and the disputed
    // cards' last four digits. Only statuses about that account count; a report must cover the whole period.
    const dispute: DisputeAccounts = {
      institutionName: factValue(input.facts, "institution_names")?.[0]?.name ?? null,
      disputedLast4: [...new Set(paymentsIn(payments, "card").map((p) => p.last4?.replace(/\D/g, "") ?? "").filter((x) => x !== ""))],
    };
    const records = { bureauReportRead, statuses, today: input.generatedOn, dispute };
    /** Each status beside the 8.3 or 8.4 row, with its own document's E-number where the pack has set it. */
    const printStatuses = (list: readonly CreditAccountStatus[], clauseKey: string) => {
      // A status with no `evidenceId` falls back to every document behind the `credit_account_status` fact, so the
      // line may cite more documents than the one it was read from. Lane 6 fills `evidenceId` per status when the
      // pack is built; until then this fallback applies.
      for (const s of list) w.accountStatus(s, clauseKey, s.evidenceId ? [s.evidenceId] : evidenceFor(input, "credit_account_status"));
    };

    const report = factValue(input.facts, "reported_to_bank");
    const reply = factValue(input.facts, "bank_reply");
    const fidrec = factValue(input.facts, "fidrec_dispute_dates");
    const requests = factValue(input.facts, "disputed_amount_payment_requests");
    const charges = factValue(input.facts, "charges_on_disputed_amount");
    const bureau = factValue(input.facts, "credit_bureau_reports");
    const ev = evidenceFor(input, "reported_to_bank", "bank_reply", "disputed_amount_payment_requests", "charges_on_disputed_amount");
    const bureauEv = evidenceFor(input, "reported_to_bank", "bank_reply", "credit_bureau_reports");

    const rows: Array<{ clauseKey: string; payments: readonly DisputedPayment[] }> = [
      { clauseKey: P8_1, payments },
      { clauseKey: P8_2, payments },
      ...(credit.length ? [P8_3, P8_4, P8_5].map((clauseKey) => ({ clauseKey, payments: credit })) : []),
    ];

    if (report?.value !== "yes" || !report.date) {
      const onDate = [...payments.map((p) => p.date)].filter((d): d is string => Boolean(d)).sort()[0] ?? null;
      for (const r of rows) {
        await w.compare({ ...base, ...r, onDate: onDate && onDate < SECTION_8_FROM ? SECTION_8_FROM : onDate, record: "The records provided do not show when the complainant reported the disputed transactions to the institution.", outcome: "not_shown", evidenceIds: ev });
      }
      return w.result();
    }

    const reportedOn = report.date;
    const reported = `The complainant reported the disputed transactions to the institution on ${formatDate(reportedOn)}.`;
    if (reportedOn < SECTION_8_FROM) {
      for (const r of rows) {
        await w.compare({ ...base, ...r, onDate: SECTION_8_FROM, record: reported, outcome: "not_applicable", evidenceIds: evidenceFor(input, "reported_to_bank") });
      }
      return w.result();
    }

    const onDate = reportedOn;
    const finalReply = reply?.status === "final_reply" && reply.date ? reply : null;
    const replyWords = finalReply ? `The institution's final reply is dated ${formatDate(finalReply.date!)}.` : "The records provided do not show a final reply.";
    const investigation: Period = { from: reportedOn, until: finalReply?.date ?? null };

    // 8.1: until the institution completes its investigation.
    {
      const { sentences, outcome } = settlementInPeriods(requests, charges, [investigation], "between those dates");
      await w.compare({ ...base, clauseKey: P8_1, payments, onDate, record: [reported, replyWords, ...sentences].join(" "), outcome, evidenceIds: ev });
    }

    // 8.2: after an assessment the account holder does not agree with: (a) to 30 calendar days after the outcome is
    // given; (b) from when the institution is aware that FIDReC's process has started until it is completed or closed.
    {
      const fidrecEv = evidenceFor(input, "bank_reply", "fidrec_dispute_dates", "disputed_amount_payment_requests", "charges_on_disputed_amount");
      if (!finalReply) {
        await w.compare({ ...base, clauseKey: P8_2, payments, onDate, record: `${reported} ${replyWords}`, outcome: "not_shown", evidenceIds: fidrecEv });
      } else if (finalReply.outcome === "full_offer") {
        await w.compare({ ...base, clauseKey: P8_2, payments, onDate, record: outcomeWords(finalReply), outcome: "not_applicable", evidenceIds: fidrecEv });
      } else {
        const periods: Period[] = [{ from: finalReply.date!, until: addCalendarDays(finalReply.date!, DAYS_AFTER_OUTCOME + 1) }];
        const parts = [outcomeWords(finalReply), countedWords(finalReply.date!, DAYS_AFTER_OUTCOME)];
        const aware = fidrec?.institutionToldOn ?? null;
        if (aware) periods.push({ from: aware, until: fidrec?.completedOrClosedOn ?? null });
        parts.push(fidrecWords(fidrec));
        const { sentences, outcome } = settlementInPeriods(requests, charges, periods, "in those periods");
        await w.compare({ ...base, clauseKey: P8_2, payments, onDate, record: [...parts, ...sentences].join(" "), outcome, evidenceIds: fidrecEv });
      }
    }

    // 8.3: credit cards; credit records not adversely affected until the investigation is completed.
    if (credit.length) {
      const read = bureauInPeriod(bureau, investigation, "between those dates", records);
      if (read.kind === "row") {
        await w.compare({ ...base, clauseKey: P8_3, payments: credit, onDate, record: `${reported} ${replyWords} ${read.sentence}`, outcome: read.outcome, evidenceIds: bureauEv });
      } else {
        // The account shown overdue: the row has no outcome. The record, the statuses beside it, then 8.3 quoted.
        w.text(`${reported} ${replyWords}`, { evidenceIds: bureauEv, clauseKeys: [P8_3] });
        printStatuses(read.statuses, P8_3);
        await w.quotation({ documentKey: "mas.eupg", clauseKeys: [P8_3], eventDate: onDate, generatedOn: onDate, caseEventDates: [], evidenceIds: bureauEv });
      }
    }

    // 8.4 and 8.5: credit cards only, as 8.3.
    if (credit.length) {
      const fullOffer = finalReply?.outcome === "full_offer";
      const disputed = finalReply !== null && !fullOffer;

      // 8.4(a): built like 8.2(a), but only where the loaded text states its period; the number of days is read from it.
      const clause84 = await w.clause(P8_4, onDate);
      const days84a = clause84 ? periodDaysIn84a(clause84.text_content) : null;
      let periodAEnd: IsoDate | null = null;
      let printed84a = false;
      if (!finalReply) {
        await w.compare({ ...base, clauseKey: P8_4, payments: credit, onDate, record: `${reported} ${replyWords}`, outcome: "not_shown", evidenceIds: bureauEv });
      } else if (fullOffer) {
        await w.compare({ ...base, clauseKey: P8_4, payments: credit, onDate, record: outcomeWords(finalReply), outcome: "not_applicable", evidenceIds: bureauEv });
      } else if (days84a !== null) {
        periodAEnd = addCalendarDays(finalReply.date!, days84a);
        const periodA: Period = { from: finalReply.date!, until: addCalendarDays(finalReply.date!, days84a + 1) };
        const read = bureauInPeriod(bureau, periodA, "between those dates", records);
        const opening = [outcomeWords(finalReply), countedWords(finalReply.date!, days84a)];
        if (read.kind === "row") {
          printed84a = await w.compare({ ...base, clauseKey: P8_4, payments: credit, onDate, record: [...opening, read.sentence].join(" "), outcome: read.outcome, evidenceIds: bureauEv });
        } else {
          // The account shown overdue: the row has no outcome. The record and the statuses beside it; paragraph 8.4 is
          // quoted once below, after the 8.4(b) record line.
          w.text(opening.join(" "), { evidenceIds: bureauEv, clauseKeys: [P8_4] });
          printStatuses(read.statuses, P8_4);
        }
      }

      // 8.4(b) names no period ("after the completion of mediation and/or adjudication by FIDReC …"), so nothing is
      // computed and there is no outcome (Elena, 24 Nov 2026: quoted word for word, with the dates). Where the 8.4(a)
      // row printed, paragraph 8.4 is already shown as its Expected, so the 8.4(b) record line sits under it and the
      // paragraph is not quoted again; otherwise the line is followed by the paragraph quoted.
      if (!fullOffer) {
        w.text([fidrecWords(fidrec), bureauWords(bureau, bureauReportRead)].join(" "), { evidenceIds: evidenceFor(input, "fidrec_dispute_dates", "credit_bureau_reports"), clauseKeys: [P8_4] });
        if (!printed84a) await w.quotation({ documentKey: "mas.eupg", clauseKeys: [P8_4], eventDate: onDate, generatedOn: onDate, caseEventDates: [], evidenceIds: bureauEv });
      }

      // 8.5: a row only where the record shows a request and a later report, after the 8.4(a) period and before FIDReC's
      // process started, so that the period does not depend on 8.4(b). The number of days is read from the loaded text.
      const clause85 = await w.clause(P8_5, onDate);
      const days85 = clause85 ? calendarDaysStatedIn(clause85.text_content) : null;
      const fidrecFrom = fidrec?.startedOn ?? fidrec?.institutionToldOn ?? null;
      const requestsKnown = (requests ?? []).filter((r): r is DisputedAmountPaymentRequest & { date: IsoDate } => r.date !== null);
      const resumed = disputed && periodAEnd !== null && days85 !== null && fidrecFrom !== null
        ? (bureau ?? []).filter((r) => r.date !== null && r.date > periodAEnd! && r.date < fidrecFrom && requestsKnown.some((q) => q.date < r.date!))
        : [];
      if (resumed.length) {
        for (const r of resumed) {
          // Measured from the earliest request the records show before the report.
          const request = requestsKnown.filter((q) => q.date < r.date!).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
          const gap = calendarDaysBetween(request.date, r.date!);
          const record =
            `The earliest request to pay the disputed amount in the records is dated ${formatDate(request.date)}. ` +
            `The records show a report of non-payment of the disputed amount to a credit bureau on ${formatDate(r.date!)} (${reportSource(r)}), ${formatCalendarDays(gap)} later. ` +
            REPAYMENT_NOT_SHOWN;
          await w.compare({ ...base, clauseKey: P8_5, payments: credit, onDate, record, outcome: gap < days85! ? "differs" : "not_shown", evidenceIds: evidenceFor(input, "disputed_amount_payment_requests", "credit_bureau_reports") });
        }
      } else if (!fullOffer) {
        w.text([requestListWords(requests), bureauWords(bureau, bureauReportRead), fidrecWords(fidrec)].join(" "), {
          evidenceIds: evidenceFor(input, "disputed_amount_payment_requests", "credit_bureau_reports", "fidrec_dispute_dates"),
          clauseKeys: [P8_5],
        });
        await w.quotation({ documentKey: "mas.eupg", clauseKeys: [P8_5], eventDate: onDate, generatedOn: onDate, caseEventDates: [], evidenceIds: bureauEv });
      }
    }

    // Footnotes 26 and 27: a statement, wherever the institution's reply says the transaction was authorised.
    if (replySaysAuthorised(input)) {
      await w.statement(SECTION_8_OUT_OF_SCOPE_STATEMENT_KEY, onDate, evidenceFor(input, "bank_reply", "card_dispute_response", "institution_fault_label"));
    }
    return w.result();
  };
}

/** Section `disputed_amount_charges`, with no credit bureau report document read (never "no report"). */
export const buildDisputeChargesChecks: SectionBuilder = createDisputeChargesChecks();
