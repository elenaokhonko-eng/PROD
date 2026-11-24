// The customer-conduct section (FIDReC standards brief v5, 4g; review of 24 Nov 2026, Decision 1): section
// `customer_conduct_comparison`, printed after the definitions (4d).
//
// Decision 1: no `matches`, no `differs`, no ComparisonLine, never the generic comparison endings. For each kind of
// conduct (the seven topic markers) the section prints two separate things, and nothing joins them:
// - what the record shows (a text line), or "The records provided do not show [X]." (`records_do_not_show`);
// - per document, whether the document refers to that kind of conduct: `refers_to` (with the clause it rests on),
//   `does_not_refer_to`, or, for the SRF Guidelines, `no_conduct_test`.
// Card payments approved on a device the complainant does not recognise (answer `not_mine` or `not_sure`, no answer,
// or no device named; the contract's not-sure rule): the record line, then "The records do not show who approved these
// payments.", and no document line for that marker. The MAS reply of 7 January 2025 then prints only in 4d.
//
// Then the institution's own words, each document's term, and the institution's own terms (4e). No line says the
// institution's label is right or wrong, and no line says the complainant was or was not negligent, grossly negligent
// or reckless; those words appear only as a document's own term or inside quotation marks from the institution's letter.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type {
  CardAuthEvent,
  ConductLine,
  ConductMarker,
  IsoDate,
  SectionBuilder,
  SectionInput,
  SectionResult,
} from "../update/contract.ts";
import {
  CLAUSE_KEYS,
  complainantRecognisesDevice,
  CONDUCT_MARKERS,
  documentDatedAfterEvents,
  NAMED_CLAUSE_KEYS,
  readDateFor,
  recognitionAnswerFor,
} from "../update/contract.ts";
import {
  afterTheEventsLine,
  datePart,
  deviceRecognitionSentence,
  formatDate,
  formatDateTime,
  formatCalendarDays,
  SectionWriter,
} from "../update/section-writer.ts";
import {
  CARD_AUTH_METHOD,
  CREDENTIALS_STATED,
  earliestDate,
  evidenceFor,
  factValue,
  isAccountPayment,
  isCardPayment,
  isThreeDs,
} from "./account-access-sequence.ts";
import { caseEventDates, todayIso } from "./customer-fault-definitions.ts";
import {
  NO_TERM_REQUESTS,
  productsForPayment,
  resolveTermRequest,
  type TermProduct,
  type TermRequestSource,
} from "./institution-terms.ts";

export { CONDUCT_MARKERS, type ConductMarker };

// ---------------------------------------------------------------------------------------------------------------
// What the records show, per marker
// ---------------------------------------------------------------------------------------------------------------

/** The [X] of "The records provided do not show [X]." per marker (unchanged from #39). */
export const NOT_SHOWN: Record<ConductMarker, string> = {
  credentials_entered: "whether credentials, card details or a code were entered on a website or app",
  credentials_given: "whether credentials, card details or a code were given by phone or message",
  app_installed: "whether an app was installed from outside the official store",
  card_payment_approved: "how the card payments were authenticated",
  alerts_and_report: "whether alerts were sent, or the time from the first alert to the report",
  block_used: "whether or when access was blocked",
  police_report: "whether or when a police report was made",
};

/** Decision 1, verbatim: after the record line for card payments approved on a device the complainant does not recognise. */
export const WHO_APPROVED_NOT_SHOWN = "The records do not show who approved these payments.";

export interface MarkerRecord {
  marker: ConductMarker;
  /** null: the records do not show it. */
  record: string | null;
  evidenceIds: string[];
  /**
   * `card_payment_approved` only: true when every approving device is one the complainant recognises (`mine`, on a
   * fact labelled `confirmed` or `claimant_only`; contract `complainantRecognisesDevice`).
   */
  approvalRecognised?: boolean;
}

/**
 * Markers from the facts read for record lines (labels `confirmed` and `claimant_only`). A marker the records show as
 * absent (for example credentials given by phone where the answer is that they were entered on a website) is left out;
 * one the records cannot speak to has `record: null`.
 */
