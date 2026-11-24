// Duty and time checks, layer 1 (FIDReC standards brief v5, 4a): the SRF Guidelines and the EUPG set against the
// institution's records. Section `duty_time_checks`.
//
// Routing (4a, Phase 0b): account rows run for account and e-wallet payments; for card payments only the rows marked
// "cards" run, and only with their EUPG clause (EUPG 4.1; SRF footnote 1). SRF clauses are cited only where assessSrf
// places the account payments in SRF scope; otherwise the EUPG clause alone. Every comparison also passes the
// instrument guard of instrument-scope.ts.
//
// Each line states what the record shows and carries the clause key; the expected side is the clause text in force on
// the payment date, read through the provider. No line says whether a duty was met.

import { formatMoney } from "../display.ts";
import type { InstitutionType } from "../keys.ts";
import type {
  AccessEvent,
  AccessEventKind,
  CardAuthEvent,
  ComparisonOutcome,
  DisputedPayment,
  IsoDate,
  IsoDateTime,
  RuleClauseKey,
  SectionBuilder,
  SectionInput,
  SectionResult,
} from "../update/contract.ts";
import {
  businessDaysBetween,
  calendarDaysBetween,
  earliestDate,
  evidenceFor,
  factValue,
  formatDate,
  formatDuration,
  formatTime,
  HOUR,
  localDate,
  ms,
  type PaymentGroup,
  paymentsIn,
  paymentTime,
  SectionWriter,
} from "./link-statements.ts";
import { assessSrf, srfFactsFromSnapshot } from "./srf.ts";

// proposed key, awaiting Elena's approval and Lane 6's contract update
// Brief 4a: where a card was added to a wallet inside the 12 hours after a token activation, the cooling-off check
// prints a reviewed statement that the definition of high-risk activities does not name adding a card to a mobile
// wallet. One statement per framework, because the brief asks for an EUPG version of it (EUPG 2.1 may be
// non-exhaustive; the SRF's 2.1 is closed).
export const PROPOSED_HIGH_RISK_WALLET_STATEMENT_KEYS = {
  srf: "srf.highrisk.wallet",
  eupg: "eupg.highrisk.wallet",
} as const;

/** The clause each row compares against, per framework (CLAUSE_KEYS.duty_time_checks). */
export const DUTY_TIME_CLAUSES = {
  coolingOff: { srf: "mas.srf/4.2.1", eupg: "mas.eupg/4.7" },
  eventAlerts: { srf: "mas.srf/4.2.2", eupg: "mas.eupg/4.9" },
  paymentAlerts: { srf: "mas.srf/4.2.3", eupg: "mas.eupg/4.10" },
  reportingChannel: { srf: "mas.srf/4.2.4", eupg: "mas.eupg/4.14" },
  fraudSurveillance: { srf: "mas.srf/4.2.5", eupg: "mas.eupg/4.21" },
  fraudSurveillanceStart: { srf: "mas.srf/4.4", eupg: null },
  investigationTime: { srf: "mas.srf/7.9", eupg: "mas.eupg/4.26" },
  writtenOutcome: { srf: "mas.srf/7.10", eupg: "mas.eupg/7.7" },
  informationOnEnquiry: { srf: "mas.srf/7.5", eupg: "mas.eupg/4.25" },
  holderReportingTime: { srf: "mas.srf/7.3", eupg: "mas.eupg/3.14" },
} as const satisfies Record<string, { srf: RuleClauseKey; eupg: RuleClauseKey | null }>;

/** SRF 4.4: paragraph 4.2.5 takes effect six months after the Guidelines. */
export const FRAUD_SURVEILLANCE_FROM: IsoDate = "2025-06-16";
/** SRF footnote 8 figures. */
export const DRAIN_BALANCE_SGD = 50_000;
export const DRAIN_SHARE = 0.5;
export const DRAIN_WINDOW_MS = 24 * HOUR;
/** SRF 4.2.1, EUPG 4.7. */
export const COOLING_OFF_MS = 12 * HOUR;
/** SRF 7.9, EUPG 4.26. */
export const INVESTIGATION_BUSINESS_DAYS = 21;
export const INVESTIGATION_BUSINESS_DAYS_COMPLEX = 45;
/** SRF 7.3. */
export const HOLDER_REPORTING_DAYS = 30;

export const HIGH_RISK_KINDS = ["payee_added", "limit_changed", "notifications_disabled", "contact_details_changed"] as const satisfies readonly AccessEventKind[];
const ALERTABLE_KINDS: readonly AccessEventKind[] = ["token_activated", "device_registered", "login", "new_device_login", ...HIGH_RISK_KINDS];
const LOGIN_KINDS: readonly AccessEventKind[] = ["login", "new_device_login"];

