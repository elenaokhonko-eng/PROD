// Free-evaluation sections written by the server from the confirmed facts, never by the model (stage 1 demo
// review, findings C2 and C4).

import type { FactKey, ReportedEvent, Transaction } from "./keys.ts";
import { FACT_LABELS } from "./keys.ts";
import { displayFactValue, documentedPayments, paymentsByDocument } from "./display.ts";
import { matchTransactions } from "./reconcile.ts";
import type { FindingValue } from "./reconcile.ts";
import type { FactLabel, Resolution } from "./snapshot.ts";
import { type EvidenceItem, isEvidenceItem } from "../evidence-minimums.ts";
import { APPROVED, contradictionSentence, noDocumentSentence, notConfirmedSentence, shownSomeSentence } from "./approved-wording.ts";

export interface EvidenceFinding {
  factKey: FactKey;
  values: FindingValue[];
  resolution: Resolution | null;
}

type Facts = Partial<Record<FactKey, { value: unknown; label: FactLabel }>>;

// What would show each fact, in plain words (C2: "What's still missing", with examples).
const PROOF: Partial<Record<FactKey, string>> = {
  total_loss: "a bank or card statement showing the payments, the SMS or email alerts about them, or a police report stating the amount",
  transactions: "a bank or card statement, or the transaction alerts",
  account_types: "a statement from each account or card the money left",
  institution_names: "a statement or letter from each bank or payment provider",
  reported_to_bank: "the bank's acknowledgement by email or SMS, or a note of your call with its date and case reference",
  bank_case_reference: "the bank's acknowledgement showing the reference",
  written_complaint_sent: "a copy of the complaint you sent, with proof of when you sent it",
  bank_reply: "the bank's letter or email",
  reported_to_police: "the police report or its acknowledgement",
  police_report_number: "the police report or its acknowledgement showing the number",
  scam_type: "screenshots of the scam message, email, website or advert",
  phishing_channel: "a screenshot of the first message, or your call log",
  credentials_or_otp_shared: "screenshots of the fake website or app, or of the message you replied to",
};

// The value boxes the user's answer used, so their documents can be named.
function chosenValues(finding: EvidenceFinding): FindingValue[] {
  const r = finding.resolution;
  if (!r || r.kind === "agreed" || r.kind === "acknowledged") return finding.values.slice(0, 1);
  if (r.kind === "choice") return finding.values[r.index] ? [finding.values[r.index]] : [];
  if (r.kind === "choices") return r.indices.map((i) => finding.values[i]).filter(Boolean);
  return [];
}

// Documents are named by kind, never by file name: file names can carry other people's names and references, and the
// evaluation is shared and downloaded (walkthrough, 8 Nov).
export const DOCUMENT_LABELS: Record<string, string> = {
  police_report: "your police report (uploaded)",
  bank_statement: "your bank statement (uploaded)",
  card_statement: "your card statement (uploaded)",
  bank_correspondence: "a letter or email from your bank (uploaded)",
  scam_message: "the scam message (uploaded)",
};

// A document counted only because the person said what it is: every label says so, never what the pipeline read it as
// (PB-22, review condition of 25 Nov: nothing has verified what it is).
export const COMPLAINANT_ITEM_LABELS: Record<EvidenceItem, string> = {
  payment_proof: "a document identified by the complainant as proof of the disputed payments",
  police_report: "a document identified by the complainant as a police report",
  bank_reply_or_complaint: "a document identified by the complainant as the bank's written reply or the written complaint",
  scam_message: "a document identified by the complainant as the scam message",
};

function documentNames(values: FindingValue[]): string[] {
  const names = values.flatMap((v) => v.sources)
    .filter((s) => s.sourceType === "document")
    .map((s) => {
      const marked = s.sourceRef.complainantItem;
      if (s.sourceRef.typeFromMark === true && isEvidenceItem(marked)) return COMPLAINANT_ITEM_LABELS[marked];
      return DOCUMENT_LABELS[String(s.sourceRef.documentType)] ?? "an uploaded document";
    });
  return [...new Set(names)];
}

