// Industry practice comparison, layer 3 (FIDReC standards brief v5, 4c), and the wallet check (review of 24 Nov 2026,
// Decision 5). Section `industry_practice_comparison`.
//
// Announced measures: same form as 4a, using only measures whose stated start date is on or before the event. Each
// line reads its clause as of the event's own date, and a measure not yet in force on that date prints no line. No link
// statement follows these lines: announced measures are not requirements imposed by MAS (4a, decision 20).
//
// - Token activation (MAS–ABS releases of 2022): delay before a new token is activated, and the alert to the existing
//   contact. No source is loaded yet, so both checks have no key and the run flags them as not held. The delay is read
//   from the loaded clause text, never written here.
// - Card added to a mobile wallet (Decision 5): a record line, then
//   Part A: the institution's own published page (term request, purpose `wallet_provisioning`), with an outcome;
//   Part B: the MAS written reply of 13 January 2026, quoted through `mas.reply.20260113.wallet`, any date, no outcome;
//   Part C: the ABS media statement of 17 February 2025 (verification; removal), the existing 4c rows;
//   Part D: pointers.

import type { AccountType } from "../keys.ts";
import {
  type AccessEvent,
  type CardAuthEvent,
  type ClauseAsOf,
  type ComparisonOutcome,
  type DisputedPayment,
  documentDatedAfterEvents,
  type IsoDate,
  NAMED_CLAUSE_KEYS,
  readDateFor,
  type SectionBuilder,
  type SectionInput,
  type SectionResult,
  TWELVE_HOUR_BLOCK_HEADINGS,
  WALLET_PROVISIONING_PURPOSE,
  type WalletProvisioningAuthentication,
  type WalletProvisioningPractice,
} from "../update/contract.ts";
import { formatDate, formatDateTime as formatTime, formatGap } from "../update/section-writer.ts";
import { alertFor, eventWords } from "./duty-time-checks.ts";
import {
  NO_TERM_REQUESTS,
  productsForPayment,
  resolveTermRequest,
  type TermPurpose,
  type TermRequestRow,
  type TermRequestSource,
} from "./institution-terms.ts";
import {
  BRIDGE_STATEMENT_KEYS,
  ComparisonWriter,
  earliestDate,
  evidenceFor,
  factValue,
  HOUR,
  localDate,
  ms,
  type PaymentGroup,
  paymentsIn,
} from "./link-statements.ts";

/** The clause each check compares against; null until the measure is loaded and keyed. */
export interface IndustryPracticeClauseKeys {
  /** MAS-ABS releases of 2022: a delay before a new soft token is activated (not loaded yet). */
  tokenActivationDelay: string | null;
  /** MAS-ABS releases of 2022: notification to the existing contact (not loaded yet). */
  tokenActivationAlert: string | null;
  /** ABS media statement of 17 Feb 2025: verification beyond the SMS one-time code to add a card to a mobile wallet. */
  walletProvisioningVerification: string | null;
  /** ABS media statement of 17 Feb 2025: removal of provisioned cards where there are signs of fraud. */
  walletTokenRemoval: string | null;
}

export const INDUSTRY_PRACTICE_CLAUSE_KEYS: Readonly<IndustryPracticeClauseKeys> = {
  tokenActivationDelay: null,
  tokenActivationAlert: null,
  walletProvisioningVerification: NAMED_CLAUSE_KEYS.absProvisioningVerification,
  walletTokenRemoval: NAMED_CLAUSE_KEYS.absProvisioningRemoval,
};

/** ABS release of 17 Feb 2025: completion expected by July 2025, so provisioning before August 2025 is before it. */
export const WALLET_VERIFICATION_EXPECTED_BY: IsoDate = "2025-08-01";

/** Decision 5: the group heading, verbatim. */
export const WALLET_CHECK_HEADING = "Card added to a mobile wallet";

/** Decision 5, Part B (Decision 9 key). */
export const WALLET_REPLY_STATEMENT_KEY = "mas.reply.20260113.wallet";
/** The document Part B rests on; read whatever the event date when the corpus marks it `any_date` (Decision 6). */
export const WALLET_REPLY_DOCUMENT_KEY = "mas.reply.20260113";

/** Decision 5, Part D, verbatim. */
export const WALLET_DEFINITIONS_POINTER =
  `The definitions of high-risk activities in the SRF Guidelines and the E-Payments User Protection Guidelines are set out under '${TWELVE_HOUR_BLOCK_HEADINGS.block}'.`;

