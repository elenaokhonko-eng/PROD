// Which EUPG and SRF paragraphs apply to which kind of payment (FIDReC standards brief v5, Phase 0b, decision 18).
// Every retrieval path filters with it and every rule guards with it, so a card payment is never set against a
// paragraph that does not apply to cards.
//
// E = MAS E-Payments User Protection Guidelines (from 16 Dec 2024); G = MAS/IMDA Guidelines on Shared Responsibility
// Framework (issued 24 Oct 2024, effective 16 Dec 2024).
// - E 4.1: Section 4 does not apply to credit, charge or debit card transactions, except 4.2-4.6, 4.10-4.12, 4.14-4.16.
// - E 5.1, 6.1, 7.8: Sections 5 and 6, and the dispute process where the issuer resolves under card scheme rules, do
//   not apply to card transactions.
// - G footnote 1: the responsibility sharing does not apply to cards issued in Singapore.
// - The ABS Code of Practice for Banks - Credit Cards applies to card payments only.
//
// Until the versioned corpus gives each clause a clause_key, the document is read from its key, title or source and
// the paragraph from clause_ref or, where that is empty (EUPG and SRF rows today), from the start of the clause text.

import type { Instrument } from "../keys.ts";

export type StandardFamily = "eupg" | "srf" | "abs_card_code" | "other";

export interface ClauseLocator {
  document_key?: string | null;
  document_title?: string | null;
  source?: string | null;
  source_ref?: string | null;
  title?: string | null;
  clause_ref?: string | null;
  text?: string | null;
}

function familyOf(label: string): StandardFamily {
  // The SRF first: its clause titles name the EUPG paragraphs they come from ("SRF – FI Duty: Adhere to EUPG Section 4").
  if (/shared responsibility|\bsrf\b/i.test(label)) return "srf";
  if (/e-payments|user protection|\beupg\b|\bepug\b/i.test(label)) return "eupg";
  if (/code of practice.*credit cards|\babs code\b/i.test(label)) return "abs_card_code";
  return "other";
}

/** The document decides; the clause's own title or reference only when no document name is given or recognised. */
export function standardFamily(clause: ClauseLocator): StandardFamily {
  const document = familyOf([clause.document_key, clause.document_title, clause.source].filter(Boolean).join(" "));
  return document !== "other" ? document : familyOf([clause.source_ref, clause.title].filter(Boolean).join(" "));
}

/** "4.10", "5.2", "4.2.1"; null for a definition or anything unnumbered. */
export function paragraphOf(clause: ClauseLocator): string | null {
  const ref = clause.clause_ref?.trim().match(/^\d+(?:\.\d+)+/);
  if (ref) return ref[0];
  // "5.2 The account holder…", or a section heading first: "4 Duties of the responsible FI 4.1 Section 4 does not…".
  const text = clause.text?.trim() ?? "";
  const lead = text.match(/^(?:\d+\s+[A-Za-z][^\d]{0,120}?\s+)?(\d+(?:\.\d+)+)\b/);
  return lead ? lead[1] : null;
}

const EUPG_CARD_PARAGRAPHS: ReadonlyArray<[number, number]> = [[2, 6], [10, 12], [14, 16]];

/** EUPG 4.1: the only paragraphs that apply to card transactions. */
export function eupgParagraphAppliesToCards(paragraph: string | null): boolean {
  if (!paragraph) return false;
  const [section, sub] = paragraph.split(".").map(Number);
  return section === 4 && EUPG_CARD_PARAGRAPHS.some(([from, to]) => sub >= from && sub <= to);
}

export function appliesToInstrument(clause: ClauseLocator, instrument: Instrument): boolean {
  const family = standardFamily(clause);
  if (instrument === "other") return true;
  if (instrument !== "sg_card") return family !== "abs_card_code";
  if (family === "srf") return false;
  if (family === "eupg") return eupgParagraphAppliesToCards(paragraphOf(clause));
  return true;
}

/** The case's payment kinds this clause applies to. An unknown kind (none recorded, or "other") filters nothing. */
export function instrumentsCovered(clause: ClauseLocator, instruments: ReadonlyArray<Instrument | null | undefined>): Instrument[] {
  const known = [...new Set(instruments.filter((i): i is Instrument => Boolean(i)))];
  return known.filter((i) => appliesToInstrument(clause, i));
}

export function appliesToCase(clause: ClauseLocator, instruments: ReadonlyArray<Instrument | null | undefined>): boolean {
  const known = instruments.filter((i): i is Instrument => Boolean(i));
  if (!known.length || known.length < instruments.length || known.includes("other")) return true;
  return instrumentsCovered(clause, known).length > 0;
}

const INSTRUMENT_WORDS: Record<Instrument, string> = {
  account_transfer: "bank account payments",
  sg_card: "card payments",
  ewallet: "e-wallet payments",
  other: "other payments",
};

/** Plain words for the payments a clause covers, for the model and the pack: "card payments", "all payments". */
export function appliesToLabel(clause: ClauseLocator, instruments: ReadonlyArray<Instrument | null | undefined>): string {
  const known = [...new Set(instruments.filter((i): i is Instrument => Boolean(i)))];
  const covered = instrumentsCovered(clause, known);
  if (!known.length || covered.length === known.length) return "all payments";
  return covered.map((i) => INSTRUMENT_WORDS[i]).join(" and ");
}

export function instrumentsOf(transactions: ReadonlyArray<{ instrument?: Instrument | null }> | null | undefined): Array<Instrument | null> {
  return (transactions ?? []).map((t) => t.instrument ?? null);
}