/** The documents behind the value the person confirmed for a fact: their ids and the kind each was read as. */
export function documentsShowing(key: FactKey, findings: readonly EvidenceFinding[]): Array<{ documentId: string | null; documentType: string }> {
  const finding = findings.find((f) => f.factKey === key);
  if (!finding) return [];
  return chosenValues(finding)
    .flatMap((v) => v.sources)
    .filter((s) => s.sourceType === "document")
    .map((s) => ({
      documentId: typeof s.sourceRef.documentId === "string" ? s.sourceRef.documentId : null,
      documentType: String(s.sourceRef.documentType ?? ""),
    }));
}

// "No" (not told, no complaint) or "no reply yet" needs no document.
function claimsSomething(key: FactKey, value: unknown): boolean {
  if (key === "reported_to_bank" || key === "reported_to_police" || key === "written_complaint_sent") {
    return (value as ReportedEvent | null)?.value === "yes";
  }
  if (key === "bank_reply") return !["none", "not_final"].includes(String((value as { status?: string } | null)?.status));
  return true;
}

export const EVIDENCE_SHOWN_HEADING = "What you've shown us";
export const EVIDENCE_MISSING_HEADING = "What's still missing";

// Two lists: each confirmed fact a document shows (and which document), and each fact with no document, with
// examples of what would show it.
export function evidenceListsText(facts: Facts, findings: readonly EvidenceFinding[]): string {
  const { shown, missing } = evidenceLists(facts, findings);
  return [
    EVIDENCE_SHOWN_HEADING,
    ...(shown.length ? shown.map((s) => `- ${s}`) : ["- No document supports a confirmed fact yet."]),
    "",
    EVIDENCE_MISSING_HEADING,
    ...(missing.length ? missing.map((s) => `- ${s}`) : ["- Nothing for the facts you confirmed."]),
  ].join("\n");
}

// A document that shows another value than the one the person confirmed is described, not hidden (item 6).
function contradictions(
  finding: EvidenceFinding,
  key: FactKey,
  confirmed: string,
  voice: "you" | "complainant",
  evidenceId: (documentId: string) => string | null,
): string[] {
  if (!finding.resolution || finding.resolution.kind === "agreed" || finding.resolution.kind === "acknowledged") return [];
  const chosen = chosenValues(finding);
  const out: string[] = [];
  for (const other of finding.values.filter((v) => !chosen.includes(v))) {
    const text = displayFactValue(key, other.value);
    if (text === confirmed) continue;
    for (const source of other.sources.filter((s) => s.sourceType === "document")) {
      const name = documentNames([{ ...other, sources: [source] }])[0];
      const documentId = typeof source.sourceRef.documentId === "string" ? source.sourceRef.documentId : "";
      const id = evidenceId(documentId);
      out.push(contradictionSentence(voice, confirmed, `${name[0].toUpperCase()}${name.slice(1)}${id ? ` (${id})` : ""}`, text));
    }
  }
  return [...new Set(out)];
}

// Payments are compared in numbers, across every document together, so no two lines can disagree (9.4, 10.3).
const STATEMENT_KINDS: Record<string, string> = { bank_statement: "bank statement", card_statement: "card statement", police_report: "police report", bank_correspondence: "bank letter" };

function paymentDocuments(
  documents: ReadonlyArray<{ documentId: string; documentType: string }>,
  voice: "you" | "complainant",
  evidenceId: (documentId: string) => string | null,
): { named: string; plural: boolean } {
  const kinds = [...new Set(documents.map((d) => d.documentType))];
  const kind = (type: string) => STATEMENT_KINDS[type] ?? "document";
  const plural = documents.length > 1;
  const noun = kinds.length === 1 ? `${kind(kinds[0])}${plural ? "s" : ""}` : "documents";
  if (voice === "you") return { named: `Your ${noun} (uploaded)`, plural };
  const ids = documents.map((d) => evidenceId(d.documentId)).filter(Boolean);
  return { named: `The ${noun}${ids.length ? ` (${ids.join(", ")})` : ""}`, plural };
}