/**
 * A `wallet_provisioning` term-request row: Lane 4's row plus what a person recorded from the page (Decision 5, Part
 * A; contract `WalletProvisioningPractice`). `wallet_practice` is null until a person has recorded it. The field name is
 * Lane 3's proposal; Lane 5's seed rows and Lane 1's table decide it.
 */
export type WalletProvisioningRequestRow = TermRequestRow & { wallet_practice?: WalletProvisioningPractice | null };

export interface IndustryPracticeCheckOptions {
  clauseKeys?: Partial<IndustryPracticeClauseKeys>;
  /** The configured term requests (Lane 4's source). None by default: Part A then prints the "not held" line. */
  termRequests?: TermRequestSource;
  /** The day the pack is generated, for documents read whatever the event date (Decision 6). Default: today (UTC). */
  generatedOn?: IsoDate;
}

/** The request the activation answers: the first one-time code or device registration since any earlier activation. */
export function activationRequest(activation: AccessEvent, access: readonly AccessEvent[]): AccessEvent | null {
  const t = ms(activation.timestamp);
  if (t === null) return null;
  const sorted = access.filter((e) => ms(e.timestamp) !== null).sort((a, b) => ms(a.timestamp)! - ms(b.timestamp)!);
  const previous = sorted.filter((e) => e.kind === "token_activated" && ms(e.timestamp)! < t).pop();
  const since = previous ? ms(previous.timestamp)! : -Infinity;
  return sorted
    .filter((e) => ms(e.timestamp)! <= t && ms(e.timestamp)! > since)
    .filter((e) => e.kind === "otp_sent" || (e.kind === "device_registered" && (!e.deviceRef || e.deviceRef === activation.deviceRef)))
    .shift() ?? null;
}

/**
 * The number of hours a clause states, read from its own text ("12 hours", "12-hour"). Null where the text states none
 * or more than one figure: the line then does not print and the run is flagged for a person to look at.
 */
export function hoursStatedIn(text: string): number | null {
  const figures = new Set([...text.matchAll(/\b(\d{1,3})(?:\s|-)hours?\b/gi)].map((m) => Number(m[1])));
  return figures.size === 1 ? [...figures][0] : null;
}

const AUTH_WORDS: Record<Exclude<WalletProvisioningAuthentication, "not_known">, string> = {
  sms_otp: "an SMS one-time code",
  in_app: "approval in the institution's app",
  digital_token: "the digital token",
};

const methodWords = (method: WalletProvisioningAuthentication | null): string | null =>
  method && method !== "not_known" ? AUTH_WORDS[method] : null;
const labelled = (label: string | null) => (label ? ` on a device labelled '${label}'` : "");
const cite = (ids: readonly string[]) => (ids.length ? ` (${ids.join(", ")})` : "");

/** The latest token activation at or before a time. */
function activationBefore(access: readonly AccessEvent[], at: number): AccessEvent | null {
  const before = access.filter((e) => e.kind === "token_activated" && ms(e.timestamp) !== null && ms(e.timestamp)! <= at);
  return before.sort((a, b) => ms(a.timestamp)! - ms(b.timestamp)!).pop() ?? null;
}

