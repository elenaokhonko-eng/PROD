// The account-access sequence (FIDReC standards brief v5, 4f; decision 10): section `account_access_sequence`.
// States, neutrally and in order, the sequence the records show: digital token activated -> login from that device ->
// card added to a wallet and/or card payments authenticated with that token -> what the card scheme's rules say ->
// what the institution did. One numbered line per step; a step with no record prints "The records provided do not
// show [step]."
//
// Scheme lines print by statement key only (Phase 7: "replace the inline wording in 4f with the statement keys"); the
// wording comes from the approved statement in force on the payment date (Lane 1 and Lane 5 seeds). The section makes
// no statement about who took the token or who made the payments. Evidence IDs travel in each line's `evidenceIds`;
// the renderer prints them.
//
// This file also holds the small helpers the other Lane 4 sections share (fact reads, payment types, recorded-method
// wording). Dates, times, money, the complainant's pronouns, the standing scheme sentence and the section writer come
// from the shared `update/section-writer.ts` (Lane 6 Step 0b).
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type {
  AccessEvent,
  CardAuthEvent,
  CardAuthentication,
  ContractFactKey,
  ContractFactValues,
  DisputedPayment,
  IsoDate,
  SectionBuilder,
  SectionInput,
  SectionResult,
  StatementKey,
  WalletProvisioningAuthentication,
} from "../update/contract.ts";
import { CLAUSE_KEYS, NAMED_CLAUSE_KEYS, sameDevice } from "../update/contract.ts";
import {
  datePart,
  deviceRecognitionSentence,
  formatDate,
  formatDateTime,
  formatMoneyTotal,
  NEAREST_VERSION_FALLBACK,
  SCHEME_STANDING_SENTENCE,
  SectionWriter,
} from "../update/section-writer.ts";

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers (used by customer-fault-definitions.ts, customer-conduct.ts and institution-terms.ts)
// ---------------------------------------------------------------------------------------------------------------

/** The evidence IDs behind the given facts, in first-seen order. */
export function evidenceFor(input: Pick<SectionInput, "evidenceIds">, ...keys: ContractFactKey[]): string[] {
  const out: string[] = [];
  for (const key of keys) for (const id of input.evidenceIds[key] ?? []) if (!out.includes(id)) out.push(id);
  return out;
}

/** The labels a record line reads (the same rule as Lane 3's sections). */
export const RECORD_LINE_LABELS = ["confirmed", "claimant_only"] as const;

/**
 * The fact's value when it is labelled `confirmed` or `claimant_only`; null otherwise. A fact labelled `not_sure` (or
 * `not_known`) is not read for record lines until Elena decides how `not_sure`-labelled facts print (review of
 * 24 Nov 2026, Lane 4 issue 6; open).
 */
export function factValue<K extends ContractFactKey>(input: Pick<SectionInput, "facts">, key: K): ContractFactValues[K] | null {
  const fact = input.facts[key];
  if (!fact || fact.value === null || fact.value === undefined) return null;
  return (RECORD_LINE_LABELS as readonly string[]).includes(fact.label) ? (fact.value as ContractFactValues[K]) : null;
}

export function earliestDate(dates: Array<string | null | undefined>): IsoDate | null {
  const valid = dates.map(datePart).filter((d): d is IsoDate => d !== null).sort();
  return valid[0] ?? null;
}

/** Distinct dates, ascending. */
export function distinctDates(dates: Array<string | null | undefined>): IsoDate[] {
  return [...new Set(dates.map(datePart).filter((d): d is IsoDate => d !== null))].sort();
}

export function isCardPayment(p: DisputedPayment): boolean {
  return p.instrument === "sg_card";
}

/** Account-type payments for the EUPG and SRF: transfers from a bank account and e-wallet payments. */
export function isAccountPayment(p: DisputedPayment): boolean {
  return p.instrument === "account_transfer" || p.instrument === "ewallet";
}

// ---------------------------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------------------------

