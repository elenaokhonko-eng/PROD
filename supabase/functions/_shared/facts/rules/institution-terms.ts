// Configured term requests (FIDReC standards brief v5, 4e; decision 12): "this institution's definition, in force on
// this date", read by a configured request per institution, product and purpose, never by similarity.
//
// The rows mirror `public.institution_term_requests` (supabase/migrations/20261201120000_standards_corpus.sql) and
// the seed files Lane 5 writes under `supabase/standards/seeds/term-requests/*.json`. Resolution uses only the
// provider's as-of functions: `getClauseAsOf` for a selector of confirmed clause keys, `getClausesByTag` for a
// selector of tags; either way only clauses of the request's own document count.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type { AccountType } from "../keys.ts";
import type { ClauseAsOf, ClauseProvider, ClauseTag, DisputedPayment, IsoDate } from "../update/contract.ts";
import { CLAUSE_TAGS } from "../update/contract.ts";
import { formatDate, type SectionCollector } from "./account-access-sequence.ts";

export const TERM_PRODUCTS = ["account", "digital_banking", "credit_card", "debit_card", "ewallet"] as const;
export type TermProduct = (typeof TERM_PRODUCTS)[number];

export const TERM_PURPOSES = [
  "fault_definition",
  "customer_security_duty",
  "liability_unauthorised",
  "notification_deadline",
  "dispute_chargeback",
  "conclusive_evidence",
] as const;
export type TermPurpose = (typeof TERM_PURPOSES)[number];

export const TERM_QUOTE_MODES = ["quote", "reference_only"] as const;
export type TermQuoteMode = (typeof TERM_QUOTE_MODES)[number];

/** Set by a person at ingestion for `fault_definition`, reviewed with each new version (3.2 rule 8). */
export const TERM_OUTCOMES = ["defines", "uses_undefined", "not_used"] as const;
export type TermOutcome = (typeof TERM_OUTCOMES)[number];

export type TermSelector = { clause_keys: string[] } | { tags: ClauseTag[] };

