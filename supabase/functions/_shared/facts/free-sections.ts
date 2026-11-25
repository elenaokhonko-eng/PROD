// Free-evaluation sections written by the server from the confirmed facts, never by the model (stage 1 demo
// review, findings C2 and C4).

import type { FactKey, ReportedEvent } from "./keys.ts";
import { FACT_LABELS } from "./keys.ts";
import { formatFactValue } from "./display.ts";
import type { FindingValue } from "./reconcile.ts";
import type { FactLabel, Resolution } from "./snapshot.ts";

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

function documentNames(values: FindingValue[]): string[] {
  const names = values.flatMap((v) => v.sources)
    .filter((s) => s.sourceType === "document")
    .map((s) => DOCUMENT_LABELS[String(s.sourceRef.documentType)] ?? "an uploaded document");
  return [...new Set(names)];
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

// The same two lists as items, for the paid packs' evidence checklist.
export function evidenceLists(facts: Facts, findings: readonly EvidenceFinding[]): { shown: string[]; missing: string[] } {
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
    const documents = finding ? documentNames(chosenValues(finding)) : [];
    const value = formatFactValue(key, fact.value);
    if (documents.length) shown.push(`${label}: ${value}. Shown by ${documents.join(", ")}.`);
    else if (PROOF[key] && claimsSomething(key, fact.value)) missing.push(`${label}: ${value}. No document yet; for example ${PROOF[key]}.`);
  }
  return { shown, missing };
}

// "Report it now" (C4): shown when the bank or the police have not been told. Generic and sourced; no bank's phone
// number is listed, so none can be out of date.
export function reportItNowText(facts: Facts): string | null {
  const told = (key: FactKey) => (facts[key]?.value as ReportedEvent | null | undefined)?.value === "yes";
  const bank = told("reported_to_bank");
  const police = told("reported_to_police");
  if (bank && police) return null;
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
