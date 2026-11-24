// The customer-conduct comparison (FIDReC standards brief v5, 4g; decision 6): section `customer_conduct_comparison`,
// printed after the definitions (4d). It sets the conduct the records show beside what each document's text names,
// then the institution's own words, then fixed lines chosen by code. No line says the institution's label is right or
// wrong, and no line says the complainant was or was not negligent, grossly negligent or reckless; those words appear
// only as a document's own term or inside quotation marks from the institution's letter.
//
// Step 1: conduct markers from confirmed facts and evidence.
// Step 2: per framework that applies to the payment (account -> EUPG, SRF; card -> ABS card code, MAS reply), per
//         marker, whether the document's text names that conduct: `named` (with the clause), `not_named`, or
//         `document_has_no_such_test`. Each becomes a ComparisonLine with the contract's outcomes:
//           named -> matches, not_named -> differs, document_has_no_such_test -> not_applicable, and a marker the
//           records do not show -> not_shown.
//         `buildCustomerConductRows` returns the naming beside each line, for the renderer's endings.
// Step 3-4: the institution's label and the conduct it cites; each document's term; the institution's own terms (4e).
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type {
  CardAuthEvent,
  ComparisonLine,
  ComparisonOutcome,
  IsoDate,
  SectionBuilder,
  SectionInput,
  SectionResult,
} from "../update/contract.ts";
import { CLAUSE_KEYS } from "../update/contract.ts";
import {
  CARD_AUTH_METHOD,
  CREDENTIALS_STATED,
  datePart,
  earliestDate,
  evidenceFor,
  factValue,
  formatDate,
  formatDateTime,
  isAccountPayment,
  isCardPayment,
  isThreeDs,
  SectionCollector,
  sameDevice,
} from "./account-access-sequence.ts";
import {
  NO_TERM_REQUESTS,
  productsForPayment,
  resolveTermRequest,
  type TermProduct,
  type TermRequestSource,
} from "./institution-terms.ts";

// ---------------------------------------------------------------------------------------------------------------
// Markers (step 1)
// ---------------------------------------------------------------------------------------------------------------

export const CONDUCT_MARKERS = [
  "credentials_entered",
  "credentials_given",
  "app_installed",
  "card_payment_approved",
  "alerts_and_report",
  "block_used",
  "police_report",
] as const;
export type ConductMarker = (typeof CONDUCT_MARKERS)[number];

/** What the line says when the records do not show the marker ("The records provided do not show whether [X]."). */
const NOT_SHOWN: Record<ConductMarker, string> = {
  credentials_entered: "whether credentials, card details or a code were entered on a website or app",
  credentials_given: "whether credentials, card details or a code were given by phone or message",
  app_installed: "whether an app was installed from outside the official store",
  card_payment_approved: "how the card payments were authenticated",
  alerts_and_report: "whether alerts were sent, or the time from the first alert to the report",
  block_used: "whether or when access was blocked",
  police_report: "whether or when a police report was made",
};

export interface MarkerRecord {
  marker: ConductMarker;
  /** null: the records do not show it (`not_shown`). */
  record: string | null;
  evidenceIds: string[];
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Step 1. A marker the records show as absent (for example credentials given by phone where the confirmed answer is
 * that they were entered on a website) is left out; one the records cannot speak to is `not_shown` (record null).
 */
export function conductMarkers(input: SectionInput): MarkerRecord[] {
  const out: MarkerRecord[] = [];
  const credentials = input.facts.credentials_or_otp_shared;
  const credentialsKnown = credentials?.label === "confirmed" && credentials.value !== null && credentials.value !== "unsure";
  const credIds = evidenceFor(input, "credentials_or_otp_shared");
  const scamTypes = factValue(input, "scam_type") ?? [];
  const credentialMarker = (marker: ConductMarker, values: string[]) => {
    if (!credentialsKnown) out.push({ marker, record: null, evidenceIds: [] });
    else if (values.includes(credentials!.value!)) {
      out.push({ marker, record: `The complainant states that ${CREDENTIALS_STATED[credentials!.value!]}.`, evidenceIds: credIds });
    }
  };
  credentialMarker("credentials_entered", ["entered_on_fake_site_or_app"]);
  credentialMarker("credentials_given", ["given_directly", "given_in_message"]);
  if (scamTypes.includes("malware") && !(credentialsKnown && credentials!.value === "installed_app_or_malware")) {
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
      if (approved.length) out.push({ marker: "card_payment_approved", record: approvedRecord(input, approved), evidenceIds: evidenceFor(input, "card_auth_events", "device_recognition") });
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
      const gap = days === 0 ? "the same calendar day as the first alert" : `${days} calendar day${days === 1 ? "" : "s"} after the first alert`;
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
      record: police.date ? `The complainant reported to the police on ${formatDate(police.date)}.` : "The complainant states that she reported to the police.",
      evidenceIds: policeIds,
    });
  } else if (police?.value === "no") {
    out.push({ marker: "police_report", record: "The complainant states that she has not reported to the police.", evidenceIds: policeIds });
  } else out.push({ marker: "police_report", record: null, evidenceIds: [] });

  return out;
}