/** One `institution_term_requests` row (database column names), as read from the table or a seed file. */
export interface TermRequestRow {
  institution: string;
  product: TermProduct;
  purpose: TermPurpose;
  document_key: string;
  selector: TermSelector;
  quote_mode: TermQuoteMode;
  term_outcome: TermOutcome | null;
  term: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

/** Where the rows come from: the seed files in tests and before the load, the table once Lane 6's provider reads it. */
export interface TermRequestSource {
  getTermRequest(institution: string, product: TermProduct, purpose: TermPurpose): Promise<TermRequestRow | null>;
}

const DOCUMENT_KEY = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/;
const CLAUSE_KEY = /^[a-z0-9]+(\.[a-z0-9_-]+)+\/[a-z0-9._()~-]+$/;

function fail(index: number, message: string): never {
  throw new Error(`term request ${index}: ${message}`);
}

/**
 * Checks rows read from a seed file against the table's constraints (one row per institution, product and purpose;
 * a selector of clause keys or tags; a term unless the outcome is `not_used`; confirmed by and at together).
 */
export function parseTermRequestRows(json: unknown): TermRequestRow[] {
  if (!Array.isArray(json)) throw new Error("term requests: expected an array of rows");
  const seen = new Set<string>();
  return json.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) fail(i, "not an object");
    const r = raw as Record<string, unknown>;
    const str = (k: string) => (typeof r[k] === "string" && (r[k] as string).trim() !== "" ? (r[k] as string) : null);
    const institution = str("institution") ?? fail(i, "institution is required");
    const product = str("product");
    if (!product || !(TERM_PRODUCTS as readonly string[]).includes(product)) fail(i, `product: ${String(r.product)}`);
    const purpose = str("purpose");
    if (!purpose || !(TERM_PURPOSES as readonly string[]).includes(purpose)) fail(i, `purpose: ${String(r.purpose)}`);
    const documentKey = str("document_key");
    if (!documentKey || !DOCUMENT_KEY.test(documentKey)) fail(i, `document_key: ${String(r.document_key)}`);
    const sel = r.selector as Record<string, unknown> | null | undefined;
    let selector: TermSelector;
    if (sel && Array.isArray(sel.clause_keys)) {
      const keys = sel.clause_keys as unknown[];
      if (keys.length === 0) fail(i, "selector.clause_keys is empty");
      for (const k of keys) {
        if (typeof k !== "string" || !CLAUSE_KEY.test(k) || !k.startsWith(`${documentKey}/`)) {
          fail(i, `selector clause key ${String(k)} is not a clause of ${documentKey}`);
        }
      }
      selector = { clause_keys: keys as string[] };
    } else if (sel && Array.isArray(sel.tags)) {
      const tags = sel.tags as unknown[];
      if (tags.length === 0) fail(i, "selector.tags is empty");
      for (const t of tags) if (!(CLAUSE_TAGS as readonly unknown[]).includes(t)) fail(i, `selector tag ${String(t)}`);
      selector = { tags: tags as ClauseTag[] };
    } else {
      fail(i, "selector needs clause_keys or tags");
    }
    const quoteMode = r.quote_mode === undefined ? "quote" : r.quote_mode;
    if (!(TERM_QUOTE_MODES as readonly unknown[]).includes(quoteMode)) fail(i, `quote_mode: ${String(quoteMode)}`);
    const outcome = r.term_outcome ?? null;
    if (outcome !== null && !(TERM_OUTCOMES as readonly unknown[]).includes(outcome)) fail(i, `term_outcome: ${String(outcome)}`);
    const term = str("term");
    if (outcome !== null && outcome !== "not_used" && term === null) fail(i, "term is required unless term_outcome is not_used");
    const confirmedBy = str("confirmed_by");
    const confirmedAt = str("confirmed_at");
    if ((confirmedBy === null) !== (confirmedAt === null)) fail(i, "confirmed_by and confirmed_at go together");
    const unique = `${institution}|${product}|${purpose}`;
    if (seen.has(unique)) fail(i, `duplicate request for ${unique}`);
    seen.add(unique);
    return {
      institution,
      product: product as TermProduct,
      purpose: purpose as TermPurpose,
      document_key: documentKey!,
      selector,
      quote_mode: quoteMode as TermQuoteMode,
      term_outcome: outcome as TermOutcome | null,
      term,
      confirmed_by: confirmedBy,
      confirmed_at: confirmedAt,
    };
  });
}

/** An in-memory source over rows (seed files, tests). */
export function createStaticTermRequestSource(rows: readonly TermRequestRow[]): TermRequestSource {
  return {
    getTermRequest(institution, product, purpose) {
      return Promise.resolve(
        rows.find((r) => r.institution === institution && r.product === product && r.purpose === purpose) ?? null,
      );
    },
  };
}

export const NO_TERM_REQUESTS: TermRequestSource = createStaticTermRequestSource([]);

/**
 * The products a payment was made on. Account transfers: the account terms and the digital banking terms. Card
 * payments: the credit or debit card agreement as the confirmed account types say; both when they do not say.
 */
export function productsForPayment(payment: DisputedPayment, accountTypes: readonly AccountType[]): TermProduct[] {
  switch (payment.instrument) {
    case "account_transfer":
      return ["account", "digital_banking"];
    case "ewallet":
      return ["ewallet"];
    case "sg_card": {
      const cards: TermProduct[] = [];
      if (accountTypes.includes("credit_card")) cards.push("credit_card");
      if (accountTypes.includes("debit_card")) cards.push("debit_card");
      return cards.length ? cards : ["credit_card", "debit_card"];
    }
    default:
      return [];
  }
}

export type ResolvedTermRequest =
  | { status: "no_request"; institution: string | null; product: TermProduct; purpose: TermPurpose; onDate: IsoDate }
  | { status: "not_held"; request: TermRequestRow; onDate: IsoDate; missingClauseKeys: string[] }
  | { status: "held"; request: TermRequestRow; onDate: IsoDate; clauses: ClauseAsOf[] };

