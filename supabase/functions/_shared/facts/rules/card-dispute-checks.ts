// Card dispute comparison (FIDReC standards brief v5, Phase 7 and decision 5): for each disputed card payment, Visa
// first, the conditions under which the card scheme's rules let the issuer raise a fraud dispute, set beside what the
// records show; then whether the cardholder asked and what the institution said it did.
//
// Facts only (decision 3): no line says the institution should have raised a dispute or that anyone is liable.
// Scheme rules are reference_only (decision 15): this file names sections and conditions in its own words and never
// holds the rules' wording; the scheme's short terms appear only in the reviewed statements it prints (decision 19).
// Clauses are read only through the ClauseProvider, as of the payment date (3.2 rules 2 and 9). A clause not held for
// that date prints "not held" with a clause_not_held flag; a statement without an approved revision for the wording
// in force prints with no text and a statement_under_review flag.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type {
  CardAuthEvent,
  CardScheme,
  ClauseAsOf,
  ClauseCitation,
  ComparisonLine,
  ComparisonOutcome,
  ContractFactKey,
  DisputedPayment,
  IsoDate,
  SectionBuilder,
  SectionFlag,
  SectionInput,
  SectionLine,
  SectionResult,
  StatementKey,
} from "../update/contract.ts";

/** The scheme sections this file cites, by role. Visa keys match CLAUSE_KEYS.card_dispute_comparison. */
export const CARD_DISPUTE_CLAUSE_KEYS = {
  visa: {
    resolve: "visa.core_rules/11.2.2",
    permitted: "visa.core_rules/11.3.2",
    cardPresentKeyEntered: "visa.core_rules/11.8.4",
    cardAbsent: "visa.core_rules/11.8.5",
  },
  mastercard: {
    chargeback: "mastercard.chargeback_guide/dms.4837.issuer-chargeback",
    ineligible: "mastercard.chargeback_guide/dms.4837.ineligible",
  },
} as const;

export const CARD_DISPUTE_RULE_CLAUSE_KEYS: readonly string[] = [
  ...Object.values(CARD_DISPUTE_CLAUSE_KEYS.visa),
  ...Object.values(CARD_DISPUTE_CLAUSE_KEYS.mastercard),
];

/** Calendar days the scheme sections allow for a fraud dispute (Visa 11.8.4/11.8.5; Mastercard 4837). */
export const SCHEME_DISPUTE_DAYS = 120;

/** Layer-5 standing sentence (brief section 4). */
export const SCHEME_STANDING_SENTENCE =
  "Card scheme rules are an agreement between the card scheme and the card issuer. The cardholder is not a party to them. They are shown here as the process available to the issuer.";

type Scheme = "visa" | "mastercard";

const SCHEME_NAME: Record<Scheme, string> = { visa: "Visa", mastercard: "Mastercard" };
const SCHEME_ORDER: CardScheme[] = ["visa", "mastercard", "other", "not_known"];

const AUTH_LABEL: Record<CardAuthEvent["authentication"], string> = {
  three_ds_otp: "3-D Secure with a one-time code",
  three_ds_in_app: "3-D Secure approved in the institution's app",
  three_ds_digital_token: "3-D Secure approved with a digital token",
  wallet_device: "the mobile wallet on the device",
  pin: "PIN",
  none_recorded: "no authentication recorded",
  not_known: "an authentication method the record does not show",
};

const ENTRY_LABEL: Record<CardAuthEvent["entryMode"], string> = {
  chip: "read by chip",
  contactless: "read contactless",
  key_entered: "key-entered",
  ecommerce: "an online (card-absent) payment",
  wallet_token: "made with a mobile wallet token",
  not_known: "made by an entry mode the record does not show",
};

const RESPONSE_DECLINED = new Set(["declined", "no_answer"]);

type Environment = "card_absent" | "card_present_key_entered" | "card_present_read" | "not_shown";

