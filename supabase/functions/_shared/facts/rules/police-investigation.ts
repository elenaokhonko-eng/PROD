// CR-1 (Elena, 25 Nov 2026): the "Police investigation" section of the FIDReC pack. FIDReC's Terms of Reference,
// Rule 5(iv), the date of the police report and what the police's reply says about the investigation.
//
// The wording is Elena's, approved on 25 Nov 2026, word for word; only the dates, the reply's words and the E-numbers
// are filled in:
// - the date of the police report from the confirmed `reported_to_police` fact, with the E-numbers of the documents
//   behind it;
// - the reply's date and words from the `police_investigation_reply` fact, which holds the reply's own words (a span of
//   the document, checked word for word at extraction) and the date the reply itself writes. The words are printed
//   inside quotation marks, as the reply writes them. The section never says whether the investigation is closed: only
//   the reply's own words can.
// - Dates in the packs' form, "3 Oct 2026".
//
// Where the wording has no form for the case, the section prints nothing rather than invent one (new wording needs
// Elena's approval):
// - no police report, no date for it, or no document behind it;
// - a reply was provided, but its words or its date could not be read from it.
// With no reply provided, the last sentence is the approved "did not provide" sentence.
//
// The police's reply is optional: it is never required to generate a pack (evidence-minimums.ts does not list it).
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import { formatPackDate } from "../display.ts";
import { CLAUSE_KEYS, type IsoDate, type SectionBuilder, type SectionInput, type SectionResult } from "../update/contract.ts";
import { datePart, SectionWriter } from "../update/section-writer.ts";
import { factValue } from "./link-statements.ts";

/** FIDReC's Terms of Reference, Rule 5 (excepted complaints): cited, pinned and tracked by the corpus. */
export const POLICE_INVESTIGATION_CLAUSE_KEY = CLAUSE_KEYS.police_investigation[0];

// Approved by Elena, 25 Nov 2026 (CR-1). Do not change a word.
export const POLICE_INVESTIGATION_WORDING = {
  rule:
    `FIDReC's Terms of Reference, Rule 5(iv), say FIDReC cannot take "cases under investigation by any law enforcement agency, including cases where allegations of fraud or criminal activity have been made, and where the matter has been referred to the police for investigation".`,
  reportMade: (date: string, evidence: string) => `A police report was made on ${date} (${evidence}).`,
  replyStates: (date: string, statement: string, evidence: string) => `The police's reply dated ${date} states: "${statement}" (${evidence}).`,
  noReply: "The complainant did not provide a reply from the police on the outcome of the investigation.",
} as const;

const packDate = (value: string | null | undefined): string | null => {
  const date = datePart(value);
  return date ? formatPackDate(date) : null;
};

/** What the section prints, or why it prints nothing. For the builder and its tests. */
export type PoliceInvestigationReading =
  | { kind: "printed"; text: string; reply: "quoted" | "none_provided" }
  | { kind: "not_printed"; reason: "no_police_report" | "police_report_not_dated" | "police_report_not_documented" | "reply_not_read" };

export function readPoliceInvestigation(input: Pick<SectionInput, "facts" | "evidenceIds" | "policeReplyEvidenceIds">): PoliceInvestigationReading {
  const evidence = (ids: readonly string[] | undefined) =>
    [...new Set(ids ?? [])].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).join(", ");

  const report = factValue(input.facts, "reported_to_police");
  if (!report || report.value !== "yes") return { kind: "not_printed", reason: "no_police_report" };
  const reportDate = packDate(report.date);
  if (!reportDate) return { kind: "not_printed", reason: "police_report_not_dated" };
  const reportIds = evidence(input.evidenceIds.reported_to_police);
  if (!reportIds) return { kind: "not_printed", reason: "police_report_not_documented" };

  const sentences: string[] = [POLICE_INVESTIGATION_WORDING.rule, POLICE_INVESTIGATION_WORDING.reportMade(reportDate, reportIds)];
  const reply = factValue(input.facts, "police_investigation_reply");
  const replyDate = packDate(reply?.date);
  const replyIds = evidence(input.evidenceIds.police_investigation_reply);
  const statement = reply?.statement?.trim() ?? "";
  if (reply && replyDate && replyIds && statement) {
    sentences.push(POLICE_INVESTIGATION_WORDING.replyStates(replyDate, statement, replyIds));
    return { kind: "printed", text: sentences.join(" "), reply: "quoted" };
  }
  // A reply in the case that could not be read (no words, no date, or not confirmed): no approved form says so.
  const replyProvided = Boolean(input.facts.police_investigation_reply?.value) || (input.policeReplyEvidenceIds?.length ?? 0) > 0 ||
    (input.evidenceIds.police_investigation_reply?.length ?? 0) > 0;
  if (replyProvided) return { kind: "not_printed", reason: "reply_not_read" };
  sentences.push(POLICE_INVESTIGATION_WORDING.noReply);
  return { kind: "printed", text: sentences.join(" "), reply: "none_provided" };
}

/**
 * The section: one paragraph in Elena's words, with the E-numbers inside the sentences. The rule is read as of the
 * day the pack is generated (FIDReC applies its Terms of Reference when the complaint is filed) and pinned; a rule not
 * held is flagged (`clause_not_held`) and the approved paragraph still prints, since its words are Elena's, not the
 * corpus's.
 */
export function createPoliceInvestigationSection(): SectionBuilder {
  return async (input: SectionInput): Promise<SectionResult> => {
    const out = new SectionWriter("police_investigation", input);
    const reading = readPoliceInvestigation(input);
    if (reading.kind === "printed") {
      const onDate: IsoDate = input.generatedOn;
      await out.clause(POLICE_INVESTIGATION_CLAUSE_KEY, onDate);
      out.text(reading.text);
    }
    return out.result();
  };
}
