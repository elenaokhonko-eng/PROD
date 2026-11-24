// Rendering of the FIDReC pack update's sections (Lane 6, assembly; lanes plan, Lane 6 item 4). Turns the sections'
// lines into printed text for the pack's JSON and its PDF, and pins what the pack cited (brief v5 3.2 rule 4): each
// clause (its id, text hash and version) and each statement revision printed, so re-opening the report prints the same
// text. Every line kind is printed here:
//
// - `comparison`: Record, Expected and the "Side by side" ending chosen by the outcome (brief section 4). An SRF line
//   and an EUPG line with the same record, outcome and evidence (Lane 3 prints one per framework) print as one record
//   with two clause references (review of 24 Nov 2026, Lane 3 issue 6).
// - `statement`: the reviewed wording with its clause references, the "after the events" line (Decision 6), or the
//   under-review line when no revision is approved for the wording in force (flag `statement_under_review`).
// - The kinds with no outcome (review fix list; contract NO_OUTCOME_LINE_KINDS) never pass through the endings:
//   `conduct` (Decision 1), `twelve_hours` (Decision 4) and `quotation` (Decision 5, Part B).
// - `text` (fixed lines, numbered sequence steps), `record` (table rows).
// - Flags: a clause not held prints the not-held line in place of its wording (`clause_not_held`); a nearest version
//   is printed by its section after the fallback line (`nearest_version_held`); every flag is also kept in the report.
//
// Dates, times, gaps, money and pronouns come from section-writer.ts. New wording is marked for Elena's approval.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import { formatMoney } from "../display.ts";
import { CONDUCT_FRAMEWORKS } from "../rules/customer-conduct.ts";
import { WALLET_CHECK_HEADING } from "../rules/industry-practice-checks.ts";
import {
  type CardAuthEvent,
  type ClauseCitation,
  type ComparisonLine,
  type ConductLine,
  CONDUCT_TOPICS,
  type IsoDate,
  type QuotationLine,
  type SectionFlag,
  type SectionId,
  type SectionLine,
  type SectionResult,
  type StatementLine,
  TWELVE_HOUR_BLOCK_HEADINGS,
  type TwelveHourActivity,
  type TwelveHourBlock,
} from "./contract.ts";
import { afterTheEventsLine, creditAccountStatusLine, formatDate, formatDateTime, formatGap } from "./section-writer.ts";
import { ACCESS_EVENT_WORDS } from "./registry.ts";

// ---------------------------------------------------------------------------------------------------------------
// Printed shapes (stored in the report)
// ---------------------------------------------------------------------------------------------------------------

export interface PrintedLine {
  kind: "heading" | "paragraph" | "bullet";
  text: string;
}

export interface PrintedSection {
  id: SectionId;
  heading: string;
  lines: PrintedLine[];
}

/** A clause the pack cited, numbered R… (3.2 rule 4: the id and text hash pin the wording printed). */
export interface PinnedCitation {
  id: string;
  clauseKey: string;
  clauseId: string;
  textSha256: string;
  versionId: string;
  versionLabel: string;
  /** The dates the clause was read for. */
  onDates: IsoDate[];
  clauseRef: string | null;
  documentKey: string | null;
  documentTitle: string | null;
  effectiveFrom: IsoDate | null;
  sourceUrl: string | null;
}

/** A statement revision the pack printed (3.2 rule 4). */
export interface PinnedStatement {
  sectionId: SectionId;
  statementKey: string;
  statementId: string;
  revision: number;
  onDate: IsoDate;
}

export interface RenderedUpdate {
  sections: PrintedSection[];
  citations: PinnedCitation[];
  statements: PinnedStatement[];
  flags: Array<SectionFlag & { sectionId: SectionId }>;
}

// ---------------------------------------------------------------------------------------------------------------
// Fixed wording
// ---------------------------------------------------------------------------------------------------------------

// wording awaiting Elena's approval: the section headings.
export const SECTION_HEADINGS: Record<SectionId, string> = {
  access_records: "The institution's record of logins, devices and alerts",
  card_authentication_records: "The institution's record of how the card payments were approved",
  ip_locations: "Where the IP addresses in the records are registered",
  account_access_sequence: "The sequence the records show",
  duty_time_checks: "Time-stamped points in the SRF Guidelines and the E-Payments User Protection Guidelines",
  disputed_amount_charges: "Charges and credit records while a transaction is disputed",
  mas_notice_comparison: "MAS notices",
  industry_practice_comparison: "Industry codes, announced measures and MAS's stated positions",
  card_dispute_comparison: "Card scheme rules on disputing the card payments",
  customer_fault_definitions: "What each framework says about customer fault",
  customer_conduct_comparison: "The conduct the records show, and what each document refers to",
  standards: "Other standards",
};