export function createIndustryPracticeChecks(options: IndustryPracticeCheckOptions = {}): SectionBuilder {
  const keys: IndustryPracticeClauseKeys = { ...INDUSTRY_PRACTICE_CLAUSE_KEYS, ...options.clauseKeys };
  const termRequests = options.termRequests ?? NO_TERM_REQUESTS;
  return async (input: SectionInput): Promise<SectionResult> => {
    const w = new ComparisonWriter("industry_practice_comparison", input);
    const generatedOn = options.generatedOn ?? new Date().toISOString().slice(0, 10);
    const account = paymentsIn(input.payments, "account");
    const card = paymentsIn(input.payments, "card");
    if (!input.payments.length) return w.result();
    const access = factValue(input.facts, "access_events");
    const cards = factValue(input.facts, "card_auth_events");
    const firstDate = earliestDate(input.payments.map((p) => p.date));

    /** Only a measure in force on the event's date prints; a check with no key yet records that it is waiting. */
    const inForce = async (name: keyof IndustryPracticeClauseKeys, onDate: IsoDate | null): Promise<string | null> => {
      const key = keys[name];
      if (!key) {
        await w.clauseText(`industry_practice.${name}`, onDate);
        return null;
      }
      if (!onDate) return key;
      return (await input.provider.getClauseAsOf(key, onDate)) ? key : null;
    };

    // Token activation: delay and alert to the existing contact.
    const tokenGroup: PaymentGroup = account.length ? "account" : "card";
    const tokenPayments: readonly DisputedPayment[] = account.length ? account : card;
    const accessEv = evidenceFor(input, "access_events");
    const activations = (access ?? []).filter((e) => e.kind === "token_activated" && e.timestamp).sort((a, b) => ms(a.timestamp)! - ms(b.timestamp)!);
    if (!access) {
      for (const name of ["tokenActivationDelay", "tokenActivationAlert"] as const) {
        const clauseKey = await inForce(name, firstDate);
        if (clauseKey) {
          await w.compare({ clauseKey, onDate: firstDate, record: "The records provided include no record from the institution of logins, devices and alerts.", outcome: "not_shown", evidenceIds: [], group: tokenGroup, payments: tokenPayments });
        }
      }
    }
    for (const activation of activations) {
      const onDate = localDate(activation.timestamp!);
      const delayKey = await inForce("tokenActivationDelay", onDate);
      if (delayKey) {
        // The delay is the figure the release states, read from the loaded text (review of 24 Nov 2026, Lane 3 issue 2).
        const clause = await w.clause(delayKey, onDate);
        const hours = clause ? hoursStatedIn(clause.text_content) : null;
        if (hours === null) {
          w.flag("clause_not_held", delayKey, onDate);
        } else {
          const request = activationRequest(activation, access!);
          const record = request
            ? `The record shows ${request.kind === "otp_sent" ? "a one-time code sent" : "a device registered"} at ${formatTime(request.timestamp!)} and ${eventWords(activation)}, ${formatGap(ms(activation.timestamp)! - ms(request.timestamp)!)} later.`
            : `The record shows ${eventWords(activation)}. It does not show when the activation was requested.`;
          const outcome = !request ? "not_shown" : ms(activation.timestamp)! - ms(request.timestamp)! < hours * HOUR ? "differs" : "matches";
          await w.compare({ clauseKey: delayKey, onDate, record, outcome, evidenceIds: accessEv, group: tokenGroup, payments: tokenPayments });
        }
      }
      const alertKey = await inForce("tokenActivationAlert", onDate);
      if (alertKey) {
        const alert = alertFor(activation, access!);
        const record = alert
          ? `The record shows ${eventWords(activation)} and an alert sent at ${formatTime(alert.timestamp!)}${alert.sentTo ? ` to ${alert.sentTo}` : ""}.`
          : `The record shows ${eventWords(activation)} and no alert between it and the next recorded event.`;
        await w.compare({ clauseKey: alertKey, onDate, record, outcome: alert ? "matches" : "differs", evidenceIds: accessEv, group: tokenGroup, payments: tokenPayments });
      }
    }

    // Card added to a mobile wallet.
    if (!card.length) return w.result();
    const cardEv = evidenceFor(input, "card_auth_events");
    if (!cards) {
      for (const name of ["walletProvisioningVerification", "walletTokenRemoval"] as const) {
        const clauseKey = await inForce(name, firstDate);
        if (clauseKey) {
          await w.compare({ clauseKey, onDate: firstDate, record: "The records provided include no record from the institution of how card payments were authenticated.", outcome: "not_shown", evidenceIds: [], group: "card", payments: card });
        }
      }
      return w.result();
    }
    const provisionings = cards.filter((e) => e.walletProvisionedAt && ms(e.walletProvisionedAt) !== null);
    if (!provisionings.length) return w.result();

    w.text(WALLET_CHECK_HEADING, { evidenceIds: cardEv });
    const report = factValue(input.facts, "reported_to_bank");
    const institutionName = input.institution?.name ?? factValue(input.facts, "institution_names")?.[0]?.name ?? null;
    const last4s = [...new Set(card.map((p) => p.last4).filter((x): x is string => Boolean(x)))];
    const cardWords = last4s.length === 1 ? `the card ending ${last4s[0]}` : "the card";
    const accountTypes: AccountType[] = factValue(input.facts, "account_types") ?? [];

    for (const provisioning of provisionings) {
      const onDate = localDate(provisioning.walletProvisionedAt!);
      const addedAt = ms(provisioning.walletProvisionedAt)!;
      const activation = access ? activationBefore(access, addedAt) : null;

      // Record line, once above the group (Decision 5, verbatim form).
      const method = methodWords(provisioning.walletProvisioningAuthentication);
      const sentences = [
        `The record shows ${cardWords} added to a mobile wallet at ${formatTime(provisioning.walletProvisionedAt!)}${labelled(provisioning.walletDeviceLabel)}${method ? `, authorised by ${method}` : ""}${cite(cardEv)}.`,
      ];
      if (activation) {
        sentences.push(`The record shows a digital token activated at ${formatTime(activation.timestamp!)}${labelled(activation.deviceLabel)}${cite(accessEv)}, ${formatGap(addedAt - ms(activation.timestamp)!)} before.`);
      }
      w.text(sentences.join(" "), { evidenceIds: evidenceFor(input, "card_auth_events", ...(activation ? (["access_events"] as const) : [])) });

      // Part A: the institution's own published page.
      await partA(w, {
        institutionCode: input.institution?.code ?? null,
        institutionName,
        products: productsForPayment(card[0], accountTypes),
        termRequests,
        provider: input.provider,
        onDate,
        provisioning,
        activation,
        evidenceIds: evidenceFor(input, "card_auth_events", "access_events"),
      });

      // Part B: the MAS written reply of 13 January 2026, whatever the date of the event (Decision 6).
      const rule = await input.provider.getAsOfRule(WALLET_REPLY_DOCUMENT_KEY);
      const readOn = readDateFor(rule, onDate, generatedOn);
      const reply = await w.readStatement(WALLET_REPLY_STATEMENT_KEY, readOn);
      let after: IsoDate | null = null;
      for (const key of reply.clauseKeys) {
        const clause = await input.provider.getClauseAsOf(key, readOn);
        if (clause) {
          const eventDates = [...input.payments.map((p) => p.date), onDate, report?.value === "yes" ? report.date : null];
          after = documentDatedAfterEvents(clause.effective_from, eventDates);
          break;
        }
      }
      await w.statement(WALLET_REPLY_STATEMENT_KEY, readOn, cardEv, { documentDatedAfterEvents: after });

      // Part C: the ABS media statement of 17 February 2025 (the existing 4c rows).
      const added = `The record shows the card added to a mobile wallet at ${formatTime(provisioning.walletProvisionedAt!)}${labelled(provisioning.walletDeviceLabel)}`;
      const verificationKey = await inForce("walletProvisioningVerification", onDate);
      if (verificationKey) await w.compare({ clauseKey: verificationKey, onDate, ...walletVerification(provisioning, added), evidenceIds: cardEv, group: "card", payments: card });

      const removalKey = await inForce("walletTokenRemoval", onDate);
      if (removalKey) {
        const reported = report?.value === "yes" && report.date ? ` The complainant reported to the institution on ${formatDate(report.date)}.` : "";
        const record = provisioning.walletTokenRemovedAt
          ? `${added}.${reported} The record shows the card removed from the wallet at ${formatTime(provisioning.walletTokenRemovedAt)}.`
          : `${added}.${reported} The record does not show the card being removed from the wallet.`;
        await w.compare({
          clauseKey: removalKey,
          onDate,
          record,
          outcome: provisioning.walletTokenRemovedAt ? "matches" : "not_shown",
          evidenceIds: evidenceFor(input, "card_auth_events", "reported_to_bank"),
          group: "card",
          payments: card,
        });
      }
    }

    // Part D: pointers.
    w.text(WALLET_DEFINITIONS_POINTER);
    await w.statementOn(BRIDGE_STATEMENT_KEYS.cardLossSharing, earliestDate(card.map((p) => p.date)), cardEv);
    return w.result();
  };
}