export function conductMarkers(input: SectionInput): MarkerRecord[] {
  const out: MarkerRecord[] = [];
  const credentials = factValue(input, "credentials_or_otp_shared");
  const credentialsKnown = credentials !== null && credentials !== "unsure";
  const credIds = evidenceFor(input, "credentials_or_otp_shared");
  const scamTypes = factValue(input, "scam_type") ?? [];
  const credentialMarker = (marker: ConductMarker, values: string[]) => {
    if (!credentialsKnown) out.push({ marker, record: null, evidenceIds: [] });
    else if (values.includes(credentials!)) {
      out.push({ marker, record: `The complainant states that ${CREDENTIALS_STATED[credentials!]}.`, evidenceIds: credIds });
    }
  };
  credentialMarker("credentials_entered", ["entered_on_fake_site_or_app"]);
  credentialMarker("credentials_given", ["given_directly", "given_in_message"]);
  if (scamTypes.includes("malware") && !(credentialsKnown && credentials === "installed_app_or_malware")) {
    out.push({ marker: "app_installed", record: "The confirmed scam type includes malware.", evidenceIds: evidenceFor(input, "scam_type") });
  } else credentialMarker("app_installed", ["installed_app_or_malware"]);

  // Card payments authenticated by a one-time code, in-app or on a device.
  const cardPayments = input.payments.filter(isCardPayment);
  if (cardPayments.length) {
    const events = (factValue(input, "card_auth_events") ?? []).filter((e) =>
      e.transactionIndex !== null && cardPayments.some((p) => p.index === e.transactionIndex)
    );
    if (events.length === 0) out.push({ marker: "card_payment_approved", record: null, evidenceIds: [] });
    else {
      const approved = events.filter((e) =>
        (isThreeDs(e.authentication) && (e.authenticationResult === "authenticated" || e.authenticationResult === "attempted")) ||
        (e.authentication === "wallet_device" && e.authenticationResult === "authenticated")
      );
      if (approved.length) {
        out.push({
          marker: "card_payment_approved",
          record: approvedRecord(input, approved),
          evidenceIds: evidenceFor(input, "card_auth_events", "device_recognition"),
          approvalRecognised: approved.every((e) => complainantRecognisesDevice(input.facts.device_recognition, e)),
        });
      }
    }
  }

  // Alerts sent, and the time from the first alert to the report.
  const access = factValue(input, "access_events") ?? [];
  const alerts = access.filter((e) => e.kind === "alert_sent" && e.timestamp).sort((a, b) => (a.timestamp! < b.timestamp! ? -1 : 1));
  const reported = factValue(input, "reported_to_bank");
  if (alerts.length === 0) out.push({ marker: "alerts_and_report", record: null, evidenceIds: [] });
  else {
    const first = alerts[0];
    let record = `The record shows ${alerts.length === 1 ? "1 alert" : `${alerts.length} alerts`}, the first sent at ${formatDateTime(first.timestamp!)}${first.sentTo ? ` to ${first.sentTo}` : ""}.`;
    const reportDate = reported?.value === "yes" ? datePart(reported.date) : null;
    if (reportDate) {
      const days = daysBetween(datePart(first.timestamp)!, reportDate);
      const gap = days === 0 ? "the same calendar day as the first alert" : `${formatCalendarDays(days)} after the first alert`;
      record += ` The complainant reported to the institution on ${formatDate(reportDate)}, ${gap}.`;
    } else record += " The records provided do not show when the complainant reported to the institution.";
    out.push({ marker: "alerts_and_report", record, evidenceIds: evidenceFor(input, "access_events", "reported_to_bank") });
  }

  // The block, and when.
  const block = access.find((e) => e.kind === "account_blocked" && e.timestamp);
  out.push(
    block
      ? {
        marker: "block_used",
        record: `The record shows access blocked at ${formatDateTime(block.timestamp!)}${block.channel ? `, channel recorded as '${block.channel}'` : ""}.`,
        evidenceIds: evidenceFor(input, "access_events"),
      }
      : { marker: "block_used", record: null, evidenceIds: [] },
  );

  // Police report, and when.
  const police = factValue(input, "reported_to_police");
  const policeIds = evidenceFor(input, "reported_to_police");
  if (police?.value === "yes") {
    out.push({
      marker: "police_report",
      record: police.date ? `The complainant reported to the police on ${formatDate(police.date)}.` : "The complainant states that they reported to the police.",
      evidenceIds: policeIds,
    });
  } else if (police?.value === "no") {
    out.push({ marker: "police_report", record: "The complainant states that they have not reported to the police.", evidenceIds: policeIds });
  } else out.push({ marker: "police_report", record: null, evidenceIds: [] });

  return out;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function approvedRecord(input: SectionInput, events: CardAuthEvent[]): string {
  const groups = new Map<string, CardAuthEvent[]>();
  for (const e of events) {
    const key = `${e.authentication}|${e.deviceRef ?? e.deviceLabel ?? ""}|${e.sentTo ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const recognition = factValue(input, "device_recognition") ?? [];
  const parts: string[] = [];
  for (const group of groups.values()) {
    const e = group[0];
    const n = group.length === 1 ? "1 card payment" : `${group.length} card payments`;
    const device = e.deviceLabel ? ` on the device labelled '${e.deviceLabel}'` : "";
    const sent = e.sentTo ? `, sent to ${e.sentTo}` : "";
    const attempted = e.authenticationResult === "attempted" ? " (authentication attempted)" : "";
    parts.push(`The record shows ${n} authenticated by ${CARD_AUTH_METHOD[e.authentication]}${attempted}${device}${sent}.`);
    const answer = e.deviceRef || e.deviceLabel ? recognitionAnswerFor(recognition, e) : null;
    if (e.deviceLabel && answer) parts.push(deviceRecognitionSentence(answer, e.deviceLabel));
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------------------------------------------
// The documents, and the clause each "refers to" / "does not refer to" line rests on
// ---------------------------------------------------------------------------------------------------------------

export type ConductFramework = "eupg" | "srf" | "abs_card_code" | "mas_reply";
type TermFamily = "recklessness" | "gross_negligence" | "negligence";

const [EUPG_5_2, EUPG_FN20, SRF_3_1, ABS_5] = [
  CLAUSE_KEYS.customer_conduct_comparison[0],
  CLAUSE_KEYS.customer_conduct_comparison[1],
  CLAUSE_KEYS.customer_conduct_comparison[2],
  CLAUSE_KEYS.customer_conduct_comparison[3],
];
const MAS_REPLY_3DS = NAMED_CLAUSE_KEYS.masReply3ds;

interface FrameworkSpec {
  /** standard_documents.document_key: the ConductLine's `documentKey`. */
  documentKey: string;
  /** The document as the fixed term lines name it, and whether the name takes a plural verb ("The Guidelines use"). */
  name: string;
  plural: boolean;
  /** The paragraph where the document's customer-fault term is (or, for the SRF, its account-user duties). */
  termClauseKey: string;
  /** The document's own term about the account user or cardholder; null when it has none. */
  term: string | null;
  /** Term families the document's text uses at all (about anyone), so "does not use" is printed only when true. */
  usesFamilies: TermFamily[];
  /**
   * The SRF Guidelines: "[Document] has no test of the account user's conduct.", resting on this clause. Printed once,
   * only when the clause is held for the date. No per-marker line.
   */
  noConductTestClauseKey: string | null;
  /**
   * The markers the document refers to, each naming the clause it rests on. The "refers to" line prints only when that
   * clause is held in a verified version for the date; otherwise nothing prints for the marker and the run is flagged
   * `clause_not_held` (never a "does not refer to" in its place).
   */
  refersTo: Partial<Record<ConductMarker, string>>;
  /**
   * The clause a "does not refer to" line rests on: where the document sets out the conduct it refers to. Printed only
   * when that clause is held for the date. Null: the document prints no "does not refer to" lines.
   */
  doesNotReferClauseKey: string | null;
}

/**
 * Which conduct each document refers to, and the clause each line rests on. Drafted from the texts as read in brief
 * 1.4 (EUPG footnote 20 items (b), (c), (e); the ABS code gives no examples; the MAS reply's 3-D Secure paragraph).
 * FOR ELENA'S REVIEW (review of 24 Nov 2026, Lane 4 issue 2): each entry names its clause key and prints only when
 * that clause is held for the date; the reading of the clause wording itself is Elena's to confirm against the
 * verification sheets.
 */
export const CONDUCT_FRAMEWORKS: Record<ConductFramework, FrameworkSpec> = {
  eupg: {
    documentKey: "mas.eupg",
    name: "The E-Payments User Protection Guidelines",
    plural: true,
    termClauseKey: EUPG_5_2,
    term: "recklessness",
    usesFamilies: ["recklessness", "negligence"],
    noConductTestClauseKey: null,
    refersTo: {
      credentials_given: EUPG_FN20, // footnote 20, item (b)
      alerts_and_report: EUPG_FN20, // footnote 20, item (c)
      app_installed: EUPG_FN20, // footnote 20, item (e)
    },
    doesNotReferClauseKey: EUPG_FN20,
  },
  srf: {
    documentKey: "mas.srf",
    name: "The Shared Responsibility Framework Guidelines",
    plural: true,
    termClauseKey: SRF_3_1,
    term: null,
    usesFamilies: ["negligence"],
    noConductTestClauseKey: SRF_3_1,
    refersTo: {},
    doesNotReferClauseKey: null,
  },
  abs_card_code: {
    documentKey: "abs.card_code",
    name: "The ABS Code of Practice for Banks – Credit Cards",
    plural: false,
    termClauseKey: ABS_5,
    term: "gross negligence",
    usesFamilies: ["gross_negligence"],
    noConductTestClauseKey: null,
    refersTo: {},
    doesNotReferClauseKey: ABS_5,
  },
  mas_reply: {
    documentKey: MAS_REPLY_3DS.split("/")[0],
    name: "MAS's written reply of 7 January 2025",
    plural: false,
    termClauseKey: MAS_REPLY_3DS,
    term: "negligent",
    usesFamilies: ["negligence", "gross_negligence"],
    noConductTestClauseKey: null,
    refersTo: { card_payment_approved: MAS_REPLY_3DS },
    doesNotReferClauseKey: MAS_REPLY_3DS,
  },
};

const ACCOUNT_FRAMEWORKS: ConductFramework[] = ["eupg", "srf"];
const CARD_FRAMEWORKS: ConductFramework[] = ["abs_card_code", "mas_reply"];
const CARD_ONLY_MARKERS = new Set<ConductMarker>(["card_payment_approved"]);

export function termFamily(word: string): TermFamily | null {
  const w = word.toLowerCase();
  if (/reckless/.test(w)) return "recklessness";
  if (/gross(ly)?\s+neglig/.test(w)) return "gross_negligence";
  if (/neglig/.test(w)) return "negligence";
  return null;
}

/** The "refers to" or "does not refer to" line for one document and marker, or null when its clause is not held. */
async function documentLine(out: SectionWriter, spec: FrameworkSpec, marker: ConductMarker, onDate: IsoDate): Promise<ConductLine | null> {
  const refersKey = spec.refersTo[marker];
  if (refersKey) {
    return (await out.clause(refersKey, onDate))
      ? { kind: "refers_to", marker, documentKey: spec.documentKey, clauseKey: refersKey, onDate }
      : null;
  }
  if (!spec.doesNotReferClauseKey) return null;
  return (await out.clause(spec.doesNotReferClauseKey, onDate))
    ? { kind: "does_not_refer_to", marker, documentKey: spec.documentKey, clauseKey: null, onDate }
    : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------------------------------------------

export interface CustomerConductOptions {
  termRequests?: TermRequestSource;
  /** The day the pack is generated; the MAS reply (`as_of_rule = 'any_date'`) is read as of it (Decision 6). Defaults to today. */
  generatedOn?: IsoDate;
}

async function buildConduct(input: SectionInput, options: CustomerConductOptions): Promise<SectionResult> {
  const out = new SectionWriter("customer_conduct_comparison", input);
  const generatedOn = options.generatedOn ?? todayIso();
  const accountDate = earliestDate(input.payments.filter(isAccountPayment).map((p) => p.date));
  const cardDate = earliestDate(input.payments.filter(isCardPayment).map((p) => p.date));
  const anyDate = earliestDate([accountDate, cardDate]);
  const markers = conductMarkers(input);

  // The MAS reply of 7 January 2025 prints here only where the complainant recognises the approving device.
  const approval = markers.find((m) => m.marker === "card_payment_approved");
  const masReplyHere = cardDate !== null && approval?.record != null && approval.approvalRecognised === true;
  const replySpec = CONDUCT_FRAMEWORKS.mas_reply;
  const replyRule = await input.provider.getAsOfRule(replySpec.documentKey);
  const replyDate = cardDate ? readDateFor(replyRule, cardDate, generatedOn) : null;

  const documents: Array<{ framework: ConductFramework; onDate: IsoDate }> = [];
  if (accountDate) documents.push({ framework: "eupg", onDate: accountDate });
  if (cardDate) documents.push({ framework: "abs_card_code", onDate: cardDate });
  if (masReplyHere && replyDate) documents.push({ framework: "mas_reply", onDate: replyDate });

  let replyLinePrinted = false;
  // With no dated payment there is nothing to set out per marker (as before).
  for (const m of anyDate ? markers : []) {
    // What the record shows.
    if (m.record === null) {
      out.conduct({ kind: "records_do_not_show", marker: m.marker, documentKey: null, clauseKey: null, notShown: NOT_SHOWN[m.marker], onDate: anyDate! });
    } else out.text(m.record, { evidenceIds: m.evidenceIds });

    // Card payments approved on a device the complainant does not recognise: no document line for this marker.
    if (m.marker === "card_payment_approved" && !(m.record !== null && m.approvalRecognised)) {
      if (m.record !== null) out.text(WHO_APPROVED_NOT_SHOWN, { evidenceIds: m.evidenceIds });
      continue;
    }

    // Whether each document refers to this kind of conduct.
    for (const d of documents) {
      if (CARD_ONLY_MARKERS.has(m.marker) && ACCOUNT_FRAMEWORKS.includes(d.framework)) continue;
      const line = await documentLine(out, CONDUCT_FRAMEWORKS[d.framework], m.marker, d.onDate);
      if (!line) continue;
      out.conduct(line);
      if (d.framework === "mas_reply" && !replyLinePrinted) {
        replyLinePrinted = true;
        await replyAfterTheEvents(out, input, replyRule, d.onDate);
      }
    }
  }

  // The SRF Guidelines: no test of the account user's conduct (once).
  if (accountDate) {
    const srf = CONDUCT_FRAMEWORKS.srf;
    if (srf.noConductTestClauseKey && (await out.clause(srf.noConductTestClauseKey, accountDate))) {
      out.conduct({ kind: "no_conduct_test", marker: null, documentKey: srf.documentKey, clauseKey: null, onDate: accountDate });
    }
  }

  // The institution's own words.
  const label = factValue(input, "institution_fault_label");
  const labelIds = [label?.labelEvidenceId, label?.conductEvidenceId, ...evidenceFor(input, "institution_fault_label")]
    .filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
  if (label?.label) {
    const cites = label.conduct ? ` The conduct it cites is ${label.conduct}.` : "";
    out.text(`The institution's letter describes the complainant's conduct as '${label.label}'.${cites}`, { evidenceIds: labelIds });
  } else {
    out.text("The records provided do not show a word the institution's letters use for the complainant's conduct.");
  }

  // Each applicable document's term.
  const labelFamily = label?.label ? termFamily(label.label) : null;
  const applicable: ConductFramework[] = [
    ...(accountDate ? ACCOUNT_FRAMEWORKS : []),
    ...(cardDate ? CARD_FRAMEWORKS.filter((f) => f !== "mas_reply" || masReplyHere) : []),
  ];
  for (const framework of applicable) {
    const spec = CONDUCT_FRAMEWORKS[framework];
    const [uses, doesNot] = spec.plural ? ["use", "do not use"] : ["uses", "does not use"];
    if (spec.term) out.text(`${spec.name} ${uses} the term '${spec.term}'.`, { clauseKeys: [spec.termClauseKey] });
    if (label?.label && labelFamily && !spec.usesFamilies.includes(labelFamily)) {
      out.text(`${spec.name} ${doesNot} the term '${label.label}'.`, { clauseKeys: [spec.termClauseKey] });
    }
  }

  // The institution's own terms in force on the payment date (4e), per product.
  const accountTypes = factValue(input, "account_types") ?? [];
  const byProduct = new Map<TermProduct, IsoDate[]>();
  for (const p of input.payments) {
    for (const product of productsForPayment(p, accountTypes)) {
      const d = datePart(p.date);
      byProduct.set(product, [...(byProduct.get(product) ?? []), ...(d ? [d] : [])]);
    }
  }
  const printed = new Set<string>();
  for (const [product, dates] of byProduct) {
    const onDate = earliestDate(dates);
    if (!onDate) continue;
    const resolved = await resolveTermRequest(options.termRequests ?? NO_TERM_REQUESTS, input.provider, {
      institution: input.institution?.code ?? null,
      product,
      purpose: "fault_definition",
      onDate,
    });
    const on = formatDate(onDate);
    let line: string;
    let clauseKeys: string[] = [];
    if (resolved.status !== "held") {
      line = `The institution's own terms in force on ${on} are not held for that date.`;
    } else {
      const { request } = resolved;
      clauseKeys = resolved.clauses.map((c) => c.clause_key);
      for (const c of resolved.clauses) out.cite(c, onDate);
      const sameTerm = label?.label && request.term && labelFamily !== null && termFamily(request.term) === labelFamily;
      if (request.term_outcome === "not_used") {
        line = `The institution's own terms in force on ${on} do not use the terms negligence, gross negligence or recklessness.`;
      } else if (request.term_outcome === "defines" && sameTerm) {
        line = `The institution's own terms in force on ${on} define '${label!.label}' as set out in the definitions section.`;
      } else if (request.term_outcome === "uses_undefined" && sameTerm) {
        line = `The institution's own terms in force on ${on} use '${label!.label}' without defining it.`;
      } else if (request.term_outcome && request.term) {
        line = `The institution's own terms in force on ${on} use the term '${request.term}'.`;
      } else continue;
    }
    if (printed.has(line)) continue;
    printed.add(line);
    out.text(line, { clauseKeys });
  }

  return out.result();
}

/** Decision 6: after the reply's first line, "This reply is dated [date], after the events in this case." when it is. */
async function replyAfterTheEvents(out: SectionWriter, input: SectionInput, rule: string, readOn: IsoDate): Promise<void> {
  if (rule !== "any_date") return;
  const reply = await input.provider.getClauseAsOf(MAS_REPLY_3DS, readOn);
  const after = reply ? documentDatedAfterEvents(reply.effective_from, caseEventDates(input)) : null;
  if (after) out.text(afterTheEventsLine(after), { clauseKeys: [MAS_REPLY_3DS] });
}

export function createCustomerConductBuilder(options: CustomerConductOptions = {}): SectionBuilder {
  return (input) => buildConduct(input, options);
}

/** With no term requests configured: the institution's terms print "not held for that date". */
export const buildCustomerConduct: SectionBuilder = createCustomerConductBuilder();