/**
 * The clause whose verified presence (or nearest version, 3.2 rule 6) means a scheme's rules are held. Visa: the
 * card-absent fraud dispute condition. Mastercard: the 4837 issuer chargeback section (Lane 5's key, Step 0b).
 */
export const SCHEME_ANCHOR_CLAUSE_KEYS = {
  visa: CLAUSE_KEYS.card_dispute_comparison[3], // "visa.core_rules/11.8.5"
  mastercard: NAMED_CLAUSE_KEYS.mastercardIssuerChargeback,
} as const;

/**
 * The closing statement after the card scheme lines (4f; Decision 9): how a loss on a card is shared is in the ABS
 * Code of Practice for Banks – Credit Cards and the issuer's own terms. A reviewed statement (Lane 1 drafts the seed),
 * never code wording.
 */
export const CARD_LOSS_SHARING_STATEMENT_KEY = "bridge.card_loss_sharing" as const satisfies StatementKey;

const SCHEME_NAMES = { visa: "Visa", mastercard: "Mastercard" } as const;
type HeldScheme = keyof typeof SCHEME_NAMES;

// ---------------------------------------------------------------------------------------------------------------
// Wording of recorded methods (neutral descriptions of the record's own fields)
// ---------------------------------------------------------------------------------------------------------------

/**
 * What the complainant states, from the confirmed `credentials_or_otp_shared` option (step 1; 4g markers). Neutral
 * forms only: "they", "their" (Decision 2).
 */
export const CREDENTIALS_STATED: Record<string, string> = {
  entered_on_fake_site_or_app: "they entered their credentials, card details or a one-time code on a fake website or app",
  given_directly: "they told their credentials, card details or a one-time code to someone over the phone",
  given_in_message: "they sent their credentials, card details or a one-time code in a message",
  installed_app_or_malware: "they installed an app the scammer asked for",
  not_shared: "they never shared their credentials, card details or a one-time code",
  unsure: "they are not sure whether they shared their credentials, card details or a one-time code",
};

export const CARD_AUTH_METHOD: Record<CardAuthentication, string | null> = {
  three_ds_otp: "3-D Secure with a one-time code",
  three_ds_in_app: "3-D Secure with in-app approval",
  three_ds_digital_token: "3-D Secure with the digital token",
  wallet_device: "the mobile wallet",
  pin: "PIN",
  none_recorded: null,
  not_known: null,
};

const WALLET_METHOD: Record<WalletProvisioningAuthentication, string | null> = {
  sms_otp: "an SMS one-time code",
  in_app: "in-app approval",
  digital_token: "the digital token",
  not_known: null,
};

export function isThreeDs(a: CardAuthentication): boolean {
  return a === "three_ds_otp" || a === "three_ds_in_app" || a === "three_ds_digital_token";
}

const HIGH_RISK_OR_LOGIN = new Set([
  "login",
  "new_device_login",
  "payee_added",
  "limit_changed",
  "notifications_disabled",
  "contact_details_changed",
]);

const ACCESS_EVENT_WORDS: Record<string, string> = {
  login: "a login",
  new_device_login: "a login on a new device",
  payee_added: "a payee added",
  limit_changed: "a transaction limit changed",
  notifications_disabled: "transaction notifications disabled",
  contact_details_changed: "contact details changed",
};

const byTime = <T extends { timestamp: string | null }>(a: T, b: T) =>
  (a.timestamp ?? "9999") < (b.timestamp ?? "9999") ? -1 : (a.timestamp ?? "9999") > (b.timestamp ?? "9999") ? 1 : 0;

// ---------------------------------------------------------------------------------------------------------------
// The sequence
// ---------------------------------------------------------------------------------------------------------------

/** The anchor of the sequence (step 2): the first token activation, else the first device registration. */
export function sequenceAnchor(events: AccessEvent[]): AccessEvent | null {
  const sorted = [...events].sort(byTime);
  return sorted.find((e) => e.kind === "token_activated") ?? sorted.find((e) => e.kind === "device_registered") ?? null;
}