/** Brief v5 section 4: the standing sentence printed above each layer's group (layers 1-3; 5 is printed by its sections). */
export const LAYER_STANDING_SENTENCES: Partial<Record<SectionId, string>> = {
  duty_time_checks: "MAS guidelines that set out the duties of institutions and account holders and how losses are shared.",
  mas_notice_comparison:
    "MAS notices set requirements that MAS imposes on the institution. This section sets the institution's records beside those requirements. It does not say whether a requirement was met.",
  industry_practice_comparison: "An industry code, announced industry measures and MAS's stated positions. They are not legislation.",
};

// wording awaiting Elena's approval: the labels of the comparison form (brief section 4 names "Record", "Expected"
// and "Side by side").
export const COMPARISON_LABELS = { record: "Record", expected: "Expected", sideBySide: "Side by side" } as const;

// wording awaiting Elena's approval: how the brief's four endings are filled in. The brief gives "The document expects
// [X]. The record shows [Y]." / "The record shows [X], as the document expects." / "The records provided do not show
// whether [X]." / "The document's condition for this duty is [C]. The record shows [Y]."; here [X] and [C] name the
// paragraph (its wording is printed under Expected) and [Y] is the record line.
export const ENDINGS = {
  differs: (refs: string, plural: boolean, record: string) => `The document${plural ? "s expect" : " expects"} what ${refs} set${plural ? "" : "s"} out. ${record}`,
  matches: (record: string, plural: boolean) => {
    const expects = plural ? "the documents expect" : "the document expects";
    return /^The record shows /.test(record) ? `${record.replace(/\.\s*$/, "")}, as ${expects}.` : `${record} The record shows this, as ${expects}.`;
  },
  not_shown: (refs: string, plural: boolean) => `The records provided do not show whether what ${refs} set${plural ? "" : "s"} out took place.`,
  not_applicable: (refs: string, record: string) => `The document's condition for this duty is in ${refs}. ${record}`,
} as const;

// wording awaiting Elena's approval
export const CLAUSE_NOT_HELD_LINE = (reference: string, onDate: IsoDate | null) =>
  `The text of ${reference}${onDate ? ` in force on ${formatDate(onDate)}` : ""} is not held in a verified version.`;

// wording awaiting Elena's approval
export const STATEMENT_UNDER_REVIEW_LINE = "A reviewed summary of this point is not yet available.";

// wording awaiting Elena's approval: the 12-hour block's lines (headings are Decision 4's own).
export const TWELVE_HOUR_WORDING = {
  activation: (what: string, at: string, device: string | null) =>
    `The record shows ${what} at ${at}${device ? ` on a device labelled '${device}'` : ""}.`,
  none: "The records provided show none.",
  walletPointer: `The record shows a card added to a mobile wallet. See '${WALLET_CHECK_HEADING}'.`,
} as const;

// wording awaiting Elena's approval: a quotation whose introducing statement is not yet approved.
export const QUOTATION_FALLBACK_INTRO = (title: string, date: IsoDate) => `${title}, dated ${formatDate(date)}:`;

// wording awaiting Elena's approval: the field labels of the record tables, except "Date" and "Card ending", which
// Elena approved (24 Nov 2026). The camelCase keys are the contract's field names (Transaction, CardAuthEvent), as the
// card dispute section prints its rows (Lane 5, #80); they reuse the labels above them. Every key a section prints
// must be here: the renderer never prints a raw field key.
export const RECORD_FIELD_LABELS: Record<string, string> = {
  // Approved by Elena, 24 Nov 2026.
  date: "Date",
  last4: "Card ending",
  // The contract's names, mapped to the existing labels.
  amount: "Payment",
  cardScheme: "Card scheme",
  entryMode: "Entry mode",
  authenticationResult: "Result",
  deviceLabel: "Device",
  time: "Time",
  entry: "Entry",
  device: "Device",
  device_reference: "Device reference",
  ip_address: "IP address",
  channel: "Channel",
  authorised_by: "Authorised by",
  sent_to: "Sent to",
  token_reference: "Token reference",
  payment: "Payment",
  merchant: "Merchant",
  amount_in_record: "Amount in the record",
  card_scheme: "Card scheme",
  entry_mode: "Entry mode",
  authentication: "Authentication",
  result: "Result",
  added_to_wallet: "Added to a mobile wallet",
  wallet_device: "Wallet device",
  wallet_authentication: "Wallet authentication",
  removed_from_wallet: "Removed from the wallet",
};