/**
 * Resolves a configured request as of a date. With confirmed clause keys every key must be held on the date (a partial
 * set is `not_held`, listing what is missing); with tags, the request's document's clauses carrying any of the tags.
 * Another institution's contract is never returned (`getClausesByTag` filters by institution).
 */
export async function resolveTermRequest(
  source: TermRequestSource,
  provider: ClauseProvider,
  query: { institution: string | null; product: TermProduct; purpose: TermPurpose; onDate: IsoDate },
): Promise<ResolvedTermRequest> {
  const { institution, product, purpose, onDate } = query;
  const request = institution ? await source.getTermRequest(institution, product, purpose) : null;
  if (!request) return { status: "no_request", institution, product, purpose, onDate };

  if ("clause_keys" in request.selector) {
    const clauses: ClauseAsOf[] = [];
    const missing: string[] = [];
    for (const key of request.selector.clause_keys) {
      const clause = await provider.getClauseAsOf(key, onDate);
      if (clause && clause.document_key === request.document_key && clause.institution === request.institution) {
        clauses.push(clause);
      } else missing.push(key);
    }
    return missing.length ? { status: "not_held", request, onDate, missingClauseKeys: missing } : { status: "held", request, onDate, clauses };
  }

  const clauses: ClauseAsOf[] = [];
  for (const tag of request.selector.tags) {
    for (const clause of await provider.getClausesByTag(tag, request.institution, onDate)) {
      if (clause.document_key !== request.document_key) continue;
      if (!clauses.some((c) => c.clause_id === clause.clause_id)) clauses.push(clause);
    }
  }
  return clauses.length ? { status: "held", request, onDate, clauses } : { status: "not_held", request, onDate, missingClauseKeys: [] };
}

/**
 * Prints a resolved `fault_definition` request (4e): the attributed clause (quoted, or reference and link when
 * `quote_mode = reference_only`), then one fixed line chosen by code from the person-set outcome.
 */
export function printFaultDefinition(out: SectionCollector, resolved: ResolvedTermRequest, institutionName: string): void {
  const on = formatDate(resolved.onDate);
  if (resolved.status !== "held") {
    if (resolved.status === "not_held") {
      for (const key of resolved.missingClauseKeys) out.flag("clause_not_held", key, resolved.onDate);
      if (resolved.missingClauseKeys.length === 0) out.flag("clause_not_held", resolved.request.document_key, resolved.onDate);
    }
    // The as-of functions do not return the nearest version, so the "nearest version held is dated" variant waits on a
    // provider read for it (requested of Lane 6).
    out.text(`${institutionName}'s terms in force on ${on} are not held.`);
    return;
  }
  const { request, clauses } = resolved;
  for (const clause of clauses) {
    out.cite(clause, resolved.onDate);
    const ref = clause.clause_ref ? `, clause ${clause.clause_ref}` : "";
    const head = `${institutionName}'s ${clause.title}, version in force on ${on}${ref}:`;
    if (request.quote_mode === "quote") {
      out.text(head, { clauseKeys: [clause.clause_key] });
      out.text(`"${clause.text_content}"`, { clauseKeys: [clause.clause_key] });
    } else {
      out.text(`${head} ${clause.source_url ?? "link not held"}`, { clauseKeys: [clause.clause_key] });
    }
  }
  const keys = clauses.map((c) => c.clause_key);
  if (request.term_outcome === "defines") out.text(`The clause defines '${request.term}'.`, { clauseKeys: keys });
  else if (request.term_outcome === "uses_undefined") out.text(`The terms use '${request.term}' and do not define it.`, { clauseKeys: keys });
  else if (request.term_outcome === "not_used") {
    out.text(`The terms in force on ${on} do not use the terms negligence, gross negligence or recklessness.`, { clauseKeys: keys });
  }
}
