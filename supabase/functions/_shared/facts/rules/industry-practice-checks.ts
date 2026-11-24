// Industry practice comparison, layer 3 (FIDReC standards brief v5, 4c). Section `industry_practice_comparison`.
//
// Same form as 4a, against dated announced measures, using only measures whose stated start date is on or before the
// event: each line reads its clause as of the event's own date, and a measure not yet in force on that date prints no
// line. The clause keys are located at ingestion (contract CLAUSE_KEYS note: the MAS-ABS releases of 2022 and the ABS
// release of 17 Feb 2025); until Lane 6 adds them, each check has no key and the section records which are waiting.
//
// No link statement follows these lines: announced measures are not requirements imposed by MAS (4a, decision 20).

import type { AccessEvent, CardAuthEvent, DisputedPayment, IsoDate, SectionBuilder, SectionInput, SectionResult } from "../update/contract.ts";
import { alertFor, eventWords } from "./duty-time-checks.ts";
import {
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
  SectionWriter,
} from "./link-statements.ts";

/** The clause each check compares against; null until the measure is loaded and keyed. */
export interface IndustryPracticeClauseKeys {
  /** MAS-ABS release of 19 Jan 2022: a delay before a new soft token is activated. */
  tokenActivationDelay: string | null;
  /** MAS-ABS releases of 2022: notification to the existing contact. */
  tokenActivationAlert: string | null;
  /** ABS release of 17 Feb 2025: verification beyond the SMS one-time code to add a card to a mobile wallet. */
  walletProvisioningVerification: string | null;
  /** ABS release of 17 Feb 2025: removal of provisioned cards where there are signs of fraud. */
  walletTokenRemoval: string | null;
}

export const INDUSTRY_PRACTICE_CLAUSE_KEYS: Readonly<IndustryPracticeClauseKeys> = {
  tokenActivationDelay: null,
  tokenActivationAlert: null,
  walletProvisioningVerification: null,
  walletTokenRemoval: null,
};

/** MAS-ABS release of 19 Jan 2022: at least 12 hours before a new soft token is activated. */
export const TOKEN_ACTIVATION_DELAY_MS = 12 * HOUR;
/** ABS release of 17 Feb 2025: completion expected by July 2025, so provisioning before August 2025 is before it. */
export const WALLET_VERIFICATION_EXPECTED_BY: IsoDate = "2025-08-01";

export interface IndustryPracticeCheckOptions {
  clauseKeys?: Partial<IndustryPracticeClauseKeys>;
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

const AUTH_WORDS: Record<string, string> = {
  sms_otp: "an SMS one-time code",
  in_app: "approval in the institution's app",
  digital_token: "the digital token",
};

export function createIndustryPracticeChecks(options: IndustryPracticeCheckOptions = {}): SectionBuilder {
  const keys: IndustryPracticeClauseKeys = { ...INDUSTRY_PRACTICE_CLAUSE_KEYS, ...options.clauseKeys };
  return async (input: SectionInput): Promise<SectionResult> => {
    const w = new SectionWriter("industry_practice_comparison", input.provider);
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
        const request = activationRequest(activation, access!);
        const record = request
          ? `The record shows ${request.kind === "otp_sent" ? "a one-time code sent" : "a device registered"} at ${formatTime(request.timestamp!)} and ${eventWords(activation)}, ${formatDuration(ms(activation.timestamp)! - ms(request.timestamp)!)} later.`
          : `The record shows ${eventWords(activation)}. It does not show when the activation was requested.`;
        const outcome = !request ? "not_shown" : ms(activation.timestamp)! - ms(request.timestamp)! < TOKEN_ACTIVATION_DELAY_MS ? "differs" : "matches";
        await w.compare({ clauseKey: delayKey, onDate, record, outcome, evidenceIds: accessEv, group: tokenGroup, payments: tokenPayments });
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

    // Card added to a mobile wallet: verification used, and removal after the report.
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
    const report = factValue(input.facts, "reported_to_bank");
    for (const provisioning of cards.filter((e) => e.walletProvisionedAt)) {
      const onDate = localDate(provisioning.walletProvisionedAt!);
      const added = `The record shows the card added to a mobile wallet at ${formatTime(provisioning.walletProvisionedAt!)}${provisioning.walletDeviceLabel ? ` on a device labelled '${provisioning.walletDeviceLabel}'` : ""}`;

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
    return w.result();
  };
}

/**
 * ABS release of 17 Feb 2025: verification beyond the SMS one-time code. Provisioning before August 2025 is before the
 * expected completion date (July 2025), so the line is `not_applicable` and prints the date.
 */
export function walletVerification(provisioning: CardAuthEvent, added: string): { record: string; outcome: "differs" | "matches" | "not_shown" | "not_applicable" } {
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

/** Section `industry_practice_comparison` (brief 4c), with the clause keys held so far (none yet). */
export const buildIndustryPracticeChecks: SectionBuilder = createIndustryPracticeChecks();