// ---------------------------------------------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------------------------------------------

// wording awaiting Elena's approval: names of the documents the contract cites, for a line whose clause is not held
// (so the corpus gives no title). The conduct section's names (Lane 4) are used as they are.
const DOCUMENT_NAMES: Record<string, { name: string; plural: boolean }> = {
  "mas.fsm-n05": { name: "MAS Notice FSM-N05", plural: false },
  "mas.fsm-n06": { name: "MAS Notice FSM-N06", plural: false },
  "mas.fsm-n07": { name: "MAS Notice FSM-N07", plural: false },
  "mas.fsm-n08": { name: "MAS Notice FSM-N08", plural: false },
  "abs.media_2025_02_card_provisioning": { name: "The ABS media statement of 17 February 2025", plural: false },
  "mas.media_2022_01_digital_banking": { name: "The MAS–ABS media release of 19 January 2022", plural: false },
  "mas.reply.20260113": { name: "MAS's written reply of 13 January 2026", plural: false },
  "visa.core_rules": { name: "The Visa Core Rules", plural: true },
  "mastercard.chargeback_guide": { name: "The Mastercard Chargeback Guide", plural: false },
  ...Object.fromEntries(Object.values(CONDUCT_FRAMEWORKS).map((f) => [f.documentKey, { name: f.name, plural: f.plural }])),
};

const lowerFirst = (s: string) => (/^The /.test(s) ? `the ${s.slice(4)}` : s);

class Citations {
  private readonly byClauseId = new Map<string, PinnedCitation>();
  private readonly order: PinnedCitation[] = [];

  constructor(private readonly firstNumber: number) {}

  add(c: ClauseCitation): PinnedCitation {
    let pinned = this.byClauseId.get(c.clauseId);
    if (!pinned) {
      pinned = {
        id: `R${this.firstNumber + this.order.length}`,
        clauseKey: c.clauseKey,
        clauseId: c.clauseId,
        textSha256: c.textSha256,
        versionId: c.versionId,
        versionLabel: c.versionLabel,
        onDates: [],
        clauseRef: c.clauseRef ?? null,
        documentKey: c.documentKey ?? null,
        documentTitle: c.documentTitle ?? null,
        effectiveFrom: c.effectiveFrom ?? null,
        sourceUrl: c.sourceUrl ?? null,
      };
      this.byClauseId.set(c.clauseId, pinned);
      this.order.push(pinned);
    }
    if (!pinned.onDates.includes(c.onDate)) pinned.onDates.push(c.onDate);
    return pinned;
  }

  all(): PinnedCitation[] {
    return this.order;
  }
}

interface SectionRefs {
  /** The pinned citation for a clause key in this section, preferring the one read for the date given. */
  find(clauseKey: string, onDate?: IsoDate | null): PinnedCitation | null;
}

function sectionRefs(result: SectionResult, citations: Citations): SectionRefs {
  const own = result.citations.map((c) => ({ c, pinned: citations.add(c) }));
  return {
    find(clauseKey, onDate) {
      const matching = own.filter((x) => x.c.clauseKey === clauseKey);
      return (onDate ? matching.find((x) => x.c.onDate === onDate) : undefined)?.pinned ?? matching[0]?.pinned ?? null;
    },
  };
}

/** "paragraph 4.7", "footnote 20", "section 11.2.2" (card scheme rules). */
export function clauseWords(clauseKey: string, clauseRef: string | null = null): string {
  const tail = clauseRef ?? clauseKey.split("/")[1] ?? clauseKey;
  const footnote = /^fn(\d+)$/.exec(tail);
  if (footnote) return `footnote ${footnote[1]}`;
  if (/^(?:visa|mastercard)\./.test(clauseKey)) return `section ${tail}`;
  return `paragraph ${tail}`;
}