/** Card payments in the card authentication record (events tied to a disputed payment). */
function cardPaymentEvents(events: CardAuthEvent[], payments: DisputedPayment[]): CardAuthEvent[] {
  return events
    .filter((e) => e.transactionIndex !== null && payments.some((p) => p.index === e.transactionIndex))
    .sort(byTime);
}

/**
 * Step 8: the payments authenticated through 3-D Secure with the activated token, by either route the brief names:
 * - the payment's record names the device the token was activated on (device reference), or
 * - the payment's record states it was approved with that token (`tokenRef` on both records).
 * Only 3-D Secure payments count, because the step 8 line says "authenticated through 3-D Secure".
 */
export function linkedPayments(anchor: AccessEvent | null, events: CardAuthEvent[]): CardAuthEvent[] {
  if (!anchor || anchor.kind !== "token_activated" || (!anchor.deviceRef && !anchor.tokenRef)) return [];
  return events.filter((e) =>
    isThreeDs(e.authentication) &&
    ((anchor.deviceRef !== null && e.deviceRef === anchor.deviceRef) || (anchor.tokenRef !== null && e.tokenRef === anchor.tokenRef))
  );
}

/** The scheme statement keys for one scheme's payments (4f "Scheme lines"; Phase 7 keys), in print order. */
export function schemeStatementKeys(scheme: HeldScheme, events: CardAuthEvent[]): StatementKey[] {
  const keys: StatementKey[] = [];
  const add = (k: StatementKey) => {
    if (!keys.includes(k)) keys.push(k);
  };
  for (const e of events) {
    const authenticated = e.authenticationResult === "authenticated";
    const attempted = e.authenticationResult === "attempted";
    if (e.entryMode === "ecommerce" && isThreeDs(e.authentication)) {
      if (scheme === "visa") {
        if (authenticated) add("visa.3ds.authenticated");
        else if (attempted) add("visa.3ds.attempted");
      } else if (authenticated) add("mc.authenticated");
    } else if (e.entryMode === "wallet_token" && e.authentication === "wallet_device" && authenticated) {
      add(scheme === "visa" ? "visa.token.authenticated" : "mc.authenticated");
    } else if (scheme === "mastercard" && e.authentication === "pin") {
      add("mc.pin");
    }
    if (e.authentication === "none_recorded") {
      if (scheme === "visa") {
        add("visa.dispute.permitted");
        add("visa.report");
        add("visa.no3ds");
      } else {
        add("mc.dispute.permitted");
        add("mc.report");
      }
    }
  }
  if (keys.length) add(scheme === "visa" ? "visa.cardholder" : "mc.cardholder");
  return keys;
}