function environmentOf(event: CardAuthEvent | null): Environment {
  switch (event?.entryMode) {
    case "ecommerce":
      return "card_absent";
    case "key_entered":
      return "card_present_key_entered";
    case "chip":
    case "contactless":
      return "card_present_read";
    default:
      // A wallet token can be used in a shop or online; the entry mode alone does not say which.
      return "not_shown";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function dateOf(value: string | null | undefined): IsoDate | null {
  return value && ISO_DATE.test(value) ? value.slice(0, 10) : null;
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). */
export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  const ms = (d: IsoDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

function money(p: DisputedPayment): string {
  const { amount, currency } = p.amount;
  return `${currency} ${amount.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sectionRef(clause: ClauseAsOf): string {
  const ref = clause.clause_ref ?? clause.clause_key.split("/")[1];
  return `${clause.title}, section ${ref}, edition ${clause.version_label}`;
}

/** Collects lines, citations and flags, citing each clause and printing each statement once. */
class SectionWriter {
  readonly lines: SectionLine[] = [];
  private readonly citations = new Map<string, ClauseCitation>();
  private readonly flags = new Map<string, SectionFlag>();
  private readonly printedStatements = new Set<string>();

  constructor(private readonly input: SectionInput) {}

  ev(...keys: ContractFactKey[]): string[] {
    return [...new Set(keys.flatMap((k) => this.input.evidenceIds[k] ?? []))];
  }

  async clause(clauseKey: string, onDate: IsoDate): Promise<ClauseAsOf | null> {
    const row = await this.input.provider.getClauseAsOf(clauseKey, onDate);
    if (row === null) {
      this.flag("clause_not_held", clauseKey, onDate);
      return null;
    }
    const id = `${row.clause_id}@${onDate}`;
    if (!this.citations.has(id)) {
      this.citations.set(id, {
        clauseKey: row.clause_key,
        onDate,
        clauseId: row.clause_id,
        textSha256: row.text_sha256,
        versionId: row.version_id,
        versionLabel: row.version_label,
      });
    }
    return row;
  }

  flag(code: SectionFlag["code"], key: string, onDate: IsoDate): void {
    this.flags.set(`${code}|${key}|${onDate}`, { code, key, onDate });
  }

  text(text: string, evidenceIds: string[] = [], clauseKeys: string[] = []): void {
    this.lines.push({ kind: "text", text, step: null, evidenceIds, clauseKeys });
  }

  compare(clause: ClauseAsOf, record: string, expected: string, outcome: ComparisonOutcome, evidenceIds: string[]): void {
    const comparison: ComparisonLine = { clauseKey: clause.clause_key, record, expected, outcome, evidenceIds };
    this.lines.push({ kind: "comparison", comparison });
  }

  async statement(statementKey: StatementKey, onDate: IsoDate, evidenceIds: string[]): Promise<void> {
    if (this.printedStatements.has(statementKey)) return;
    this.printedStatements.add(statementKey);
    const row = await this.input.provider.getStatementAsOf(statementKey, onDate);
    if (row === null) this.flag("statement_under_review", statementKey, onDate);
    this.lines.push({
      kind: "statement",
      statement: {
        statementKey,
        onDate,
        statementId: row?.statement_id ?? null,
        revision: row?.revision ?? null,
        text: row?.text ?? null,
        clauseKeys: row?.clause_keys ?? [],
        evidenceIds,
      },
    });
  }

  result(): SectionResult {
    return {
      sectionId: "card_dispute_comparison",
      lines: this.lines,
      citations: [...this.citations.values()],
      flags: [...this.flags.values()],
    };
  }
}

interface PaymentRow {
  payment: DisputedPayment;
  event: CardAuthEvent | null;
  onDate: IsoDate | null;
}

/** Per payment: whether every condition about the payment and the cardholder's request is shown on the records. */
interface PaymentOutcome {
  conditionsShown: boolean;
}

function deviceStatement(input: SectionInput, event: CardAuthEvent | null): string | null {
  if (!event?.deviceRef && !event?.deviceLabel) return null;
  const answers = input.facts.device_recognition?.value ?? [];
  const match = answers.find((a) =>
    (event.deviceRef !== null && a.deviceRef === event.deviceRef) ||
    (event.deviceRef === null && event.deviceLabel !== null && a.deviceLabel === event.deviceLabel)
  );
  if (!match) return null;
  const label = event.deviceLabel ? `labelled '${event.deviceLabel}'` : "the record shows";
  if (match.answer === "not_mine") return `The complainant states that the device ${label} is not hers.`;
  if (match.answer === "mine") return `The complainant states that the device ${label} is hers.`;
  return `The complainant states that she is not sure whether the device ${label} is hers.`;
}

/** The request to dispute, else the report to the institution: the date the time limit is measured to. */
function requestDate(input: SectionInput): { date: IsoDate; source: "card_dispute_requested" | "reported_to_bank" } | null {
  const asked = input.facts.card_dispute_requested?.value;
  if (asked?.value === "yes" && dateOf(asked.date)) return { date: dateOf(asked.date)!, source: "card_dispute_requested" };
  const reported = input.facts.reported_to_bank?.value;
  if (reported?.value === "yes" && dateOf(reported.date)) return { date: dateOf(reported.date)!, source: "reported_to_bank" };
  return null;
}

function denialLine(w: SectionWriter, input: SectionInput, row: PaymentRow, clause: ClauseAsOf, condition: string): void {
  const device = deviceStatement(input, row.event);
  const record = [
    `The complainant disputes the payment of ${money(row.payment)} on ${row.payment.date} as not made or authorised by her.`,
    device,
  ].filter(Boolean).join(" ");
  w.compare(
    clause,
    record,
    `Under ${sectionRef(clause)}, ${condition} applies where the cardholder denies authorising or taking part in the payment.`,
    "matches",
    w.ev("transactions", "device_recognition"),
  );
}

function timeLine(w: SectionWriter, input: SectionInput, row: PaymentRow, clause: ClauseAsOf, expected: string): boolean {
  const request = requestDate(input);
  const evidence = w.ev("transactions", request?.source ?? "card_dispute_requested");
  if (!request || !row.onDate) {
    w.compare(clause, "The records provided do not show when the complainant reported the payment or asked for a dispute.", expected, "not_shown", evidence);
    return false;
  }
  const days = calendarDaysBetween(row.onDate, request.date);
  const asked = request.source === "card_dispute_requested" ? "asked the institution to dispute it" : "reported it to the institution";
  const record =
    `The payment is dated ${row.onDate}; the complainant ${asked} on ${request.date}, ${days} calendar days later. ` +
    "The records do not show the date the payment was processed by the scheme; the count runs from the payment date.";
  const within = days >= 0 && days <= SCHEME_DISPUTE_DAYS;
  w.compare(clause, record, expected, within ? "matches" : "differs", evidence);
  return within;
}

function reportedLine(w: SectionWriter, clause: ClauseAsOf, scheme: Scheme): void {
  w.compare(
    clause,
    `The records provided do not show whether the institution reported this payment to ${SCHEME_NAME[scheme]} as fraud.`,
    `Under ${sectionRef(clause)}, the issuer is to report the payment to ${SCHEME_NAME[scheme]} as fraud before raising the dispute.`,
    "not_shown",
    w.ev("card_dispute_response", "bank_reply"),
  );
}

function recordRow(w: SectionWriter, row: PaymentRow): void {
  const e = row.event;
  w.lines.push({
    kind: "record",
    fields: {
      payment_date: row.payment.date,
      amount: money(row.payment),
      merchant: e?.merchant ?? row.payment.payee,
      card_last4: row.payment.last4,
      scheme: e ? (e.cardScheme === "visa" ? "Visa" : e.cardScheme === "mastercard" ? "Mastercard" : null) : null,
      entry_mode: e ? ENTRY_LABEL[e.entryMode] : null,
      authentication: e ? AUTH_LABEL[e.authentication] : null,
      authentication_result: e ? e.authenticationResult : null,
      device: e?.deviceLabel ?? null,
    },
    evidenceIds: w.ev("card_auth_events", "transactions"),
  });
}

async function visaPayment(w: SectionWriter, input: SectionInput, row: PaymentRow, statements: Map<StatementKey, IsoDate>): Promise<PaymentOutcome> {
  const onDate = row.onDate!;
  const env = environmentOf(row.event);
  const authEvidence = w.ev("card_auth_events");
  const k = CARD_DISPUTE_CLAUSE_KEYS.visa;

  if (env === "not_shown") {
    const clause = await w.clause(k.cardAbsent, onDate);
    if (!clause) return { conditionsShown: false };
    const record = row.event
      ? `The record shows the payment was ${ENTRY_LABEL[row.event.entryMode]}. It does not show whether the card was present.`
      : "The records provided do not show how this payment was made.";
    w.compare(
      clause,
      record,
      `Under ${sectionRef(clause)}, Dispute Condition 10.4 covers payments in a card-absent environment; Dispute Condition 10.3 covers key-entered payments in a card-present environment.`,
      "not_shown",
      authEvidence,
    );
    return { conditionsShown: false };
  }

  if (env === "card_present_read") {
    const clause = await w.clause(k.cardPresentKeyEntered, onDate);
    if (!clause) return { conditionsShown: false };
    w.compare(
      clause,
      `The record shows the card was ${ENTRY_LABEL[row.event!.entryMode]}, authenticated by ${AUTH_LABEL[row.event!.authentication]}.`,
      `Under ${sectionRef(clause)}, Dispute Condition 10.3 covers key-entered payments in a card-present environment; Dispute Condition 10.4 covers payments in a card-absent environment.`,
      "not_applicable",
      authEvidence,
    );
    return { conditionsShown: false };
  }

  const cardAbsent = env === "card_absent";
  const condition = cardAbsent ? "Dispute Condition 10.4" : "Dispute Condition 10.3";
  const clause = await w.clause(cardAbsent ? k.cardAbsent : k.cardPresentKeyEntered, onDate);
  if (!clause) return { conditionsShown: false };

  denialLine(w, input, row, clause, condition);
  w.compare(
    clause,
    `The record shows the payment was ${ENTRY_LABEL[row.event!.entryMode]}.`,
    cardAbsent
      ? `Under ${sectionRef(clause)}, ${condition} covers payments in a card-absent environment.`
      : `Under ${sectionRef(clause)}, ${condition} covers key-entered payments in a card-present environment.`,
    "matches",
    authEvidence,
  );

  let shown = true;
  if (cardAbsent) shown = invalidListLine(w, row, clause, statements) && shown;
  shown = timeLine(w, input, row, clause, `Under ${sectionRef(clause)}, the time limit for ${condition} is ${SCHEME_DISPUTE_DAYS} calendar days from the date the payment was processed.`) && shown;
  reportedLine(w, clause, "visa");
  return { conditionsShown: shown };
}

/** Visa 11.8.5, invalid disputes: Visa Secure authentication, attempted authentication, authenticated token payments. */
function invalidListLine(w: SectionWriter, row: PaymentRow, clause: ClauseAsOf, statements: Map<StatementKey, IsoDate>): boolean {
  const e = row.event!;
  const expected =
    `Under ${sectionRef(clause)}, the invalid disputes for Dispute Condition 10.4 include payments authenticated through Visa Secure, ` +
    "payments where Visa Secure authentication was attempted, and payments with an authenticated token where cardholder verification was approved.";
  const evidence = w.ev("card_auth_events");
  const caveat = "The record does not show the electronic commerce indicator or the authentication values sent with the authorisation.";
  const threeDs = e.authentication.startsWith("three_ds_");
  const token = e.authentication === "wallet_device";

  if (e.authentication === "not_known" || (e.authenticationResult === "not_known" && (threeDs || token))) {
    w.compare(clause, "The records provided do not show how this payment was authenticated.", expected, "not_shown", evidence);
    return false;
  }
  if ((threeDs || token) && (e.authenticationResult === "authenticated" || e.authenticationResult === "attempted")) {
    const how = `${AUTH_LABEL[e.authentication]}, result '${e.authenticationResult}'`;
    w.compare(clause, `The record shows the payment authenticated by ${how}. ${caveat}`, expected, "differs", evidence);
    const key: StatementKey = token
      ? "visa.token.authenticated"
      : e.authenticationResult === "attempted" ? "visa.3ds.attempted" : "visa.3ds.authenticated";
    if (!statements.has(key)) statements.set(key, row.onDate!);
    return false;
  }
  const shownAs = e.authentication === "none_recorded" || e.authentication === "pin"
    ? AUTH_LABEL[e.authentication]
    : `${AUTH_LABEL[e.authentication]}, result '${e.authenticationResult}'`;
  w.compare(clause, `The record shows ${shownAs}.`, expected, "matches", evidence);
  if (!statements.has("visa.no3ds")) statements.set("visa.no3ds", row.onDate!);
  return true;
}

async function mastercardPayment(w: SectionWriter, input: SectionInput, row: PaymentRow, statements: Map<StatementKey, IsoDate>): Promise<PaymentOutcome> {
  const onDate = row.onDate!;
  const k = CARD_DISPUTE_CLAUSE_KEYS.mastercard;
  const chargeback = await w.clause(k.chargeback, onDate);
  const ineligible = await w.clause(k.ineligible, onDate);
  if (!chargeback || !ineligible) return { conditionsShown: false };
  const condition = "the 'No Cardholder Authorization' chargeback (message reason code 4837)";

  const asked = requestDate(input);
  w.compare(
    chargeback,
    [
      asked
        ? `The complainant disputes the payment of ${money(row.payment)} on ${row.payment.date} and contacted the institution about it on ${asked.date}.`
        : `The complainant disputes the payment of ${money(row.payment)} on ${row.payment.date}. The records provided do not show when she contacted the institution about it.`,
      deviceStatement(input, row.event),
    ].filter(Boolean).join(" "),
    `Under ${sectionRef(chargeback)}, ${condition} is available where the cardholder contacted the issuer saying the payment was not authorised.`,
    asked ? "matches" : "not_shown",
    w.ev("transactions", "card_dispute_requested", "reported_to_bank", "device_recognition"),
  );

  let shown = asked !== null;
  const e = row.event;
  const expected =
    `Under ${sectionRef(ineligible)}, the payments listed as ineligible for ${condition} include properly authenticated payments ` +
    "(for example through Identity Check or Digital Secure Remote Payment), payments with a PIN or cardholder verification on the device, " +
    "and card-read payments at an attended terminal.";
  const evidence = w.ev("card_auth_events");
  const walletVerified = e?.authentication === "wallet_device" && e.authenticationResult === "authenticated";
  if (!e || e.authentication === "not_known" || (e.entryMode === "not_known" && e.authentication !== "none_recorded")) {
    w.compare(ineligible, "The records provided do not show how this payment was made or authenticated.", expected, "not_shown", evidence);
    shown = false;
  } else if (e.authentication === "pin" || (walletVerified && e.entryMode !== "ecommerce")) {
    w.compare(ineligible, `The record shows the payment was ${ENTRY_LABEL[e.entryMode]}, authenticated by ${AUTH_LABEL[e.authentication]}.`, expected, "differs", evidence);
    if (!statements.has("mc.pin")) statements.set("mc.pin", onDate);
    shown = false;
  } else if (e.entryMode === "chip" || e.entryMode === "contactless") {
    w.compare(
      ineligible,
      `The record shows the card was ${ENTRY_LABEL[e.entryMode]}, with ${AUTH_LABEL[e.authentication]}. The records do not show whether the terminal was attended.`,
      expected,
      "differs",
      evidence,
    );
    if (!statements.has("mc.pin")) statements.set("mc.pin", onDate);
    shown = false;
  } else if ((e.authentication.startsWith("three_ds_") && e.authenticationResult === "authenticated") || (walletVerified && e.entryMode === "ecommerce")) {
    w.compare(
      ineligible,
      `The record shows the payment authenticated by ${AUTH_LABEL[e.authentication]}, result 'authenticated'. The record does not show the security level indicator sent with the authorisation.`,
      expected,
      "differs",
      evidence,
    );
    if (!statements.has("mc.authenticated")) statements.set("mc.authenticated", onDate);
    shown = false;
  } else {
    const shownAs = e.authentication === "none_recorded" ? AUTH_LABEL[e.authentication] : `${AUTH_LABEL[e.authentication]}, result '${e.authenticationResult}'`;
    w.compare(ineligible, `The record shows the payment was ${ENTRY_LABEL[e.entryMode]}, with ${shownAs}.`, expected, "matches", evidence);
  }

  shown = timeLine(w, input, row, chargeback, `Under ${sectionRef(chargeback)}, the time frame for ${condition} is ${SCHEME_DISPUTE_DAYS} calendar days from the date the payment was processed.`) && shown;
  reportedLine(w, chargeback, "mastercard");
  return { conditionsShown: shown };
}

function requestAndResponseLines(w: SectionWriter, input: SectionInput): void {
  const asked = input.facts.card_dispute_requested?.value;
  const askedDate = asked?.value === "yes" ? dateOf(asked.date) : null;
  if (askedDate) {
    w.text(`The complainant asked the institution to dispute these payments on ${askedDate}.`, w.ev("card_dispute_requested"));
  } else {
    w.text("The records do not show that the complainant asked the institution to dispute these payments.");
  }

  const response = input.facts.card_dispute_response?.value;
  const evidence = w.ev("card_dispute_response");
  if (response?.status === "raised") {
    const when = dateOf(response.date);
    w.text(`The institution's letter states that it raised a dispute${when ? ` on ${when}` : ""}.`, evidence);
  } else if (response?.status === "declined") {
    w.text(
      response.reasonStated
        ? `The institution's letter states that it did not raise a dispute because '${response.reasonStated}'.`
        : "The institution's letter states that it did not raise a dispute.",
      evidence,
    );
  } else {
    w.text("The institution's letters do not say whether it raised a dispute.", response ? evidence : []);
  }
}

/** The card_dispute_comparison section (brief 4i). */
export const buildCardDisputeComparison: SectionBuilder = async (input) => {
  const w = new SectionWriter(input);
  const cardPayments = input.payments.filter((p) => p.instrument === "sg_card");
  if (cardPayments.length === 0) return w.result();

  const events = input.facts.card_auth_events?.value ?? [];
  const rows: PaymentRow[] = cardPayments.map((payment) => ({
    payment,
    event: events.find((e) => e.transactionIndex === payment.index) ?? null,
    onDate: dateOf(payment.date),
  }));

  const byScheme = new Map<CardScheme, PaymentRow[]>();
  for (const row of rows) {
    const scheme = row.event?.cardScheme ?? "not_known";
    byScheme.set(scheme, [...(byScheme.get(scheme) ?? []), row]);
  }

  const shownBySchemes: Array<{ scheme: Scheme; count: number; resolve: ClauseAsOf | null }> = [];
  for (const scheme of SCHEME_ORDER) {
    const group = byScheme.get(scheme);
    if (!group) continue;
    if (scheme !== "visa" && scheme !== "mastercard") {
      w.text(
        scheme === "other"
          ? `The record shows ${group.length} card payment(s) on a scheme other than Visa or Mastercard. This pack holds no rules for that scheme.`
          : `The records provided do not show the card scheme for ${group.length} card payment(s), so no scheme's rules are set beside them.`,
        w.ev("card_auth_events", "transactions"),
      );
      continue;
    }

    const statements = new Map<StatementKey, IsoDate>();
    let headerPrinted = false;
    let shown = 0;
    let earliest: IsoDate | null = null;
    const notHeld = new Set<IsoDate>();
    for (const row of group) {
      if (!row.onDate) {
        recordRow(w, row);
        w.text(`The records provided do not show the date of this payment, so ${SCHEME_NAME[scheme]}'s rules in force on that date cannot be read.`, w.ev("transactions"));
        continue;
      }
      const probeKey = scheme === "visa" ? CARD_DISPUTE_CLAUSE_KEYS.visa.cardAbsent : CARD_DISPUTE_CLAUSE_KEYS.mastercard.chargeback;
      const probe = await w.clause(probeKey, row.onDate);
      if (!headerPrinted && probe) {
        w.text(SCHEME_STANDING_SENTENCE);
        if (probe.coverage === "selected_sections") {
          w.text(
            `This pack holds selected sections of ${SCHEME_NAME[scheme]}'s rules (${probe.title}), edition dated ${probe.version_label}, on how unauthorised payments are handled. It does not hold the full rules.`,
            [],
            [probe.clause_key],
          );
        }
        headerPrinted = true;
      }
      recordRow(w, row);
      if (!probe) {
        if (!notHeld.has(row.onDate)) {
          w.text(`This pack does not hold ${SCHEME_NAME[scheme]}'s rules in force on ${row.onDate}.`);
          notHeld.add(row.onDate);
        }
        continue;
      }
      const outcome = scheme === "visa"
        ? await visaPayment(w, input, row, statements)
        : await mastercardPayment(w, input, row, statements);
      if (outcome.conditionsShown) {
        shown += 1;
        if (earliest === null || row.onDate < earliest) earliest = row.onDate;
      }
    }
    for (const [key, onDate] of statements) await w.statement(key, onDate, w.ev("card_auth_events"));
    const resolve = scheme === "visa" && earliest ? await w.clause(CARD_DISPUTE_CLAUSE_KEYS.visa.resolve, earliest) : null;
    if (scheme === "visa" && earliest) await w.clause(CARD_DISPUTE_CLAUSE_KEYS.visa.permitted, earliest);
    if (shown > 0) shownBySchemes.push({ scheme, count: shown, resolve });
  }

  requestAndResponseLines(w, input);
  summaryLines(w, input, shownBySchemes);
  return w.result();
};

function summaryLines(w: SectionWriter, input: SectionInput, shown: Array<{ scheme: Scheme; count: number; resolve: ClauseAsOf | null }>): void {
  const asked = input.facts.card_dispute_requested?.value;
  const askedDate = asked?.value === "yes" ? dateOf(asked.date) : null;
  const status = input.facts.card_dispute_response?.value?.status;
  if (!askedDate || !status || !RESPONSE_DECLINED.has(status)) return;
  const did = status === "declined" ? "did not raise a dispute" : "did not answer";
  for (const { scheme, count, resolve } of shown) {
    const parts = [
      `On the records provided, the conditions ${SCHEME_NAME[scheme]}'s rules set for a fraud dispute are shown for ${count} payment(s).`,
      `The complainant asked the institution to dispute them on ${askedDate}.`,
      `The institution ${did}.`,
    ];
    const clauseKeys: string[] = [];
    if (scheme === "visa" && resolve) {
      parts.push("The scheme's rules allow, and do not require, an issuer to raise a dispute; they require the issuer to resolve cardholder disputes.");
      clauseKeys.push(CARD_DISPUTE_CLAUSE_KEYS.visa.permitted, CARD_DISPUTE_CLAUSE_KEYS.visa.resolve);
    }
    w.text(parts.join(" "), w.ev("card_dispute_requested", "card_dispute_response"), clauseKeys);
  }
}
