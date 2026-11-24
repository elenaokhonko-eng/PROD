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
// - 8.4 and 8.5 do not print yet: their periods must be read from the loaded wording of 8.4(b), which Lane 1 confirms
//   first (Decision 8 table). The rows are listed in SECTION_8_ROWS_AWAITING_WORDING.
// - Footnotes 26 and 27 print as a statement (`eupg.section8.outofscope`) wherever the institution's reply says the
//   transaction was authorised. The pack does not say whether the footnote applies.
// - No link statement follows: Section 8 is not a Section 4 duty.
// - The instrument guard (instrument-scope.ts) still reads the EUPG's card scope from paragraph 4.1 only, so it would
//   refuse every Section 8 paragraph for cards. Until Lane 1's scope table is confirmed, this check chooses its payments
//   itself and skips the guard.
//
// Every record sentence here is new wording: // wording awaiting Elena's approval

import type { AccountType } from "../keys.ts";
import {
  type ChargeOnDisputedAmount,
  CLAUSE_KEYS,
  type ComparisonOutcome,
  type CreditBureauReport,
  type DisputedAmountPaymentRequest,
  type DisputedPayment,
  type IsoDate,
  type SectionBuilder,
  type SectionInput,
  type SectionResult,
} from "../update/contract.ts";
import { formatDate, formatMoney } from "../update/section-writer.ts";
import { addCalendarDays, ComparisonWriter, evidenceFor, factValue, type PaymentGroup, paymentsIn } from "./link-statements.ts";

/** EUPG 1.5: Section 8 applies from 16 June 2025 (Lane 1's finding; Decision 8). */
export const SECTION_8_FROM: IsoDate = "2025-06-16";

const [P8_1, P8_2, P8_3, P8_4, P8_5, FN26, FN27] = CLAUSE_KEYS.disputed_amount_charges;
export const SECTION_8_CLAUSES = { p8_1: P8_1, p8_2: P8_2, p8_3: P8_3, p8_4: P8_4, p8_5: P8_5, fn26: FN26, fn27: FN27 } as const;

/** Rows that wait for the loaded wording of 8.4(b) (Decision 8: "Lane 1 confirms the wording of 8.4(b)"). */
export const SECTION_8_ROWS_AWAITING_WORDING = [P8_4, P8_5] as const;

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

function requestWords(items: readonly DisputedAmountPaymentRequest[]): string {
  return items.map((r) => `${formatDate(r.date!)}${r.amount ? ` (${formatMoney(r.amount)})` : ""}`).join(", ");
}

function chargeWords(items: readonly ChargeOnDisputedAmount[]): string {
  return items
    .map((c) => `${formatDate(c.date!)}${c.description ? ` '${c.description}'` : c.kind === "late_fee" ? " late fee" : c.kind === "interest" ? " interest" : ""}${c.amount ? ` ${formatMoney(c.amount)}` : ""}`)
    .join(", ");
}

const reportSource = (r: CreditBureauReport) =>
  r.source === "complainant_statement" ? "the complainant states" : r.source === "institution_letter" ? "the institution's letter" : "the credit bureau report";

function reportWords(items: readonly CreditBureauReport[]): string {
  return items.map((r) => `${formatDate(r.date!)}${r.bureau ? ` to ${r.bureau}` : ""} (${reportSource(r)})`).join(", ");
}

const periodWords = (p: Period) => (p.until ? `from ${formatDate(p.from)} to ${formatDate(p.until)}` : `from ${formatDate(p.from)}`);

/** Requests and charges in a set of periods: the record sentence and the outcome. */
function settlementInPeriods(
  requests: DisputedAmountPaymentRequest[] | null,
  charges: ChargeOnDisputedAmount[] | null,
  periods: readonly Period[],
): { sentences: string[]; outcome: ComparisonOutcome } {
  const inAny = (d: IsoDate | null) => periods.some((p) => within(d, p));
  const req = (requests ?? []).filter((r) => inAny(r.date));
  const chg = (charges ?? []).filter((c) => inAny(c.date));
  const sentences: string[] = [];
  if (req.length) sentences.push(`The records show ${plural(req.length, "request")} to pay the disputed amount in that period: ${requestWords(req)}.`);
  if (chg.length) sentences.push(`The records show ${plural(chg.length, "charge")} on the disputed amount in that period: ${chargeWords(chg)}.`);
  if (req.length || chg.length) return { sentences, outcome: "differs" };
  if (requests === null || charges === null) {
    sentences.push(
      requests === null && charges === null
        ? "The records provided do not show requests to pay the disputed amount or charges on it."
        : requests === null
          ? "The records show no charge on the disputed amount in that period. The records provided do not show requests to pay the disputed amount."
          : "The records show no request to pay the disputed amount in that period. The records provided do not show charges on the disputed amount.",
    );
    return { sentences, outcome: "not_shown" };
  }
  sentences.push("The records show no request to pay the disputed amount and no charge on it in that period.");
  return { sentences, outcome: "matches" };
}