function documentName(documentKey: string, pinned: PinnedCitation | null): { name: string; plural: boolean } {
  const known = DOCUMENT_NAMES[documentKey];
  if (known) return known;
  const title = pinned?.documentTitle ?? documentKey;
  return { name: /^the /i.test(title) ? title : `the ${title}`, plural: /guidelines$/i.test(title) };
}

/** "paragraph 4.7 of the E-Payments User Protection Guidelines": the corpus's title when cited, else the known name. */
function reference(clauseKey: string, pinned: PinnedCitation | null): string {
  const documentKey = pinned?.documentKey ?? clauseKey.split("/")[0];
  const title = pinned?.documentTitle ? (/^the /i.test(pinned.documentTitle) ? pinned.documentTitle : `the ${pinned.documentTitle}`) : documentName(documentKey, null).name;
  return `${clauseWords(clauseKey, pinned?.clauseRef ?? null)} of ${lowerFirst(title)}`;
}

const refs = (ids: ReadonlyArray<string | null | undefined>) => {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  return list.length ? ` (${list.join(", ")})` : "";
};

const joinWords = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

// ---------------------------------------------------------------------------------------------------------------
// Line kinds
// ---------------------------------------------------------------------------------------------------------------

/** One comparison, or an SRF and an EUPG comparison on the same record printed together. */
function comparisonLines(group: ComparisonLine[], r: SectionRefs): PrintedLine[] {
  const [first] = group;
  const out: PrintedLine[] = [{ kind: "paragraph", text: `${COMPARISON_LABELS.record}: ${first.record}${refs(first.evidenceIds)}` }];
  const cited: Array<{ line: ComparisonLine; pinned: PinnedCitation | null }> = group.map((line) => ({ line, pinned: r.find(line.clauseKey, line.onDate) }));
  for (const { line, pinned } of cited) {
    const where = reference(line.clauseKey, pinned);
    const text = line.expected && pinned
      ? `${capitalise(where)}, version ${pinned.versionLabel}: "${line.expected}"${refs([pinned.id])}`
      : CLAUSE_NOT_HELD_LINE(where, line.onDate ?? null);
    out.push({ kind: "paragraph", text: `${COMPARISON_LABELS.expected}: ${text}` });
  }
  const plural = group.length > 1;
  const where = joinWords(cited.map(({ line, pinned }) => reference(line.clauseKey, pinned))) +
    refs(cited.map(({ pinned }) => pinned?.id));
  const ending = first.outcome === "differs"
    ? ENDINGS.differs(where, plural, first.record)
    : first.outcome === "matches"
    ? ENDINGS.matches(first.record, plural)
    : first.outcome === "not_shown"
    ? ENDINGS.not_shown(where, plural)
    : ENDINGS.not_applicable(where, first.record);
  out.push({ kind: "paragraph", text: `${COMPARISON_LABELS.sideBySide}: ${ending}` });
  return out;
}

function statementLines(s: StatementLine, r: SectionRefs): PrintedLine[] {
  if (s.text === null) return [{ kind: "paragraph", text: STATEMENT_UNDER_REVIEW_LINE }];
  const ids = s.clauseKeys.map((k) => r.find(k, s.onDate)?.id);
  const out: PrintedLine[] = [{ kind: "paragraph", text: `${s.text}${refs([...ids, ...s.evidenceIds])}` }];
  if (s.documentDatedAfterEvents) out.push({ kind: "paragraph", text: afterTheEventsLine(s.documentDatedAfterEvents) });
  return out;
}

function conductText(c: ConductLine, evidenceIds: string[], r: SectionRefs): string {
  if (c.kind === "records_do_not_show") return `The records provided do not show ${c.notShown}.${refs(evidenceIds)}`;
  const doc = documentName(c.documentKey, c.clauseKey ? r.find(c.clauseKey, c.onDate) : null);
  if (c.kind === "no_conduct_test") return `${doc.name} ${doc.plural ? "have" : "has"} no test of the account user's conduct.`;
  const topic = CONDUCT_TOPICS[c.marker];
  if (c.kind === "does_not_refer_to") return `${doc.name} ${doc.plural ? "do" : "does"} not refer to ${topic}.`;
  const pinned = r.find(c.clauseKey, c.onDate);
  return `${doc.name} ${doc.plural ? "refer" : "refers"} to ${topic} in ${clauseWords(c.clauseKey, pinned?.clauseRef ?? null)}${refs([pinned?.id])}.`;
}