async function buildSequence(input: SectionInput): Promise<SectionResult> {
  const out = new SectionWriter("account_access_sequence", input);
  const access = [...(factValue(input, "access_events") ?? [])].sort(byTime);
  const cardEvents = [...(factValue(input, "card_auth_events") ?? [])].sort(byTime);
  const recognition = factValue(input, "device_recognition") ?? [];
  const cardPayments = input.payments.filter(isCardPayment);
  const accessIds = evidenceFor(input, "access_events");
  const cardIds = evidenceFor(input, "card_auth_events");

  // Step 1: how the credentials, card details or code were given, in the confirmed wording.
  const credentials = factValue(input, "credentials_or_otp_shared");
  if (credentials && CREDENTIALS_STATED[credentials]) {
    out.text(`The complainant states that ${CREDENTIALS_STATED[credentials]}.`, {
      step: 1,
      evidenceIds: evidenceFor(input, "credentials_or_otp_shared"),
    });
  } else {
    out.text("The records provided do not show how the credentials, card details or code were given.", { step: 1 });
  }

  // Step 2: the token activation (or device registration) the sequence starts from.
  const anchor = sequenceAnchor(access);
  if (anchor) {
    const at = anchor.timestamp ? ` at ${formatDateTime(anchor.timestamp)}` : "";
    const device = anchor.deviceLabel ? ` on a device labelled '${anchor.deviceLabel}'` : "";
    const what = anchor.kind === "token_activated" ? "a digital token activated" : "a device registered";
    let line = `The institution's record shows ${what}${at}${device}.`;
    if (anchor.authorisedBy) {
      line += ` The record shows the ${anchor.kind === "token_activated" ? "activation" : "registration"} was authorised by ${anchor.authorisedBy}`;
      line += anchor.sentTo ? `, sent to ${anchor.sentTo}.` : ".";
    }
    out.text(line, { step: 2, evidenceIds: accessIds });

    // Step 3: the complainant's statement about that device.
    const answer = recognition.find((r) => sameDevice(r, anchor))?.answer;
    const stated = answer
      ? deviceRecognitionSentence(answer, null)
      : "The records provided do not show the complainant's statement about this device.";
    out.text(stated, { step: 3, evidenceIds: answer ? evidenceFor(input, "device_recognition") : [] });

    // Step 4: an alert about the activation: the first alert not tied to a payment, at or after the activation and
    // before the next recorded event that is not an alert or a one-time code.
    const after = access.filter((e) => e !== anchor && anchor.timestamp !== null && e.timestamp !== null && e.timestamp >= anchor.timestamp);
    let alert: AccessEvent | null = null;
    for (const e of after) {
      if (e.kind === "alert_sent" && e.relatedTransactionIndex === null) {
        alert = e;
        break;
      }
      if (e.kind !== "alert_sent" && e.kind !== "otp_sent") break;
    }
    if (alert) {
      const to = alert.sentTo ? ` to ${alert.sentTo}` : "";
      out.text(`The record shows an alert about the ${anchor.kind === "token_activated" ? "activation" : "registration"} sent at ${formatDateTime(alert.timestamp!)}${to}.`, {
        step: 4,
        evidenceIds: accessIds,
      });
    } else {
      out.text(`The records provided do not show an alert about the ${anchor.kind === "token_activated" ? "activation" : "registration"}.`, { step: 4 });
    }

    // Step 5: logins and high-risk activities from that device, one line each.
    const fromDevice = after.filter((e) => HIGH_RISK_OR_LOGIN.has(e.kind) && sameDevice(e, anchor));
    if (fromDevice.length === 0) {
      out.text("The records provided do not show logins or high-risk activities from this device.", { step: 5 });
    }
    for (const e of fromDevice) {
      const by = e.authorisedBy ? `, authorised by ${e.authorisedBy}` : "";
      out.text(`The record shows ${ACCESS_EVENT_WORDS[e.kind]} at ${formatDateTime(e.timestamp!)} from this device${by}.`, {
        step: 5,
        evidenceIds: accessIds,
      });
    }
  } else {
    out.text("The records provided do not show a digital token activated or a device registered.", { step: 2 });
  }

  // Steps 6-8 and the scheme lines concern card payments only.
  if (cardPayments.length > 0) {
    const last4s = [...new Set(cardPayments.map((p) => p.last4).filter((v): v is string => !!v))];
    const cardName = last4s.length === 1 ? `the card ending ${last4s[0]}` : "the card";

    // Step 6: wallet provisioning.
    const provisioned = cardEvents.filter((e) => e.walletProvisionedAt);
    if (provisioned.length === 0) {
      out.text("The records provided do not show the card added to a mobile wallet.", { step: 6 });
    }
    for (const e of provisioned) {
      const device = e.walletDeviceLabel ? ` on a device labelled '${e.walletDeviceLabel}'` : "";
      const method = e.walletProvisioningAuthentication ? WALLET_METHOD[e.walletProvisioningAuthentication] : null;
      const sent = method && e.walletProvisioningSentTo ? `, sent to ${e.walletProvisioningSentTo}` : "";
      const by = method ? `, authorised by ${method}${sent}.` : ". The record does not show how it was authorised.";
      out.text(`The record shows ${cardName} added to a mobile wallet at ${formatDateTime(e.walletProvisionedAt!)}${device}${by}`, {
        step: 6,
        evidenceIds: cardIds,
      });
    }

    // Step 7: the card payments, grouped by authentication method (and result).
    const paid = cardPaymentEvents(cardEvents, input.payments);
    const groups = new Map<string, CardAuthEvent[]>();
    for (const e of paid) {
      const key = `${e.authentication}|${e.authenticationResult === "attempted" ? "attempted" : ""}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    for (const group of groups.values()) {
      const first = group[0];
      const amounts = group.map((e) => input.payments.find((p) => p.index === e.transactionIndex)!.amount);
      const n = group.length;
      const times = group.map((e) => e.timestamp).filter((t): t is string => !!t);
      const when = times.length === 0
        ? ""
        : n === 1 || times[0] === times[times.length - 1]
        ? ` at ${formatDateTime(times[0])}`
        : ` between ${formatDateTime(times[0])} and ${formatDateTime(times[times.length - 1])}`;
      const what = n === 1 ? `1 card payment of ${formatMoneyTotal(amounts)}` : `${n} card payments totalling ${formatMoneyTotal(amounts)}`;
      const labels = [...new Set(group.map((e) => e.deviceLabel))];
      const onDevice = first.authentication === "wallet_device" && labels.length === 1 && labels[0]
        ? ` on the device labelled '${labels[0]}'`
        : "";
      const method = CARD_AUTH_METHOD[first.authentication];
      const how = method
        ? `, authenticated by ${method}${onDevice}${first.authenticationResult === "attempted" ? " (the record shows authentication attempted)" : ""}.`
        : first.authentication === "none_recorded"
        ? `, with no authentication recorded.`
        : `. The record does not show how ${n === 1 ? "it was" : "they were"} authenticated.`;
      out.text(`The record shows ${what}${when}${how}`, { step: 7, evidenceIds: cardIds });
    }
    const unrecorded = cardPayments.filter((p) => !paid.some((e) => e.transactionIndex === p.index)).length;
    if (unrecorded > 0) {
      out.text(
        unrecorded === cardPayments.length
          ? "The records provided do not show how the card payments were authenticated."
          : `The records provided do not show how ${unrecorded} of the card payments ${unrecorded === 1 ? "was" : "were"} authenticated.`,
        { step: 7 },
      );
    }

    // Step 8: the link between the token (step 2) and the payments (step 7).
    const linked = linkedPayments(anchor, paid);
    if (linked.length > 0 && anchor?.timestamp) {
      out.text(
        `On the records provided, ${linked.length} of these payments ${linked.length === 1 ? "was" : "were"} authenticated through 3-D Secure using the digital token activated at ${formatDateTime(anchor.timestamp)}.`,
        { step: 8, evidenceIds: [...accessIds, ...cardIds.filter((id) => !accessIds.includes(id))] },
      );
    } else {
      out.text("The records provided do not show which device or token authenticated these payments.", { step: 8 });
    }
  }

  // Step 9: report and block.
  const reported = factValue(input, "reported_to_bank");
  const cardOnly = input.payments.length > 0 && input.payments.every(isCardPayment);
  const blockedWhat = cardOnly ? "the card" : "access to the account";
  const block = access.find((e) => e.kind === "account_blocked" && e.timestamp);
  const reportLine = reported && reported.value === "yes" && reported.date
    ? `The complainant reported to the institution on ${formatDate(reported.date)}.`
    : "The records provided do not show when the complainant reported to the institution.";
  const blockLine = block
    ? `The record shows ${blockedWhat} blocked at ${formatDateTime(block.timestamp!)}.`
    : `The records provided do not show ${blockedWhat} blocked.`;
  out.text(`${reportLine} ${blockLine}`, {
    step: 9,
    evidenceIds: [...evidenceFor(input, "reported_to_bank"), ...(block ? accessIds : [])].filter((v, i, a) => a.indexOf(v) === i),
  });

  if (cardPayments.length > 0) {
    await schemeLines(out, input, cardEvents);
    responseLine(out, input);
  }

  return out.result();
}

/**
 * Scheme lines after step 9: per scheme, by statement key only. The edition in force on the payment date when held;
 * otherwise the nearest edition held (3.2 rule 6; Decision 12), after the fallback line, with the statements read for
 * that edition (a statement approved for one edition does not print for another, 3.2 rule 8). Then the card
 * loss-sharing statement (`bridge.card_loss_sharing`, Decision 9).
 */
async function schemeLines(out: SectionWriter, input: SectionInput, cardEvents: CardAuthEvent[]): Promise<void> {
  const paid = cardPaymentEvents(cardEvents, input.payments);
  const cardIds = evidenceFor(input, "card_auth_events");
  let standingPrinted = false;
  let anySchemeLine = false;
  let firstDate: IsoDate | null = null;
  for (const scheme of ["visa", "mastercard"] as const) {
    const events = paid.filter((e) => e.cardScheme === scheme);
    if (events.length === 0) continue;
    const onDate = earliestDate(events.map((e) => input.payments.find((p) => p.index === e.transactionIndex)?.date ?? e.timestamp));
    if (!onDate) continue;
    const keys = schemeStatementKeys(scheme, events);
    if (keys.length === 0) continue;
    const nearest = await out.nearestClause(SCHEME_ANCHOR_CLAUSE_KEYS[scheme], onDate);
    if (!nearest) {
      // No edition of the scheme's rules is held at all.
      out.text(`This pack does not hold ${SCHEME_NAMES[scheme]}'s rules in force on ${formatDate(onDate)}.`);
      continue;
    }
    const anchor = nearest.clause;
    firstDate ??= onDate;
    anySchemeLine = true;
    if (!standingPrinted) {
      out.text(SCHEME_STANDING_SENTENCE);
      standingPrinted = true;
    }
    // The date the statements are read for: the payment date, or the nearest edition's own date.
    const readOn: IsoDate = nearest.relation === "in_force" ? onDate : anchor.effective_from;
    if (nearest.relation !== "in_force") {
      out.text(NEAREST_VERSION_FALLBACK(SCHEME_NAMES[scheme], onDate, anchor.effective_from), { clauseKeys: [anchor.clause_key] });
    }
    if (anchor.coverage === "selected_sections") {
      out.text(
        `This pack holds selected sections of ${SCHEME_NAMES[scheme]}'s rules, edition dated ${formatDate(anchor.effective_from)}, on how unauthorised payments are handled. It does not hold the full rules.`,
        { clauseKeys: [anchor.clause_key] },
      );
    }
    for (const key of keys) await out.statement(key, readOn, cardIds);
  }
  if (anySchemeLine && firstDate) await out.statement(CARD_LOSS_SHARING_STATEMENT_KEY, firstDate);
}

/** The institution's response (Phase 7), from its letters only. */
function responseLine(out: SectionWriter, input: SectionInput): void {
  const response = factValue(input, "card_dispute_response");
  const ids = evidenceFor(input, "card_dispute_response");
  if (response?.status === "raised") {
    out.text(`The institution's letter states that it raised a dispute${response.date ? ` on ${formatDate(response.date)}` : ""}.`, { evidenceIds: ids });
  } else if (response?.status === "declined") {
    out.text(
      response.reasonStated
        ? `The institution's letter states that it did not raise a dispute because '${response.reasonStated}'.`
        : "The institution's letter states that it did not raise a dispute.",
      { evidenceIds: ids },
    );
  } else {
    out.text("The institution's letters do not say whether it raised a dispute.");
  }
}

export const buildAccountAccessSequence: SectionBuilder = buildSequence;