interface PartAArgs {
  institutionCode: string | null;
  institutionName: string | null;
  products: ReturnType<typeof productsForPayment>;
  termRequests: TermRequestSource;
  provider: SectionInput["provider"];
  onDate: IsoDate;
  provisioning: CardAuthEvent;
  activation: AccessEvent | null;
  evidenceIds: string[];
}

/**
 * Decision 5, Part A. Only the case institution's own page, read through its `wallet_provisioning` term request in the
 * version for the date the card was added; one institution's page is never set against another. No link statement.
 */
async function partA(w: ComparisonWriter, a: PartAArgs): Promise<void> {
  let held: { row: WalletProvisioningRequestRow; clauses: ClauseAsOf[] } | null = null;
  for (const product of a.products) {
    // `wallet_provisioning` is not in Lane 4's TermPurpose yet (contract TERM_REQUEST_PURPOSES, PR #56, will carry it).
    const resolved = await resolveTermRequest(a.termRequests, a.provider, {
      institution: a.institutionCode,
      product,
      purpose: WALLET_PROVISIONING_PURPOSE as unknown as TermPurpose,
      onDate: a.onDate,
    });
    if (resolved.status !== "held") continue;
    const own = resolved.clauses.every((c) => a.institutionCode !== null && c.institution === a.institutionCode);
    if (resolved.request.institution === a.institutionCode && own) {
      held = { row: resolved.request as WalletProvisioningRequestRow, clauses: resolved.clauses };
      break;
    }
  }
  if (!held) {
    // Decision 5, verbatim.
    w.text(`${a.institutionName ?? "The institution"}'s published practice on adding cards to mobile wallets is not held.`);
    return;
  }
  const practice = held.row.wallet_practice ?? null;
  // A page held but with nothing recorded yet by a person: no comparison (open, see the PR).
  if (!practice) return;
  for (const clause of held.clauses) w.cite(clause, a.onDate);
  const expected = held.clauses.map((c) => c.text_content).join("\n\n");
  const clauseKey = held.clauses[0].clause_key;
  for (const row of walletPracticeRows(practice, a.provisioning, a.activation)) {
    w.comparison({ clauseKey, record: row.record, expected, outcome: row.outcome, evidenceIds: a.evidenceIds });
  }
}