// wording awaiting Elena's approval: an activity in the 12-hour block, in words.
function activityWords(a: TwelveHourActivity, cards: readonly CardAuthEvent[]): string {
  if (a.source.fact === "access_events") return ACCESS_EVENT_WORDS[a.source.kind];
  if (a.source.kind === "wallet_provisioned") return "Card added to a mobile wallet";
  const card = cards[a.source.index];
  const parts = ["Card payment", card?.merchant ? `at ${card.merchant}` : null, card?.amount ? `of ${formatMoney(card.amount)}` : null];
  return parts.filter(Boolean).join(" ");
}

function twelveHourLines(b: TwelveHourBlock, cards: readonly CardAuthEvent[], r: SectionRefs): PrintedLine[] {
  const what = b.trigger === "token_activated" ? "a digital token activated" : "a login recorded as from a new device";
  const out: PrintedLine[] = [
    { kind: "heading", text: TWELVE_HOUR_BLOCK_HEADINGS.block },
    { kind: "paragraph", text: TWELVE_HOUR_WORDING.activation(what, formatDateTime(b.activation.at), b.activation.deviceLabel) + refs(b.activation.evidenceIds) },
  ];
  for (const [heading, list] of [[TWELVE_HOUR_BLOCK_HEADINGS.named, b.named], [TWELVE_HOUR_BLOCK_HEADINGS.other, b.other]] as const) {
    out.push({ kind: "heading", text: heading });
    if (!list.length) out.push({ kind: "paragraph", text: TWELVE_HOUR_WORDING.none });
    for (const a of list) {
      const device = a.deviceLabel ? `device labelled '${a.deviceLabel}'` : a.deviceRef ? `device ${a.deviceRef}` : null;
      const text = [`${formatDateTime(a.at)} (${formatGap(a.sinceActivationMs)} after)`, activityWords(a, cards), device].filter(Boolean).join(": ");
      out.push({ kind: "bullet", text: `${text}${refs(a.evidenceIds)}` });
    }
  }
  for (const s of b.statements) out.push(...statementLines(s, r));
  if (b.walletCheckPointer) out.push({ kind: "paragraph", text: TWELVE_HOUR_WORDING.walletPointer });
  return out;
}

function quotationLines(q: QuotationLine, r: SectionRefs): PrintedLine[] {
  const first = q.passages[0] ? r.find(q.passages[0].clauseKey, q.readOn) : null;
  const title = first?.documentTitle ?? q.documentKey;
  const intro = q.intro?.text ? `${q.intro.text}${refs(q.evidenceIds)}` : QUOTATION_FALLBACK_INTRO(title, q.documentDate);
  const out: PrintedLine[] = [{ kind: "paragraph", text: intro }];
  for (const p of q.passages) {
    const pinned = r.find(p.clauseKey, q.readOn);
    out.push({ kind: "bullet", text: `"${p.text}" (${clauseWords(p.clauseKey, p.clauseRef)}${pinned ? `, ${pinned.id}` : ""})` });
  }
  if (q.sourceUrl) out.push({ kind: "paragraph", text: `${title}: ${q.sourceUrl}` });
  if (q.documentDatedAfterEvents) out.push({ kind: "paragraph", text: afterTheEventsLine(q.documentDatedAfterEvents) });
  return out;
}

function recordLine(fields: Record<string, string | null>, evidenceIds: string[]): PrintedLine {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => `${RECORD_FIELD_LABELS[k] ?? k.replace(/_/g, " ")}: ${v}`);
  return { kind: "bullet", text: `${parts.join("; ")}${refs(evidenceIds)}` };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const isSrf = (key: string) => key.startsWith("mas.srf/");
const isEupg = (key: string) => key.startsWith("mas.eupg/");

/** Lane 3 prints an SRF line, perhaps its link statement, then an EUPG line with the same record: one record. */
function pairedEupg(lines: readonly SectionLine[], i: number): number | null {
  const a = lines[i];
  if (a.kind !== "comparison" || !isSrf(a.comparison.clauseKey)) return null;
  let j = i + 1;
  while (j < lines.length && lines[j].kind === "statement") j++;
  const b = lines[j];
  if (!b || b.kind !== "comparison" || !isEupg(b.comparison.clauseKey)) return null;
  const same = a.comparison.record === b.comparison.record && a.comparison.outcome === b.comparison.outcome &&
    a.comparison.evidenceIds.join() === b.comparison.evidenceIds.join();
  return same ? j : null;
}

