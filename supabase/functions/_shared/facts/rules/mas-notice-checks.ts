// MAS notice comparison, layer 2 (FIDReC standards brief v5, 4b). Section `mas_notice_comparison`.
//
// Routed by institution type: bank -> FSM-N05 (technology risk) and FSM-N06; non-bank card licensee -> FSM-N07 and
// FSM-N08; payment-system licensee -> FSM-N13 and FSM-N14; e-wallet major payment institution -> the MAS circular on
// MPI anti-scam measures. The comparison is against the technology-risk notice's customer-information clause:
// FSM-N05 paragraph 9 for banks (`mas.fsm-n05/9`, Lane 1) and FSM-N07 paragraph 9 for card licensees. The others are
// located at ingestion, and until a route has a key the section prints its opening and flags the notice as not held.
//
// The group opens with `bridge.mas_requirement` for account payments and with the card statement for card payments.
// No FSM-N06 4.6 check for customer logins (brief 1.3). No system-availability line: no fact records that the reporting
// channel, block or alerts were unavailable. No line says whether a requirement was met.

import type { InstitutionType } from "../keys.ts";
import { CLAUSE_KEYS, complainantRecognisesDevice, NAMED_CLAUSE_KEYS, recognitionAnswerFor } from "../update/contract.ts";
import type { AccessEvent, AccessEventKind, CaseInstitution, DeviceRecognition, DisputedPayment, SectionBuilder, SectionInput, SectionResult } from "../update/contract.ts";
import { deviceRecognitionSentence, formatDateTime as formatTime } from "../update/section-writer.ts";
import { alertFor, eventWords } from "./duty-time-checks.ts";
import {
  BRIDGE_STATEMENT_KEYS,
  ComparisonWriter,
  earliestDate,
  evidenceFor,
  factValue,
  LINK_STATEMENT_KEYS,
  ms,
  type PaymentGroup,
  paymentsIn,
} from "./link-statements.ts";

/**
 * Brief 4b: for card payments the group opens with the card statement instead of `bridge.mas_requirement`. Agreed in
 * the review of 24 Nov 2026 (Decision 9) and now in the contract's `link` group.
 */
export const CARD_OPENING_STATEMENT_KEY = BRIDGE_STATEMENT_KEYS.masRequirementCards;

/** Which notices reach the institution (brief 1.2). */
export type NoticeInstitutionClass = "bank" | "card_licensee" | "payment_system_licensee" | "ewallet_mpi";

export interface NoticeRoute {
  /** The documents the brief routes this class to, technology-risk notice first. */
  documents: readonly string[];
  /** The customer-information clause compared against; null until it is located and keyed. */
  customerInformationClause: string | null;
}

const FSM_N07_CUSTOMER_INFORMATION = CLAUSE_KEYS.mas_notice_comparison[0];
const FSM_N05_CUSTOMER_INFORMATION = NAMED_CLAUSE_KEYS.fsmN05CustomerInformation;

export const MAS_NOTICE_ROUTES: Readonly<Record<NoticeInstitutionClass, NoticeRoute>> = {
  // FSM-N05 paragraph 9 (Lane 1, review of 24 Nov 2026, Lane 3 issue 1).
  bank: { documents: ["mas.fsm-n05", "mas.fsm-n06"], customerInformationClause: FSM_N05_CUSTOMER_INFORMATION },
  card_licensee: { documents: ["mas.fsm-n07", "mas.fsm-n08"], customerInformationClause: FSM_N07_CUSTOMER_INFORMATION },
  payment_system_licensee: { documents: ["mas.fsm-n13", "mas.fsm-n14"], customerInformationClause: null },
  ewallet_mpi: { documents: ["mas.circular.mpi_anti_scam"], customerInformationClause: null },
};

/**
 * The institution's class from the case. The contract's institution types are bank, payment service provider, telco and
 * other, so a non-bank card licensee cannot be told from them; it is reached only through the `classify` option.
 */
export function noticeClassOf(institution: CaseInstitution | null, payments: readonly DisputedPayment[], fallbackType: InstitutionType | null = null): NoticeInstitutionClass | null {
  const type = institution?.type ?? fallbackType;
  if (type === "bank") return "bank";
  if (type === "payment_service_provider") return payments.some((p) => p.instrument === "ewallet") ? "ewallet_mpi" : "payment_system_licensee";
  return null;
}

export interface MasNoticeCheckOptions {
  routes?: Readonly<Record<NoticeInstitutionClass, NoticeRoute>>;
  classify?: (input: SectionInput) => NoticeInstitutionClass | null;
}