function paymentLines(
  confirmed: Transaction[] | null,
  findings: readonly EvidenceFinding[],
  voice: "you" | "complainant",
  evidenceId: (documentId: string) => string | null,
): { shown: string[]; missing: string[] } {
  const list = confirmed ?? [];
  const label = FACT_LABELS.transactions;
  if (!list.length) return { shown: [], missing: [] };
  const value = displayFactValue("transactions", list);
  const byDocument = paymentsByDocument(findings);
  const together = documentedPayments(byDocument.map((d) => d.payments));
  const noDocument = `${label}: ${value}. No document yet; for example ${PROOF.transactions}.`;
  if (!together.length) return { shown: [], missing: [noDocument] };
  const { named, plural } = paymentDocuments(byDocument, voice, evidenceId);
  const match = matchTransactions(list, together);
  const matched = match.pairs.length;
  const extra = match.unmatchedB.length ? [notConfirmedSentence(voice, named, plural, match.unmatchedB.length)] : [];
  if (!matched) return { shown: extra, missing: [noDocument] };
  const shownBy = `Shown by ${named[0].toLowerCase()}${named.slice(1)}.`;
  const first = matched === list.length ? `${label}: ${value}. ${shownBy}` : shownSomeSentence(voice, list.length, named, plural, matched);
  return { shown: [first, ...extra], missing: [] };
}

// The same two lists as items, for the paid packs' evidence checklist.
export function evidenceLists(
  facts: Facts,
  findings: readonly EvidenceFinding[],
  options: { voice?: "you" | "complainant"; evidenceId?: (documentId: string) => string | null } = {},
): { shown: string[]; missing: string[] } {
  const { voice = "you", evidenceId = () => null } = options;
  const shown: string[] = [];
  const missing: string[] = [];
  for (const key of Object.keys(FACT_LABELS) as FactKey[]) {
    const fact = facts[key];
    if (!fact) continue;
    const label = FACT_LABELS[key];
    if (fact.label === "not_sure" || fact.label === "not_known") {
      if (PROOF[key]) missing.push(`${label}: not confirmed yet. This could be shown by ${PROOF[key]}.`);
      continue;
    }
    const finding = findings.find((f) => f.factKey === key);
    if (key === "transactions") {
      const lines = paymentLines(fact.value as Transaction[], findings, voice, evidenceId);
      shown.push(...lines.shown);
      missing.push(...lines.missing);
      continue;
    }
    const documents = finding ? documentNames(chosenValues(finding)) : [];
    const value = displayFactValue(key, fact.value);
    if (documents.length) shown.push(`${label}: ${value}. Shown by ${documents.join(", ")}.`);
    else if (claimsSomething(key, fact.value)) {
      missing.push(PROOF[key] ? `${label}: ${value}. No document yet; for example ${PROOF[key]}.` : noDocumentSentence(label, value));
    }
    if (finding) shown.push(...contradictions(finding, key, value, voice, evidenceId));
  }
  return { shown, missing };
}

// "Report it now" (C4): shown when the bank or the police have not been told. Generic and sourced; no bank's phone
// number is listed, so none can be out of date.
export function reportItNowText(facts: Facts): string {
  const told = (key: FactKey) => (facts[key]?.value as ReportedEvent | null | undefined)?.value === "yes";
  const bank = told("reported_to_bank");
  const police = told("reported_to_police");
  if (bank && police) return APPROVED.bothTold;
  const lines = ["If you haven't yet, these steps are worth doing today:"];
  if (!bank) {
    lines.push("- Call your bank's 24-hour fraud hotline. The number is on the back of your card and on your bank's official website. Ask them to freeze your accounts and cards, and write down the case reference they give you.");
  }
  if (!police) {
    lines.push("- Make a police report online through the Singapore Police Force's e-services (police.gov.sg), or at any neighbourhood police centre, and note the report number.");
  }
  lines.push("- Call the ScamShield Helpline on 1799, or report it through the ScamShield app or website (scamshield.gov.sg).");
  lines.push("- Write down the dates and times, the amounts, the accounts or cards affected, and every reference number you're given.");
  return lines.join("\n");
}