const isHighRisk = (e: AccessEvent) => (HIGH_RISK_KINDS as readonly string[]).includes(e.kind);

// ---------------------------------------------------------------------------------------------------------------
// Words for facts (what the record shows; nothing about duties)
// ---------------------------------------------------------------------------------------------------------------

const device = (label: string | null) => (label ? ` on a device labelled '${label}'` : "");
const fromDevice = (label: string | null) => (label ? ` from a device labelled '${label}'` : "");

export function eventWords(e: AccessEvent): string {
  const at = e.timestamp ? ` at ${formatTime(e.timestamp)}` : "";
  switch (e.kind) {
    case "token_activated":
      return `a digital token activated${at}${device(e.deviceLabel)}`;
    case "device_registered":
      return `a device registered${at}${device(e.deviceLabel)}`;
    case "login":
      return `a login${at}${fromDevice(e.deviceLabel)}`;
    case "new_device_login":
      return `a login recorded as from a new device${at}${fromDevice(e.deviceLabel)}`;
    case "payee_added":
      return `a payee added${at}${fromDevice(e.deviceLabel)}`;
    case "limit_changed":
      return `a transaction limit changed${at}${fromDevice(e.deviceLabel)}`;
    case "notifications_disabled":
      return `transaction notifications disabled${at}${fromDevice(e.deviceLabel)}`;
    case "contact_details_changed":
      return `contact details changed${at}${fromDevice(e.deviceLabel)}`;
    default:
      return `an event of type '${e.kind}'${at}`;
  }
}

const paymentWords = (p: DisputedPayment) => `payment ${p.index + 1} of ${formatMoney(p.amount)}${p.date ? ` on ${formatDate(p.date)}` : ""}`;

const percent = (share: number) => `${(share * 100).toFixed(2)}%`;

// ---------------------------------------------------------------------------------------------------------------
// Reading the access record
// ---------------------------------------------------------------------------------------------------------------

function byTime(events: readonly AccessEvent[]): AccessEvent[] {
  return events.filter((e) => ms(e.timestamp) !== null).sort((a, b) => ms(a.timestamp)! - ms(b.timestamp)!);
}

/**
 * The alert the record shows for an event: the first `alert_sent` not tied to a payment, at or after the event and before
 * the next event that could call for an alert. None of the documents gives a number of minutes for "real time", so the
 * lag is printed and not judged.
 */
export function alertFor(event: AccessEvent, events: readonly AccessEvent[]): AccessEvent | null {
  const t = ms(event.timestamp);
  if (t === null) return null;
  const sorted = byTime(events);
  const next = sorted.find((e) => e !== event && ALERTABLE_KINDS.includes(e.kind) && ms(e.timestamp)! > t);
  const limit = next ? ms(next.timestamp)! : Infinity;
  return sorted.find((e) => e.kind === "alert_sent" && e.relatedTransactionIndex === null && ms(e.timestamp)! >= t && ms(e.timestamp)! < limit) ?? null;
}

function alertWords(alert: AccessEvent | null, event: AccessEvent): string {
  if (!alert) return "The record shows no alert between this event and the next recorded event.";
  const lag = formatDuration(ms(alert.timestamp)! - ms(event.timestamp)!);
  return `The record shows an alert sent at ${formatTime(alert.timestamp!)}${alert.sentTo ? ` to ${alert.sentTo}` : ""}${alert.channel ? ` by ${alert.channel}` : ""}, ${lag} after it.`;
}

/** The latest token activation at or before an event. */
function activationBefore(event: AccessEvent, events: readonly AccessEvent[]): AccessEvent | null {
  const t = ms(event.timestamp);
  if (t === null) return null;
  const before = byTime(events).filter((e) => e.kind === "token_activated" && ms(e.timestamp)! <= t);
  return before[before.length - 1] ?? null;
}

/**
 * Logins from further devices (decision 21; 1.4c): a login from a device other than the one the latest token was
 * activated on.
 */
export function furtherDeviceLogins(events: readonly AccessEvent[]): Array<{ login: AccessEvent; activation: AccessEvent }> {
  const out: Array<{ login: AccessEvent; activation: AccessEvent }> = [];
  for (const login of byTime(events)) {
    if (!LOGIN_KINDS.includes(login.kind) || !login.deviceRef) continue;
    const activation = activationBefore(login, events);
    if (activation && activation.deviceRef && activation.deviceRef !== login.deviceRef) out.push({ login, activation });
  }
  return out;
}

/**
 * The events that start the cooling-off and call for an alert (SRF 4.2.1, 4.2.2; EUPG 4.7, 4.9). A token activation for
 * any institution. A login on a new device only for an account issued by a payment service provider: an event the
 * record labels `new_device_login`, or the first login from a device other than the token's.
 */
