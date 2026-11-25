// The SectionInput for a real case (Lane 6, assembly): built from the confirmed snapshot, the pack's evidence index,
// the case's stored IP lookups and the institution's code. The synthetic cases in tests/fixtures/fidrec-update are
// shaped the same way, so the sections see a real case exactly as they see the fixtures.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type { FactKey, Institution, Instrument, Transaction } from "../keys.ts";
import type { SnapshotFacts } from "../validate-output.ts";
import {
  type ClauseProvider,
  type ContractFactKey,
  type ContractFacts,
  type CreditAccountStatus,
  type DisputedPayment,
  IP_NETWORK_FLAGS,
  type IpLocation,
  type IpNetworkFlag,
  type IsoDate,
  type SectionInput,
} from "./contract.ts";

/** The labels a section may read a fact under (one rule for every section; review fix list, Lane 6). */
export const SECTION_FACT_LABELS = ["confirmed", "claimant_only"] as const;

const usable = (facts: SnapshotFacts, key: FactKey) => {
  const fact = facts[key];
  return fact && (SECTION_FACT_LABELS as readonly string[]).includes(fact.label) ? fact.value : null;
};

/**
 * Brief 4a, SRF footnote 8: payments left out of the drain test. Card payments (debit card payments are named; card
 * payments are not account payments), GIRO and eGIRO deductions, standing instructions, bill payments and own-account
 * transfers, as the payment's channel names them.
 */
export function excludedFromDrainTest(t: Pick<Transaction, "instrument" | "channel">): boolean {
  if (t.instrument === "sg_card") return true;
  return /\b(?:e-?giro|giro|standing instruction|bill payment|own[- ]account)\b/i.test(t.channel ?? "");
}

export function disputedPayments(facts: SnapshotFacts): DisputedPayment[] {
  const transactions = (usable(facts, "transactions") as Transaction[] | null) ?? [];
  return transactions.map((t, index) => ({ ...t, index, excludedFromDrainTest: excludedFromDrainTest(t) }));
}

/** E-numbers per fact, from the pack's evidence index (each entry lists the facts its document supports). */
export function evidenceIdsByFact(index: ReadonlyArray<{ id: string; facts: readonly string[] }>): SectionInput["evidenceIds"] {
  const out: Record<string, string[]> = {};
  for (const entry of index) {
    for (const fact of entry.facts) (out[fact] ??= []).includes(entry.id) || out[fact].push(entry.id);
  }
  return out as SectionInput["evidenceIds"];
}

/** A stored lookup (case_ip_locations, 20261204120200) as the contract's IpLocation. */
export function ipLocationFromRow(row: Record<string, unknown>): IpLocation {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const whole = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isSafeInteger(Number(v)) ? Number(v) : null);
  const flags = (Array.isArray(row.flags) ? row.flags : typeof row.flags === "string" ? row.flags.replace(/^\{|\}$/g, "").split(",") : [])
    .map(String)
    .filter((f): f is IpNetworkFlag => (IP_NETWORK_FLAGS as readonly string[]).includes(f));
  return {
    ip: String(row.ip ?? "").replace(/\/(32|128)$/, ""),
    country: text(row.country),
    region: text(row.region),
    city: text(row.city),
    accuracyRadiusKm: whole(row.accuracy_radius_km),
    asn: whole(row.asn),
    organisation: text(row.organisation),
    flags,
    database: String(row.database ?? ""),
    databaseEdition: String(row.database_edition ?? "").slice(0, 10),
    institutionStatedLocation: text(row.institution_stated_location),
  };
}

/** A document of the pack's evidence index with its text, for placing a status on its own document. */
export interface IndexedDocumentText {
  /** The E-number (E1…). */
  id: string;
  text: string | null;
}

/**
 * Each `credit_account_status` entry with no `evidenceId` gets the E-number of the one document whose text contains
 * the entry's `quote` word for word (Lane 6, 25 Nov 2026). With no such document, or more than one, it stays null and
 * the section falls back to every document behind the fact. Entries that already carry an E-number are kept as they are.
 */
export function withStatusEvidenceIds(facts: SnapshotFacts, documents: readonly IndexedDocumentText[]): SnapshotFacts {
  const fact = facts.credit_account_status;
  if (!fact || !Array.isArray(fact.value) || !documents.length) return facts;
  const statuses = (fact.value as CreditAccountStatus[]).map((s) => {
    if (s.evidenceId || !s.quote) return s;
    const found = documents.filter((d) => typeof d.text === "string" && d.text.includes(s.quote));
    return found.length === 1 ? { ...s, evidenceId: found[0].id } : s;
  });
  return { ...facts, credit_account_status: { ...fact, value: statuses } };
}

export function sectionInputFromSnapshot(args: {
  facts: SnapshotFacts;
  evidenceIndex: ReadonlyArray<{ id: string; facts: readonly string[] }>;
  /** standard_institutions.code for the case's institution (standard_institution_code_v1), or null. */
  institutionCode: string | null;
  ipLocations: readonly IpLocation[];
  provider: ClauseProvider;
  generatedOn: IsoDate;
  /** The index's documents with their text: each account status is placed on its own document (withStatusEvidenceIds). */
  documents?: readonly IndexedDocumentText[];
  /** CR-1: the E-numbers of the documents read as the police's reply (fidrec-pack.ts `policeReplyEvidenceIds`). */
  policeReplyEvidenceIds?: readonly string[];
}): SectionInput {
  const placed = withStatusEvidenceIds(args.facts, args.documents ?? []);
  const payments = disputedPayments(placed);
  const institutions = (usable(args.facts, "institution_names") as Institution[] | null) ?? [];
  const first = institutions[0] ?? null;
  const instruments = [...new Set(payments.map((p) => p.instrument).filter((i): i is Instrument => i !== null))];
  // The snapshot holds the contract's facts under the same keys and in the same { value, label } shape.
  const facts: ContractFacts = {};
  for (const [key, fact] of Object.entries(placed)) {
    if (fact) (facts as Record<string, unknown>)[key as ContractFactKey] = { value: fact.value, label: fact.label };
  }
  return {
    facts,
    payments,
    institution: first ? { name: first.name, type: first.type, code: args.institutionCode } : null,
    instruments,
    ipLocations: [...args.ipLocations],
    evidenceIds: evidenceIdsByFact(args.evidenceIndex),
    provider: args.provider,
    generatedOn: args.generatedOn,
    ...(args.policeReplyEvidenceIds?.length ? { policeReplyEvidenceIds: [...args.policeReplyEvidenceIds] } : {}),
  };
}