/**
 * Decision 5, Part A outcomes, chosen by code: the waiting period after the token activation, then the authentication
 * required; `not_applicable` (printing both dates) where the card was added before the page's stated start date.
 */
export function walletPracticeRows(
  practice: WalletProvisioningPractice,
  provisioning: CardAuthEvent,
  activation: AccessEvent | null,
): Array<{ record: string; outcome: ComparisonOutcome }> {
  const addedOn = localDate(provisioning.walletProvisionedAt!);
  if (practice.appliesFrom && addedOn < practice.appliesFrom) {
    // wording awaiting Elena's approval
    return [{ record: `The card was added to a mobile wallet on ${formatDate(addedOn)}. The page states a start date of ${formatDate(practice.appliesFrom)}.`, outcome: "not_applicable" }];
  }
  const rows: Array<{ record: string; outcome: ComparisonOutcome }> = [];
  const addedAt = formatTime(provisioning.walletProvisionedAt!);
  if (practice.waitingPeriodHours !== "none_stated") {
    if (!activation) {
      // wording awaiting Elena's approval
      rows.push({ record: `The record shows the card added to a mobile wallet at ${addedAt}. It does not show when the digital token was activated.`, outcome: "not_shown" });
    } else {
      const gap = ms(provisioning.walletProvisionedAt)! - ms(activation.timestamp)!;
      // wording awaiting Elena's approval
      rows.push({
        record: `The record shows a digital token activated at ${formatTime(activation.timestamp!)} and the card added to a mobile wallet at ${addedAt}, ${formatGap(gap)} later.`,
        outcome: gap < practice.waitingPeriodHours * HOUR ? "differs" : "matches",
      });
    }
  }
  if (practice.authenticationRequired !== "none_stated") {
    const method = methodWords(provisioning.walletProvisioningAuthentication);
    // wording awaiting Elena's approval
    rows.push(
      method
        ? {
          record: `The record shows the card added to a mobile wallet at ${addedAt}, authorised by ${method}.`,
          outcome: provisioning.walletProvisioningAuthentication === practice.authenticationRequired ? "matches" : "differs",
        }
        : { record: `The record shows the card added to a mobile wallet at ${addedAt}. It does not show how adding the card was authorised.`, outcome: "not_shown" },
    );
  }
  return rows;
}

/**
 * ABS release of 17 Feb 2025: verification beyond the SMS one-time code. Provisioning before August 2025 is before the
 * expected completion date (July 2025), so the line is `not_applicable` and prints the date.
 */
export function walletVerification(provisioning: CardAuthEvent, added: string): { record: string; outcome: ComparisonOutcome } {
  const method = provisioning.walletProvisioningAuthentication;
  if (!method || method === "not_known") return { record: `${added}. The record does not show how adding the card was verified.`, outcome: "not_shown" };
  const sentTo = provisioning.walletProvisioningSentTo ? `, sent to ${provisioning.walletProvisioningSentTo}` : "";
  const record = `${added}, verified by ${AUTH_WORDS[method]}${sentTo}.`;
  if (method !== "sms_otp") return { record, outcome: "matches" };
  if (localDate(provisioning.walletProvisionedAt!) < WALLET_VERIFICATION_EXPECTED_BY) {
    return { record: `${record} The card was added on ${formatDate(localDate(provisioning.walletProvisionedAt!))}.`, outcome: "not_applicable" };
  }
  return { record, outcome: "differs" };
}

/** Section `industry_practice_comparison` (brief 4c; Decision 5), with the clause keys held so far. */
export const buildIndustryPracticeChecks: SectionBuilder = createIndustryPracticeChecks();