export function coolingOffTriggers(events: readonly AccessEvent[], institutionType: InstitutionType | null): AccessEvent[] {
  const triggers = byTime(events).filter((e) => e.kind === "token_activated");
  if (institutionType === "payment_service_provider") {
    const seen = new Set<string>();
    for (const e of byTime(events)) {
      if (e.kind === "new_device_login") triggers.push(e);
      else if (e.kind === "login" && e.deviceRef && !seen.has(e.deviceRef)) {
        const activation = activationBefore(e, events);
        if (activation && activation.deviceRef !== e.deviceRef) triggers.push(e);
      }
      if (e.deviceRef) seen.add(e.deviceRef);
    }
  }
  return [...new Set(triggers)].sort((a, b) => ms(a.timestamp)! - ms(b.timestamp)!);
}

function institutionTypeOf(input: SectionInput): InstitutionType | null {
  return input.institution?.type ?? factValue(input.facts, "institution_names")?.[0]?.type ?? null;
}

/** The account instrument whose payments leave the account the fraud-surveillance figures are about. */
function drainPayments(input: SectionInput, account: readonly DisputedPayment[]): { counted: DisputedPayment[]; excluded: DisputedPayment[] } {
  const type = institutionTypeOf(input);
  const own = account.filter((p) =>
    type === "bank" ? p.instrument === "account_transfer" : type === "payment_service_provider" ? p.instrument === "ewallet" : true
  );
  return { counted: own.filter((p) => !p.excludedFromDrainTest), excluded: own.filter((p) => p.excludedFromDrainTest) };
}

// ---------------------------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------------------------

export interface DutyTimeCheckOptions {
  /** Public holidays left out of the business-day count (SRF 7.9). The brief names no list; none by default. */
  publicHolidays?: Iterable<IsoDate>;
}

interface Context {
  input: SectionInput;
  w: SectionWriter;
  srfInScope: boolean;
  institutionType: InstitutionType | null;
  access: AccessEvent[] | null;
  cards: CardAuthEvent[] | null;
  holidays: Set<IsoDate>;
}

interface Row {
  clauses: { srf: string | null; eupg: string | null };
  group: PaymentGroup;
  payments: readonly DisputedPayment[];
  onDate: IsoDate | null;
  record: string;
  outcome: ComparisonOutcome;
  evidenceIds: string[];
}

/** One line per framework: the SRF clause where the payments are in SRF scope (account only), then the EUPG clause. */
async function row(ctx: Context, r: Row): Promise<void> {
  const keys = [r.group === "account" && ctx.srfInScope ? r.clauses.srf : null, r.clauses.eupg].filter((k): k is string => Boolean(k));
  for (const clauseKey of keys) {
    await ctx.w.compare({ clauseKey, onDate: r.onDate, record: r.record, outcome: r.outcome, evidenceIds: r.evidenceIds, group: r.group, payments: r.payments });
  }
}

const groupDate = (payments: readonly DisputedPayment[]) => earliestDate(payments.map((p) => p.date));
const NO_ACCESS_RECORD = "The records provided include no record from the institution of logins, devices and alerts.";