const LOGIN_KINDS: readonly AccessEventKind[] = ["login", "new_device_login"];
/** Brief 4b, "Changes made in the session". */
export const SESSION_CHANGE_KINDS = ["contact_details_changed", "limit_changed", "payee_added"] as const satisfies readonly AccessEventKind[];

export function createMasNoticeChecks(options: MasNoticeCheckOptions = {}): SectionBuilder {
  const routes = options.routes ?? MAS_NOTICE_ROUTES;
  return async (input: SectionInput): Promise<SectionResult> => {
    const w = new ComparisonWriter("mas_notice_comparison", input);
    const account = paymentsIn(input.payments, "account");
    const card = paymentsIn(input.payments, "card");
    if (!account.length && !card.length) return w.result();

    const onDate = earliestDate(input.payments.map((p) => p.date));
    if (account.length) await w.statementOn(LINK_STATEMENT_KEYS.masRequirement, earliestDate(account.map((p) => p.date)));
    if (card.length) await w.statementOn(CARD_OPENING_STATEMENT_KEY, earliestDate(card.map((p) => p.date)));

    const cls = options.classify ? options.classify(input) : noticeClassOf(input.institution, input.payments, factValue(input.facts, "institution_names")?.[0]?.type ?? null);
    if (!cls) return w.result();
    const route = routes[cls];
    const clauseKey = route.customerInformationClause;
    if (!clauseKey) {
      // Not located yet: nothing to set the records beside. The run shows which notice is waiting.
      await w.clauseText(route.documents[0], onDate);
      return w.result();
    }

    // Link statements follow account lines only; with account payments the opening has already printed the bridge.
    const group: PaymentGroup = account.length ? "account" : "card";
    const payments = [...account, ...card];
    const access = factValue(input.facts, "access_events");
    const recognition = factValue(input.facts, "device_recognition") ?? [];
    const ev = evidenceFor(input, "access_events", "device_recognition");
    const base = { clauseKey, onDate, group, payments };

    if (!access) {
      await w.compare({ ...base, record: "The records provided include no record from the institution of logins, devices and alerts.", outcome: "not_shown", evidenceIds: [] });
      return w.result();
    }

    // The not-sure rule (contract `complainantRecognisesDevice`): only a clear "mine" counts as recognised. A line is
    // about a device the record names; what the complainant said is printed as said.
    const unrecognised = (e: AccessEvent) => Boolean(e.deviceRef || e.deviceLabel) && !complainantRecognisesDevice(input.facts.device_recognition, e);
    const sorted = access.filter((e) => ms(e.timestamp) !== null).sort((a, b) => ms(a.timestamp)! - ms(b.timestamp)!);
    const logins = sorted.filter((e) => LOGIN_KINDS.includes(e.kind) && unrecognised(e));
    if (!logins.length) {
      await w.compare({ ...base, record: "The record shows no login from a device the complainant states is not theirs.", outcome: "not_applicable", evidenceIds: ev });
      return w.result();
    }

    // Access by an unrecognised device.
    for (const login of logins) {
      await w.compare({
        ...base,
        record: [
          `The institution's record shows ${eventWords(login)}.`,
          deviceRecognitionSentence(recognitionAnswerFor(recognition, login), null),
          login.authorisedBy ? `The record shows the login was authorised by ${login.authorisedBy}.` : "The record does not show how the login was authenticated.",
        ].join(" "),
        outcome: "differs",
        evidenceIds: ev,
      });
    }

    // Changes made in the session from such a device, and whether an alert went to a contact.
    for (const change of sorted.filter((e) => (SESSION_CHANGE_KINDS as readonly string[]).includes(e.kind) && unrecognised(e))) {
      await w.compare({ ...base, record: sessionChangeRecord(change, access, recognition), outcome: "differs", evidenceIds: ev });
    }
    return w.result();
  };
}

function sessionChangeRecord(change: AccessEvent, access: readonly AccessEvent[], recognition: readonly DeviceRecognition[]): string {
  const alert = alertFor(change, access);
  const alertText = alert
    ? `The record shows an alert sent at ${formatTime(alert.timestamp!)}${alert.sentTo ? ` to ${alert.sentTo}` : ""}.`
    : "The record shows no alert between this change and the next recorded event.";
  return [
    `The institution's record shows ${eventWords(change)}.`,
    deviceRecognitionSentence(recognitionAnswerFor(recognition, change), null),
    alertText,
  ].join(" ");
}

/** Section `mas_notice_comparison` (brief 4b). */
export const buildMasNoticeChecks: SectionBuilder = createMasNoticeChecks();