function renderSection(result: SectionResult, citations: Citations, cards: readonly CardAuthEvent[]): PrintedLine[] {
  const r = sectionRefs(result, citations);
  const out: PrintedLine[] = [];
  const lines = result.lines;
  const used = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    switch (line.kind) {
      case "comparison": {
        const j = pairedEupg(lines, i);
        if (j !== null) {
          used.add(j);
          out.push(...comparisonLines([line.comparison, (lines[j] as Extract<SectionLine, { kind: "comparison" }>).comparison], r));
          // The link statements between the two print after the record, as they would have.
          for (let k = i + 1; k < j; k++) {
            used.add(k);
            out.push(...statementLines((lines[k] as Extract<SectionLine, { kind: "statement" }>).statement, r));
          }
        } else {
          out.push(...comparisonLines([line.comparison], r));
        }
        break;
      }
      case "statement":
        out.push(...statementLines(line.statement, r));
        break;
      case "conduct":
        out.push({ kind: "paragraph", text: conductText(line.conduct, line.evidenceIds, r) });
        break;
      case "twelve_hours":
        out.push(...twelveHourLines(line.block, cards, r));
        break;
      case "quotation":
        out.push(...quotationLines(line.quotation, r));
        break;
      case "account_status":
        // No outcome and no ending (contract CREDIT_RECORDS_RULE).
        out.push({ kind: "paragraph", text: `${creditAccountStatusLine(line.status)}${refs(line.evidenceIds)}` });
        break;
      case "text": {
        const ids = line.clauseKeys.map((k) => r.find(k)?.id);
        const text = `${line.step !== null ? `${line.step}. ` : ""}${line.text}${refs([...line.evidenceIds, ...ids])}`;
        out.push({ kind: line.step !== null ? "bullet" : "paragraph", text });
        break;
      }
      case "record":
        out.push(recordLine(line.fields, line.evidenceIds));
        break;
    }
  }
  return out;
}

/**
 * The printed sections (those with lines, in the given order), the pinned citations numbered from `firstClauseNumber`
 * (after the clauses the model's own duties section cites), the statement revisions printed and every flag.
 */
export function renderUpdateSections(
  results: readonly SectionResult[],
  options: { firstClauseNumber?: number; cards?: readonly CardAuthEvent[] } = {},
): RenderedUpdate {
  const citations = new Citations(options.firstClauseNumber ?? 1);
  const sections: PrintedSection[] = [];
  const statements: PinnedStatement[] = [];
  const flags: RenderedUpdate["flags"] = [];
  for (const result of results) {
    const lines = renderSection(result, citations, options.cards ?? []);
    for (const f of result.flags) flags.push({ ...f, sectionId: result.sectionId });
    const printed = (s: StatementLine) => {
      if (s.statementId && s.revision !== null && s.text !== null) {
        statements.push({ sectionId: result.sectionId, statementKey: s.statementKey, statementId: s.statementId, revision: s.revision, onDate: s.onDate });
      }
    };
    for (const line of result.lines) {
      if (line.kind === "statement") printed(line.statement);
      if (line.kind === "twelve_hours") line.block.statements.forEach(printed);
      if (line.kind === "quotation" && line.quotation.intro) printed(line.quotation.intro);
    }
    // A run of identical paragraphs (several statements under review in a row) prints once.
    const kept = lines.filter((l, i) => i === 0 || l.kind !== "paragraph" || l.text !== lines[i - 1].text);
    if (!kept.length) continue;
    const standing = LAYER_STANDING_SENTENCES[result.sectionId];
    sections.push({
      id: result.sectionId,
      heading: SECTION_HEADINGS[result.sectionId],
      lines: standing ? [{ kind: "paragraph", text: standing }, ...kept] : kept,
    });
  }
  return { sections, citations: citations.all(), statements, flags };
}

/** Every printed line as plain text, in order (for checks and tests). */
export function printedText(rendered: Pick<RenderedUpdate, "sections">): string[] {
  return rendered.sections.flatMap((s) => [s.heading, ...s.lines.map((l) => l.text)]);
}