async function coolingOff(ctx: Context, account: DisputedPayment[]): Promise<void> {
  const { input, access } = ctx;
  const onDate = groupDate(account);
  const ev = evidenceFor(input, "access_events");
  const base = { clauses: DUTY_TIME_CLAUSES.coolingOff, group: "account" as const, payments: account, onDate };
  if (!access) return row(ctx, { ...base, record: NO_ACCESS_RECORD, outcome: "not_shown", evidenceIds: [] });

  const triggers = coolingOffTriggers(access, ctx.institutionType);
  if (!triggers.length) {
    const what = ctx.institutionType === "payment_service_provider" ? "no digital token activation and no login from a new device" : "no digital token activation";
    return row(ctx, { ...base, record: `The record shows ${what}.`, outcome: "not_applicable", evidenceIds: ev });
  }

  const firstPaymentTimes = account.map((p) => paymentTime(p, access, ctx.cards ?? [])).filter((t): t is IsoDateTime => Boolean(t)).sort((a, b) => ms(a)! - ms(b)!);
  const method = factValue(input.facts, "token_activation_method");
  for (const trigger of triggers) {
    const t = ms(trigger.timestamp)!;
    const parts = [`The record shows ${eventWords(trigger)}${trigger.authorisedBy ? `, authorised by ${trigger.authorisedBy}` : ""}.`];
    if (trigger.kind === "token_activated" && method === "mailed_code") parts.push("The record shows the token was activated with a code sent by post; the time shown is the activation.");
    const firstPayment = firstPaymentTimes.find((p) => ms(p)! >= t);
    if (firstPayment) parts.push(`The first disputed payment after it is at ${formatTime(firstPayment)}, ${formatDuration(ms(firstPayment)! - t)} after it.`);

    const inWindow = byTime(access).filter((e) => isHighRisk(e) && ms(e.timestamp)! >= t && ms(e.timestamp)! - t < COOLING_OFF_MS);
    if (!inWindow.length) {
      await row(ctx, {
        ...base,
        record: [...parts, "The record shows no payee added, transaction limit increased, notifications disabled or contact details changed in the 12 hours after it."].join(" "),
        outcome: "matches",
        evidenceIds: ev,
      });
    }
    for (const activity of inWindow) {
      await row(ctx, {
        ...base,
        record: [...parts, `The record shows ${eventWords(activity)}, ${formatDuration(ms(activity.timestamp)! - t)} after it.`].join(" "),
        outcome: "differs",
        evidenceIds: ev,
      });
    }
  }

  // A card added to a mobile wallet inside the 12 hours after a token activation (4a, last paragraph).
  const activations = triggers.filter((e) => e.kind === "token_activated");
  for (const card of ctx.cards ?? []) {
    const added = ms(card.walletProvisionedAt);
    if (added === null) continue;
    const activation = activations.find((a) => added >= ms(a.timestamp)! && added - ms(a.timestamp)! < COOLING_OFF_MS);
    if (!activation) continue;
    const cardEv = evidenceFor(input, "access_events", "card_auth_events");
    ctx.w.text(
      `The record shows the card added to a mobile wallet at ${formatTime(card.walletProvisionedAt!)}${device(card.walletDeviceLabel)}, ${formatDuration(added - ms(activation.timestamp)!)} after the digital token was activated.`,
      cardEv,
    );
    const key = ctx.srfInScope ? PROPOSED_HIGH_RISK_WALLET_STATEMENT_KEYS.srf : PROPOSED_HIGH_RISK_WALLET_STATEMENT_KEYS.eupg;
    await ctx.w.statement(key, onDate, cardEv);
    break;
  }
}

async function eventAlerts(ctx: Context, account: DisputedPayment[]): Promise<void> {
  const { input, access } = ctx;
  const onDate = groupDate(account);
  const base = { clauses: DUTY_TIME_CLAUSES.eventAlerts, group: "account" as const, payments: account, onDate };
  if (!access) return row(ctx, { ...base, record: NO_ACCESS_RECORD, outcome: "not_shown", evidenceIds: [] });
  const ev = evidenceFor(input, "access_events");
  const events = [...new Set([...coolingOffTriggers(access, ctx.institutionType), ...byTime(access).filter(isHighRisk)])]
    .sort((a, b) => ms(a.timestamp)! - ms(b.timestamp)!);
  if (!events.length) {
    return row(ctx, { ...base, record: "The record shows no digital token activation and no payee added, limit increased, notifications disabled or contact details changed.", outcome: "not_applicable", evidenceIds: ev });
  }
  for (const event of events) {
    const alert = alertFor(event, access);
    await row(ctx, {
      ...base,
      record: `The record shows ${eventWords(event)}. ${alertWords(alert, event)}`,
      outcome: alert ? "matches" : "differs",
      evidenceIds: ev,
    });
  }
}

/** Logins from further devices (decision 21): facts per login, then for a bank account the reviewed statement. */
async function furtherLogins(ctx: Context, account: DisputedPayment[]): Promise<void> {
  const { input, access } = ctx;
  if (!access) return;
  const logins = furtherDeviceLogins(access);
  if (!logins.length) return;
  const recognition = factValue(input.facts, "device_recognition") ?? [];
  const ev = evidenceFor(input, "access_events", "device_recognition");
  for (const { login, activation } of logins) {
    const answer = recognition.find((d) => d.deviceRef === login.deviceRef)?.answer;
    const states =
      answer === "not_mine"
        ? "The complainant states that this device is not theirs."
        : answer === "mine"
          ? "The complainant states that this device is theirs."
          : answer === "not_sure"
            ? "The complainant states that they are not sure whether this device is theirs."
            : "The complainant has not said whether this device is theirs.";
    const parts = [
      `The institution's record shows ${eventWords(login)}.`,
      states,
      login.authorisedBy ? `The record shows the login was authorised by ${login.authorisedBy}.` : "The record does not show how the login was authenticated.",
      alertWords(alertFor(login, access), login),
    ];
    if (login.authorisedBy && /token/i.test(login.authorisedBy)) {
      parts.push(`The record shows this login was approved with the digital token activated at ${formatTime(activation.timestamp!)}.`);
    }
    ctx.w.text(parts.join(" "), ev);
  }
  if (ctx.institutionType === "bank") await ctx.w.statement("srf.newdevice.bank", groupDate(account), evidenceFor(input, "access_events"));
}