export const buildDisputeChargesChecks: SectionBuilder = async (input: SectionInput): Promise<SectionResult> => {
  const w = new ComparisonWriter("disputed_amount_charges", input);
  const payments = input.payments.filter((p) => p.instrument !== null);
  if (!payments.length) return w.result();
  const group: PaymentGroup = paymentsIn(payments, "account").length ? "account" : "card";
  const credit = creditCardPayments(payments, factValue(input.facts, "account_types") ?? []);
  const base = { group, skipInstrumentGuard: true };

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
    ...(credit.length ? [{ clauseKey: P8_3, payments: credit }] : []),
  ];

  if (report?.value !== "yes" || !report.date) {
    const onDate = [...payments.map((p) => p.date)].filter((d): d is string => Boolean(d)).sort()[0] ?? null;
    for (const r of rows) {
      await w.compare({ ...base, ...r, onDate: onDate && onDate < SECTION_8_FROM ? SECTION_8_FROM : onDate, record: "The records provided do not show when the complainant reported to the institution.", outcome: "not_shown", evidenceIds: ev });
    }
    return w.result();
  }

  const reportedOn = report.date;
  const reported = `The complainant reported to the institution on ${formatDate(reportedOn)}.`;
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
    const { sentences, outcome } = settlementInPeriods(requests, charges, [investigation]);
    await w.compare({ ...base, clauseKey: P8_1, payments, onDate, record: [reported, replyWords, ...sentences].join(" "), outcome, evidenceIds: ev });
  }

  // 8.2: after an assessment the account holder does not agree with: (a) to 30 calendar days after the outcome is
  // given; (b) from when the institution is aware that FIDReC's process has started until it is completed or closed.
  {
    const fidrecEv = evidenceFor(input, "bank_reply", "fidrec_dispute_dates", "disputed_amount_payment_requests", "charges_on_disputed_amount");
    if (!finalReply) {
      await w.compare({ ...base, clauseKey: P8_2, payments, onDate, record: `${reported} ${replyWords}`, outcome: "not_shown", evidenceIds: fidrecEv });
    } else if (finalReply.outcome === "full_offer") {
      await w.compare({ ...base, clauseKey: P8_2, payments, onDate, record: `${replyWords} The reply states an outcome (full offer).`, outcome: "not_applicable", evidenceIds: fidrecEv });
    } else {
      const periodA: Period = { from: finalReply.date!, until: addCalendarDays(finalReply.date!, DAYS_AFTER_OUTCOME + 1) };
      const periods: Period[] = [periodA];
      const parts = [
        `${replyWords}${finalReply.outcome ? ` The reply states an outcome (${finalReply.outcome.replace(/_/g, " ")}).` : ""}`,
        `The period after the reply runs ${periodWords({ from: periodA.from, until: addCalendarDays(finalReply.date!, DAYS_AFTER_OUTCOME) })}.`,
      ];
      const aware = fidrec?.institutionToldOn ?? null;
      if (aware) {
        const periodB: Period = { from: aware, until: fidrec?.completedOrClosedOn ?? null };
        periods.push(periodB);
        parts.push(
          `The records show the institution was told on ${formatDate(aware)} that dispute resolution with FIDReC had started${fidrec?.completedOrClosedOn ? `, and FIDReC's process was completed or closed on ${formatDate(fidrec.completedOrClosedOn)}` : ""}.`,
        );
      } else if (fidrec?.startedOn) {
        parts.push(`The records show dispute resolution with FIDReC started on ${formatDate(fidrec.startedOn)}. They do not show when the institution was told.`);
      } else {
        parts.push("The records provided do not show dispute resolution with FIDReC starting.");
      }
      const { sentences, outcome } = settlementInPeriods(requests, charges, periods);
      await w.compare({ ...base, clauseKey: P8_2, payments, onDate, record: [...parts, ...sentences].join(" "), outcome, evidenceIds: fidrecEv });
    }
  }

  // 8.3: credit cards; credit records not adversely affected until the investigation is completed.
  if (credit.length) {
    const inPeriod = (bureau ?? []).filter((r) => within(r.date, investigation));
    let record: string;
    let outcome: ComparisonOutcome;
    if (inPeriod.length) {
      record = `The records show ${plural(inPeriod.length, "report")} of non-payment of the disputed amount to a credit bureau in that period: ${reportWords(inPeriod)}.`;
      outcome = "differs";
    } else if (bureau === null) {
      record = "The records provided do not show whether non-payment of the disputed amount was reported to a credit bureau.";
      outcome = "not_shown";
    } else {
      record = "The records show no report of non-payment of the disputed amount to a credit bureau in that period.";
      outcome = "matches";
    }
    await w.compare({ ...base, clauseKey: P8_3, payments: credit, onDate, record: `${reported} ${replyWords} ${record}`, outcome, evidenceIds: bureauEv });
  }

  // Footnotes 26 and 27: a statement, wherever the institution's reply says the transaction was authorised.
  if (replySaysAuthorised(input)) {
    await w.statement(SECTION_8_OUT_OF_SCOPE_STATEMENT_KEY, onDate, evidenceFor(input, "bank_reply", "card_dispute_response", "institution_fault_label"));
  }
  return w.result();
};