function approvedRecord(input: SectionInput, events: CardAuthEvent[]): string {
  const groups = new Map<string, CardAuthEvent[]>();
  for (const e of events) {
    const key = `${e.authentication}|${e.deviceRef ?? e.deviceLabel ?? ""}|${e.sentTo ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const parts: string[] = [];
  for (const group of groups.values()) {
    const e = group[0];
    const n = group.length === 1 ? "1 card payment" : `${group.length} card payments`;
    const device = e.deviceLabel ? ` on the device labelled '${e.deviceLabel}'` : "";
    const sent = e.sentTo ? `, sent to ${e.sentTo}` : "";
    const attempted = e.authenticationResult === "attempted" ? " (authentication attempted)" : "";
    parts.push(`The record shows ${n} authenticated by ${CARD_AUTH_METHOD[e.authentication]}${attempted}${device}${sent}.`);
    const answer = (factValue(input, "device_recognition") ?? []).find((r) => (e.deviceRef || e.deviceLabel) && sameDevice(r, e))?.answer;
    if (e.deviceLabel && answer) {
      parts.push(
        answer === "not_mine"
          ? `The complainant states that the device labelled '${e.deviceLabel}' is not hers.`
          : answer === "mine"
          ? `The complainant states that the device labelled '${e.deviceLabel}' is hers.`
          : `The complainant states that she is not sure whether the device labelled '${e.deviceLabel}' is hers.`,
      );
    }
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------------------------------------------
// Frameworks and what their text names (step 2)
// ---------------------------------------------------------------------------------------------------------------

export type ConductFramework = "eupg" | "srf" | "abs_card_code" | "mas_reply";
export type ConductNaming = "named" | "not_named" | "document_has_no_such_test";
type TermFamily = "recklessness" | "gross_negligence" | "negligence";

/** The MAS reply of 7 January 2025 is not in the contract's clause keys yet (Lane 1 locates it at ingestion). */
// proposed key, awaiting Elena's approval and Lane 6's contract update
export const MAS_REPLY_3DS_CLAUSE_KEY = "mas.reply_20250107/3ds";

const [EUPG_5_2, EUPG_FN20, SRF_3_1, ABS_5] = [
  CLAUSE_KEYS.customer_conduct_comparison[0],
  CLAUSE_KEYS.customer_conduct_comparison[1],
  CLAUSE_KEYS.customer_conduct_comparison[2],
  CLAUSE_KEYS.customer_conduct_comparison[3],
];

interface FrameworkSpec {
  /** The document as the fixed lines name it, and whether the name takes a plural verb ("The Guidelines use"). */
  name: string;
  plural: boolean;
  /** The paragraph where the document's customer-fault term is (or, for the SRF, its account-user duties). */
  termClauseKey: string;
  /** The document's own term about the account user or cardholder; null when it has none. */
  term: string | null;
  /** Term families the document's text uses at all (about anyone), so "does not use" is printed only when true. */
  usesFamilies: TermFamily[];
  /** The SRF has no customer-fault test (1.4b): every marker is `document_has_no_such_test`. */
  noTestStatementKey: "srf.fault.terms" | null;
  /** Markers the document's text names, with the clause and item. Everything else is `not_named`. */
  named: Partial<Record<ConductMarker, { clauseKey: string; item: string | null }>>;
}

/**
 * Drafted from the texts as read in brief 1.4 (EUPG footnote 20 items (b), (c), (e); the ABS code gives no examples;
 * the MAS reply names unwittingly authenticating a 3DS transaction). For Elena's review with the seed statements.
 */
export const CONDUCT_FRAMEWORKS: Record<ConductFramework, FrameworkSpec> = {
  eupg: {
    name: "The E-Payments User Protection Guidelines",
    plural: true,
    termClauseKey: EUPG_5_2,
    term: "recklessness",
    usesFamilies: ["recklessness", "negligence"],
    noTestStatementKey: null,
    named: {
      credentials_given: { clauseKey: EUPG_FN20, item: "b" },
      alerts_and_report: { clauseKey: EUPG_FN20, item: "c" },
      app_installed: { clauseKey: EUPG_FN20, item: "e" },
    },
  },
  srf: {
    name: "The Shared Responsibility Framework Guidelines",
    plural: true,
    termClauseKey: SRF_3_1,
    term: null,
    usesFamilies: ["negligence"],
    noTestStatementKey: "srf.fault.terms",
    named: {},
  },
  abs_card_code: {
    name: "The ABS Code of Practice for Banks – Credit Cards",
    plural: false,
    termClauseKey: ABS_5,
    term: "gross negligence",
    usesFamilies: ["gross_negligence"],
    noTestStatementKey: null,
    named: {},
  },
  mas_reply: {
    name: "MAS's written reply of 7 January 2025",
    plural: false,
    termClauseKey: MAS_REPLY_3DS_CLAUSE_KEY,
    term: "negligent",
    usesFamilies: ["negligence", "gross_negligence"],
    noTestStatementKey: null,
    named: { card_payment_approved: { clauseKey: MAS_REPLY_3DS_CLAUSE_KEY, item: null } },
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

const OUTCOME: Record<ConductNaming, ComparisonOutcome> = {
  named: "matches",
  not_named: "differs",
  document_has_no_such_test: "not_applicable",
};

export interface ConductRow {
  framework: ConductFramework;
  marker: ConductMarker;
  /** null when the records do not show the marker. */
  naming: ConductNaming | null;
  line: ComparisonLine;
}

function clauseRef(clause: { title: string; clause_ref: string | null; clause_key: string; version_label: string }): string {
  const ref = clause.clause_ref ?? clause.clause_key.split("/")[1];
  const word = /^fn/i.test(ref) ? `footnote ${ref.replace(/^fn/i, "")}` : `paragraph ${ref}`;
  return `${clause.title}, ${word} (version ${clause.version_label})`;
}

/** Step 2, with the naming beside each line. */
export async function buildCustomerConductRows(input: SectionInput, out: SectionCollector = new SectionCollector(input)): Promise<ConductRow[]> {
  const markers = conductMarkers(input);
  const rows: ConductRow[] = [];
  const groups: Array<{ frameworks: ConductFramework[]; onDate: IsoDate | null; card: boolean }> = [
    { frameworks: ACCOUNT_FRAMEWORKS, onDate: earliestDate(input.payments.filter(isAccountPayment).map((p) => p.date)), card: false },
    { frameworks: CARD_FRAMEWORKS, onDate: earliestDate(input.payments.filter(isCardPayment).map((p) => p.date)), card: true },
  ];
  for (const group of groups) {
    if (!group.onDate) continue;
    const onDate = group.onDate;
    for (const framework of group.frameworks) {
      const spec = CONDUCT_FRAMEWORKS[framework];
      for (const m of markers) {
        if (CARD_ONLY_MARKERS.has(m.marker) && !group.card) continue;
        const named = spec.named[m.marker];
        const clauseKey = named?.clauseKey ?? spec.termClauseKey;
        if (m.record === null) {
          rows.push({
            framework,
            marker: m.marker,
            naming: null,
            line: {
              clauseKey,
              record: `The records provided do not show ${NOT_SHOWN[m.marker]}.`,
              expected: await expectedText(out, spec, clauseKey, named?.item ?? null, onDate),
              outcome: "not_shown",
              evidenceIds: [],
            },
          });
          continue;
        }
        const naming: ConductNaming = spec.noTestStatementKey ? "document_has_no_such_test" : named ? "named" : "not_named";
        rows.push({
          framework,
          marker: m.marker,
          naming,
          line: {
            clauseKey,
            record: m.record,
            expected: await expectedText(out, spec, clauseKey, named?.item ?? null, onDate),
            outcome: OUTCOME[naming],
            evidenceIds: m.evidenceIds,
          },
        });
      }
    }
  }
  return rows;
}

const expectedCache = new WeakMap<SectionCollector, Map<string, string>>();

/** The Expected side: the clause in the corpus's words (version in force on the date), or the reviewed statement. */
async function expectedText(out: SectionCollector, spec: FrameworkSpec, clauseKey: string, item: string | null, onDate: IsoDate): Promise<string> {
  const cache = expectedCache.get(out) ?? new Map<string, string>();
  expectedCache.set(out, cache);
  const cacheKey = `${clauseKey}|${item}|${onDate}|${spec.noTestStatementKey}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  let text: string;
  if (spec.noTestStatementKey) {
    const line = await out.statement(spec.noTestStatementKey, onDate);
    await out.clause(clauseKey, onDate);
    text = line.statement.text ?? `Summary under review (${spec.noTestStatementKey}, ${formatDate(onDate)}).`;
  } else {
    const clause = await out.clause(clauseKey, onDate);
    text = clause
      ? `${clauseRef(clause)}${item ? `, item (${item})` : ""}: "${clause.text_content}"`
      : `${spec.name}: ${clauseKey} is not held in a verified version in force on ${formatDate(onDate)}.`;
  }
  cache.set(cacheKey, text);
  return text;
}

// ---------------------------------------------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------------------------------------------

export interface CustomerConductOptions {
  termRequests?: TermRequestSource;
}

async function buildConduct(input: SectionInput, options: CustomerConductOptions): Promise<SectionResult> {
  const out = new SectionCollector(input);

  // Step 2.
  const rows = await buildCustomerConductRows(input, out);
  for (const row of rows) out.comparison(row.line);

  // Step 3-4: the institution's own words.
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
    ...(input.payments.some(isAccountPayment) ? ACCOUNT_FRAMEWORKS : []),
    ...(input.payments.some(isCardPayment) ? CARD_FRAMEWORKS : []),
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

  return out.result("customer_conduct_comparison");
}

export function createCustomerConductBuilder(options: CustomerConductOptions = {}): SectionBuilder {
  return (input) => buildConduct(input, options);
}

/** With no term requests configured: the institution's terms print "not held for that date". */
export const buildCustomerConduct: SectionBuilder = createCustomerConductBuilder();