async function paymentAlerts(ctx: Context, group: PaymentGroup, payments: DisputedPayment[]): Promise<void> {
  const { input, access } = ctx;
  const threshold = factValue(input.facts, "transaction_alert_threshold");
  const ev = evidenceFor(input, "transactions", "access_events", "transaction_alert_threshold");
  for (const p of payments) {
    const base = { clauses: DUTY_TIME_CLAUSES.paymentAlerts, group, payments: [p], onDate: p.date ?? groupDate(payments) };
    const amount = p.amount.amountSgd;
    const limit = threshold?.amount.amountSgd ?? null;
    if (!threshold || limit === null || amount === null) {
      await row(ctx, { ...base, record: `The records provided do not show the alert threshold that applied to ${paymentWords(p)}.`, outcome: "not_shown", evidenceIds: ev });
      continue;
    }
    const setBy = threshold.setBy === "default" ? "the default threshold" : threshold.setBy === "account_holder" ? "the threshold the account holder set" : "the threshold";
    const thresholdWords = `${setBy}, ${formatMoney(threshold.amount)}`;
    if (amount < limit) {
      await row(ctx, { ...base, record: `${capital(paymentWords(p))} is below ${thresholdWords}.`, outcome: "not_applicable", evidenceIds: ev });
      continue;
    }
    if (!access) {
      await row(ctx, { ...base, record: `${capital(paymentWords(p))} is at or above ${thresholdWords}. ${NO_ACCESS_RECORD}`, outcome: "not_shown", evidenceIds: ev });
      continue;
    }
    const alert = byTime(access).find((e) => e.kind === "alert_sent" && e.relatedTransactionIndex === p.index);
    const alertText = alert
      ? `The record shows an alert for it sent at ${formatTime(alert.timestamp!)}${alert.sentTo ? ` to ${alert.sentTo}` : ""}.`
      : "The record shows no alert for it.";
    await row(ctx, {
      ...base,
      record: `${capital(paymentWords(p))} is at or above ${thresholdWords}. ${alertText}`,
      outcome: alert ? "matches" : "differs",
      evidenceIds: ev,
    });
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function reportingChannel(ctx: Context, group: PaymentGroup, payments: DisputedPayment[]): Promise<void> {
  const { input, access } = ctx;
  const base = { clauses: DUTY_TIME_CLAUSES.reportingChannel, group, payments, onDate: groupDate(payments) };
  const ev = evidenceFor(input, "reported_to_bank", "access_events", "transactions");
  const report = factValue(input.facts, "reported_to_bank");
  if (!report || report.value !== "yes" || !report.date) {
    return row(ctx, { ...base, record: "The records provided do not show when the complainant reported to the institution.", outcome: "not_shown", evidenceIds: ev });
  }
  const reported = `The complainant reported to the institution on ${formatDate(report.date)}${report.channel ? ` (${report.channel})` : ""}.`;
  const blocked = access ? byTime(access).find((e) => e.kind === "account_blocked") ?? null : null;
  if (!blocked) {
    return row(ctx, { ...base, record: `${reported} ${access ? "The record does not show access being blocked." : NO_ACCESS_RECORD}`, outcome: "not_shown", evidenceIds: ev });
  }
  const blockedAt = ms(blocked.timestamp)!;
  const after = payments.filter((p) => {
    const time = paymentTime(p, access ?? [], ctx.cards ?? []);
    return (p.date !== null && p.date > report.date!) || (time !== null && ms(time)! > blockedAt);
  });
  const afterText = after.length
    ? `The record shows ${after.length} disputed payment${after.length === 1 ? "" : "s"} after the report or the block: ${after.map((p) => p.index + 1).join(", ")}.`
    : "The record shows no disputed payment after the report or the block.";
  await row(ctx, {
    ...base,
    record: `${reported} The record shows access blocked at ${formatTime(blocked.timestamp!)}. ${afterText}`,
    outcome: after.length ? "differs" : "matches",
    evidenceIds: ev,
  });
}

async function fraudSurveillance(ctx: Context, account: DisputedPayment[]): Promise<void> {
  const { input, access } = ctx;
  const { counted, excluded } = drainPayments(input, account);
  const ev = evidenceFor(input, "balance_before_first_disputed_payment", "transactions", "access_events");
  const onDate = groupDate(counted.length ? counted : account);
  const blocked = access ? byTime(access).find((e) => e.kind === "account_blocked") ?? null : null;

  if (ctx.srfInScope) {
    if (onDate && onDate < FRAUD_SURVEILLANCE_FROM) {
      await ctx.w.compare({
        clauseKey: DUTY_TIME_CLAUSES.fraudSurveillanceStart.srf,
        onDate,
        record: `The first disputed payment from the account is dated ${formatDate(onDate)}.`,
        outcome: "not_applicable",
        evidenceIds: evidenceFor(input, "transactions"),
        group: "account",
        payments: account,
      });
    } else {
      const result = drainResult(ctx, counted, excluded);
      await ctx.w.compare({ clauseKey: DUTY_TIME_CLAUSES.fraudSurveillance.srf, onDate, ...result, evidenceIds: ev, group: "account", payments: account });
    }
  }

  // EUPG 4.21 gives no figures: the record cannot show what the institution's monitoring identified.
  const times = account.map((p) => paymentTime(p, access ?? [], ctx.cards ?? [])).filter((t): t is IsoDateTime => Boolean(t)).sort((a, b) => ms(a)! - ms(b)!);
  const parts = [
    times.length
      ? `The record shows ${account.length} disputed payment${account.length === 1 ? "" : "s"} from the account between ${formatTime(times[0])} and ${formatTime(times[times.length - 1])}.`
      : `The records show ${account.length} disputed payment${account.length === 1 ? "" : "s"} from the account.`,
    access ? (blocked ? `The record shows access blocked at ${formatTime(blocked.timestamp!)}.` : "The record does not show access being blocked.") : NO_ACCESS_RECORD,
  ];
  await ctx.w.compare({ clauseKey: DUTY_TIME_CLAUSES.fraudSurveillance.eupg, onDate, record: parts.join(" "), outcome: "not_shown", evidenceIds: ev, group: "account", payments: account });
}

/**
 * SRF footnote 8: (a) a balance of S$50,000 or more immediately before, and (b) more than 50% of it transferred out within
 * 24 hours, leaving out the excluded payment types. Both must be shown. Where they are, the payment that crossed 50% and
 * the later payments are set against any block the record shows.
 */
export function drainResult(
  ctx: Pick<Context, "input" | "access" | "cards">,
  counted: readonly DisputedPayment[],
  excluded: readonly DisputedPayment[],
): { record: string; outcome: ComparisonOutcome } {
  const balanceMoney = factValue(ctx.input.facts, "balance_before_first_disputed_payment");
  const balance = balanceMoney?.amountSgd ?? null;
  if (balance === null || !balanceMoney) {
    return { record: "The records provided do not show the balance immediately before the first disputed payment.", outcome: "not_shown" };
  }
  if (counted.some((p) => p.amount.amountSgd === null)) {
    return { record: "The records provided do not show every disputed payment in Singapore dollars.", outcome: "not_shown" };
  }
  const total = counted.reduce((s, p) => s + p.amount.amountSgd!, 0);
  const figures = [
    `The bank statement shows a balance of ${formatMoney(balanceMoney)} immediately before the first disputed payment.`,
    `The disputed payments out of the account total ${formatMoney({ amount: total, currency: "SGD", amountSgd: total })} (${counted.length} payment${counted.length === 1 ? "" : "s"}), ${percent(balance > 0 ? total / balance : 0)} of that balance.`,
    excluded.length ? `${excluded.length} payment${excluded.length === 1 ? " is" : "s are"} of a type not counted in these figures: ${excluded.map((p) => p.index + 1).join(", ")}.` : null,
  ].filter(Boolean) as string[];
  if (balance < DRAIN_BALANCE_SGD || !(total > balance * DRAIN_SHARE)) return { record: figures.join(" "), outcome: "not_applicable" };

  const access = ctx.access ?? [];
  const timed = counted.map((p) => ({ p, time: paymentTime(p, access, ctx.cards ?? []) }));
  if (timed.some((x) => !x.time)) {
    return { record: [...figures, "The records provided do not show the time of every disputed payment."].join(" "), outcome: "not_shown" };
  }
  timed.sort((a, b) => ms(a.time)! - ms(b.time)!);
  let crossing: { p: DisputedPayment; time: IsoDateTime; out: number } | null = null;
  let most = 0;
  for (const x of timed) {
    const end = ms(x.time)!;
    const out = timed.filter((y) => ms(y.time)! <= end && end - ms(y.time)! < DRAIN_WINDOW_MS).reduce((s, y) => s + y.p.amount.amountSgd!, 0);
    most = Math.max(most, out);
    if (out > balance * DRAIN_SHARE) {
      crossing = { p: x.p, time: x.time!, out };
      break;
    }
  }
  if (!crossing) {
    const mostMoney = { amount: most, currency: "SGD", amountSgd: most };
    return { record: [...figures, `The most transferred out within any 24 hours is ${formatMoney(mostMoney)}, ${percent(most / balance)} of the balance.`].join(" "), outcome: "not_applicable" };
  }
  const later = timed.filter((x) => ms(x.time)! > ms(crossing!.time)!).map((x) => x.p.index + 1);
  const outMoney = { amount: crossing.out, currency: "SGD", amountSgd: crossing.out };
  const crossed = `Payment ${crossing.p.index + 1}, at ${formatTime(crossing.time)}, brings the amount transferred out within 24 hours to ${formatMoney(outMoney)}, ${percent(crossing.out / balance)} of the balance.`;
  const laterText = later.length ? ` The record shows later disputed payments: ${later.join(", ")}.` : "";
  const blocked = byTime(access).find((e) => e.kind === "account_blocked") ?? null;
  const blockedBefore = blocked && ms(blocked.timestamp)! <= ms(crossing.time)!;
  const blockText = blockedBefore
    ? ` The record shows access blocked at ${formatTime(blocked!.timestamp!)}.`
    : ` The record does not show that payment ${crossing.p.index + 1} or any later payment was blocked or held${blocked ? `; it shows access blocked at ${formatTime(blocked.timestamp!)}` : ""}.`;
  return { record: [...figures, crossed + laterText + blockText].join(" "), outcome: blockedBefore ? "matches" : "differs" };
}

async function investigationTime(ctx: Context, account: DisputedPayment[]): Promise<void> {
  const { input } = ctx;
  const base = { clauses: DUTY_TIME_CLAUSES.investigationTime, group: "account" as const, payments: account, onDate: groupDate(account) };
  const ev = evidenceFor(input, "reported_to_bank", "bank_reply");
  const report = factValue(input.facts, "reported_to_bank");
  const reply = factValue(input.facts, "bank_reply");
  if (!report?.date || report.value !== "yes") {
    return row(ctx, { ...base, record: "The records provided do not show when the complainant reported to the institution.", outcome: "not_shown", evidenceIds: ev });
  }
  if (!reply || reply.status !== "final_reply" || !reply.date) {
    return row(ctx, { ...base, record: `The complainant reported to the institution on ${formatDate(report.date)}. The records provided do not show a final reply.`, outcome: "not_shown", evidenceIds: ev });
  }
  const days = businessDaysBetween(report.date, reply.date, ctx.holidays);
  const counting = ctx.holidays.size ? "Monday to Friday, less public holidays" : "Monday to Friday; public holidays not deducted";
  const record = `The complainant reported to the institution on ${formatDate(report.date)}. The institution's final reply is dated ${formatDate(reply.date)}, ${days} business day${days === 1 ? "" : "s"} later (${counting}).`;
  if (days <= INVESTIGATION_BUSINESS_DAYS) return row(ctx, { ...base, record, outcome: "matches", evidenceIds: ev });
  if (days <= INVESTIGATION_BUSINESS_DAYS_COMPLEX) {
    return row(ctx, { ...base, record: `${record} The records provided do not show whether the institution treated the case as complex.`, outcome: "not_shown", evidenceIds: ev });
  }
  return row(ctx, { ...base, record, outcome: "differs", evidenceIds: ev });
}

async function writtenOutcome(ctx: Context, account: DisputedPayment[]): Promise<void> {
  const { input } = ctx;
  const base = { clauses: DUTY_TIME_CLAUSES.writtenOutcome, group: "account" as const, payments: account, onDate: groupDate(account) };
  const ev = evidenceFor(input, "bank_reply", "institution_fault_label");
  const reply = factValue(input.facts, "bank_reply");
  if (!reply || reply.status !== "final_reply") {
    return row(ctx, { ...base, record: "The records provided do not show a final reply from the institution.", outcome: "not_shown", evidenceIds: ev });
  }
  const label = factValue(input.facts, "institution_fault_label");
  const dated = reply.date ? ` dated ${formatDate(reply.date)}` : "";
  const outcome = reply.outcome ? ` The reply states an outcome (${reply.outcome.replace(/_/g, " ")}).` : " The records provided do not show the outcome the reply states.";
  if (!reply.outcome || !label?.label) {
    return row(ctx, { ...base, record: `The institution's final reply${dated} is in the records.${outcome} The records provided do not show how the reply assesses the account holder's responsibility.`, outcome: "not_shown", evidenceIds: ev });
  }
  const conduct = label.conduct ? ` and cites this conduct: ${label.conduct}` : "";
  await row(ctx, {
    ...base,
    record: `The institution's final reply${dated} is in the records.${outcome} It describes the complainant's conduct as '${label.label}'${conduct}.`,
    outcome: "matches",
    evidenceIds: ev,
  });
}

async function informationOnEnquiry(ctx: Context, account: DisputedPayment[]): Promise<void> {
  const { input, access } = ctx;
  const base = { clauses: DUTY_TIME_CLAUSES.informationOnEnquiry, group: "account" as const, payments: account, onDate: groupDate(account) };
  const ev = evidenceFor(input, "access_record_requested", "access_events");
  const asked = factValue(input.facts, "access_record_requested");
  if (!asked || asked.value === "unsure") {
    return row(ctx, { ...base, record: "The records provided do not show whether the complainant asked the institution for its records of the payments.", outcome: "not_shown", evidenceIds: ev });
  }
  if (asked.value === "no") {
    return row(ctx, { ...base, record: "The records show the complainant did not ask the institution for its records of the payments.", outcome: "not_applicable", evidenceIds: ev });
  }
  const when = `The complainant asked the institution for its records${asked.date ? ` on ${formatDate(asked.date)}` : ""}.`;
  if (!access) {
    return row(ctx, { ...base, record: `${when} The records provided do not show what the institution supplied.`, outcome: "not_shown", evidenceIds: ev });
  }
  await row(ctx, { ...base, record: `${when} The institution's record of logins, devices and alerts is in the evidence.`, outcome: "matches", evidenceIds: ev });
}

async function holderReportingTime(ctx: Context, account: DisputedPayment[]): Promise<void> {
  const { input, access } = ctx;
  const base = { clauses: DUTY_TIME_CLAUSES.holderReportingTime, group: "account" as const, payments: account, onDate: groupDate(account) };
  const ev = evidenceFor(input, "access_events", "reported_to_bank", "reported_to_police");
  const report = factValue(input.facts, "reported_to_bank");
  const firstAlert = access ? byTime(access).find((e) => e.kind === "alert_sent") ?? null : null;
  if (!firstAlert || !report?.date || report.value !== "yes") {
    const missing = !firstAlert ? (access ? "The record shows no alert." : NO_ACCESS_RECORD) : "The records provided do not show when the complainant reported to the institution.";
    await row(ctx, { ...base, record: missing, outcome: "not_shown", evidenceIds: ev });
  } else {
    const days = calendarDaysBetween(localDate(firstAlert.timestamp!), report.date);
    await row(ctx, {
      ...base,
      record: `The record shows the first alert sent at ${formatTime(firstAlert.timestamp!)}. The complainant reported to the institution on ${formatDate(report.date)}, ${days} calendar day${days === 1 ? "" : "s"} later.`,
      outcome: days <= HOLDER_REPORTING_DAYS ? "matches" : "differs",
      evidenceIds: ev,
    });
  }
  // Supporting information within 3 calendar days of notifying: no fact records when it was given to the institution.
  const police = factValue(input.facts, "reported_to_police");
  const policeText = police?.value === "yes" && police.date ? `The complainant reported to the police on ${formatDate(police.date)}. ` : "";
  await row(ctx, {
    ...base,
    record: `${policeText}The records provided do not show when supporting information was given to the institution.`,
    outcome: "not_shown",
    evidenceIds: ev,
  });
}

export function createDutyTimeChecks(options: DutyTimeCheckOptions = {}): SectionBuilder {
  const holidays = new Set(options.publicHolidays ?? []);
  return async (input: SectionInput): Promise<SectionResult> => {
    const w = new SectionWriter("duty_time_checks", input.provider);
    const srf = assessSrf(srfFactsFromSnapshot(input.facts as never)).portions.find((p) => p.kind === "srf");
    const ctx: Context = {
      input,
      w,
      srfInScope: srf?.assessment === "likely_in_scope",
      institutionType: institutionTypeOf(input),
      access: factValue(input.facts, "access_events"),
      cards: factValue(input.facts, "card_auth_events"),
      holidays,
    };
    const account = paymentsIn(input.payments, "account");
    const card = paymentsIn(input.payments, "card");

    if (account.length) {
      await coolingOff(ctx, account);
      await eventAlerts(ctx, account);
      await furtherLogins(ctx, account);
      await paymentAlerts(ctx, "account", account);
      await reportingChannel(ctx, "account", account);
      await fraudSurveillance(ctx, account);
      await investigationTime(ctx, account);
      await writtenOutcome(ctx, account);
      await informationOnEnquiry(ctx, account);
      await holderReportingTime(ctx, account);
    }
    if (card.length) {
      await paymentAlerts(ctx, "card", card);
      await reportingChannel(ctx, "card", card);
    }
    return w.result();
  };
}

/** Section `duty_time_checks` (brief 4a), with no public holidays configured. */
export const buildDutyTimeChecks: SectionBuilder = createDutyTimeChecks();
