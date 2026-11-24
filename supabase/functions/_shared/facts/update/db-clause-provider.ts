// The database-backed ClauseProvider (Lane 6, assembly; lanes plan, Lane 6 item 3). It reads the corpus only through
// the as-of functions (brief v5 3.2 rule 9), with the same rules as the contract's fake provider:
//
//   getClauseAsOf     get_clause_as_of_v1(p_clause_key, p_on_date)                 (20261201120000)
//   getClausesByTag   get_clauses_by_tag_v1(p_tag, p_institution, p_on_date)       (20261201120000)
//   getStatementAsOf  get_statement_as_of_v1(p_statement_key, p_on_date)           (20261202120000; a statement with
//                     no approved revision for the wording in force comes back empty: "statement under review")
//   getAsOfRule       get_document_as_of_rule_v1(p_document_key)                   (20261204120000, Decision 6)
//   getNearestClause  get_clause_nearest_v1(p_clause_key, p_on_date)               (20261205120000, Lane 6; Elena's
//                     approval needed before merge)
//
// Driver-neutral: the caller passes an RPC function (supabase-js `rpc` in the Edge Function, psql in the local
// database test). Every read is remembered for the life of the provider (one pack), so a section that asks twice
// makes one call. Errors name the function and the database's error code only.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import {
  AS_OF_FUNCTIONS,
  type AsOfRule,
  type BindingLevel,
  type ClauseAsOf,
  type ClauseProvider,
  type CorpusInstrument,
  type IsoDate,
  type NearestClause,
  type NearestClauseRelation,
  PROPOSED_AS_OF_FUNCTIONS,
  type StatementAsOf,
  type StatementFramework,
} from "./contract.ts";
import { parseTermRequestRows, type TermRequestRow, type TermRequestSource } from "../rules/institution-terms.ts";

/** One RPC: the function name and its named arguments; `data` is the function's rows (or its scalar). */
export type RpcCall = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string | null; message?: string } | null }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(onDate: IsoDate): void {
  if (!ISO_DATE.test(onDate)) throw new Error(`clause provider: not a date: ${onDate}`);
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));
const date = (v: unknown): IsoDate | null => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);

/** Postgres arrays arrive as arrays from PostgREST and as "{a,b}" text from some drivers. */
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") {
    const inner = v.replace(/^\{|\}$/g, "");
    return inner ? inner.split(",").map((x) => x.replace(/^"|"$/g, "")) : [];
  }
  return [];
}

function rows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object") return [data as Record<string, unknown>];
  return [];
}

export function clauseFromRow(row: Record<string, unknown>): ClauseAsOf {
  return {
    clause_id: String(row.clause_id),
    clause_key: String(row.clause_key),
    clause_ref: text(row.clause_ref),
    heading_path: list(row.heading_path),
    text_content: String(row.text_content ?? ""),
    text_sha256: String(row.text_sha256 ?? ""),
    tags: list(row.tags),
    version_id: String(row.version_id),
    version_label: String(row.version_label ?? ""),
    effective_from: date(row.effective_from) as IsoDate,
    effective_to: date(row.effective_to),
    document_key: String(row.document_key),
    title: String(row.title ?? ""),
    publisher: String(row.publisher ?? ""),
    binding_level: String(row.binding_level) as BindingLevel,
    institution: text(row.institution),
    card_scheme: (text(row.card_scheme) as ClauseAsOf["card_scheme"]) ?? null,
    source_url: text(row.source_url),
    coverage: (text(row.coverage) ?? "full") as ClauseAsOf["coverage"],
    instrument_scope: list(row.instrument_scope) as CorpusInstrument[],
  };
}

export function statementFromRow(row: Record<string, unknown>): StatementAsOf {
  return {
    statement_id: String(row.statement_id),
    statement_key: String(row.statement_key),
    revision: Number(row.revision),
    framework: String(row.framework) as StatementFramework,
    applies_to_instrument: list(row.applies_to_instrument) as CorpusInstrument[],
    text: String(row.text ?? ""),
    clause_keys: list(row.clause_keys),
    clauses_as_of: date(row.clauses_as_of) as IsoDate,
    approved_by: String(row.approved_by ?? ""),
    approved_at: String(row.approved_at ?? ""),
  };
}

const NEAREST_RELATIONS: readonly NearestClauseRelation[] = ["in_force", "earlier_version", "later_version"];

/** Reads one `institution_term_requests` row (institution, product, purpose), or null. */
export type TermRequestRowLoader = (institution: string, product: string, purpose: string) => Promise<Record<string, unknown> | null>;

/**
 * The institutions' configured term requests from the table (4e; the wallet page row, Decision 5). Each row is checked
 * as Lane 4's seed parser checks it; a `wallet_provisioning` row keeps the columns a person filled from the page.
 */
export function createDbTermRequestSource(load: TermRequestRowLoader): TermRequestSource {
  const memo = new Map<string, Promise<TermRequestRow | null>>();
  return {
    getTermRequest(institution, product, purpose) {
      const key = `${institution}|${product}|${purpose}`;
      let hit = memo.get(key);
      if (!hit) {
        hit = load(institution, product, purpose).then((row) => {
          if (!row) return null;
          const [parsed] = parseTermRequestRows([row]);
          const wallet = Object.fromEntries(Object.entries(row).filter(([k]) => k.startsWith("wallet_")));
          return { ...parsed, ...wallet } as TermRequestRow;
        });
        memo.set(key, hit);
      }
      return hit;
    },
  };
}

export function createDbClauseProvider(rpc: RpcCall): ClauseProvider {
  const memo = new Map<string, Promise<unknown>>();

  async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await rpc(fn, args);
    if (error) throw new Error(`clause provider: ${fn} failed (${error.code ?? "unknown"})`);
    return data;
  }

  function remembered<T>(fn: string, args: Record<string, unknown>, map: (data: unknown) => T): Promise<T> {
    const key = `${fn}|${JSON.stringify(args)}`;
    let hit = memo.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = call(fn, args).then(map);
      // A failed read is not remembered, so a retry can succeed.
      hit.catch(() => memo.delete(key));
      memo.set(key, hit);
    }
    return hit;
  }

  return {
    getClauseAsOf(clauseKey, onDate) {
      requireDate(onDate);
      return remembered(AS_OF_FUNCTIONS.getClauseAsOf, { p_clause_key: clauseKey, p_on_date: onDate }, (data) => {
        const found = rows(data);
        // The database allows one current verified version per document; two rows mean the corpus is wrong.
        if (found.length > 1) throw new Error(`clause provider: ${clauseKey} is in force in ${found.length} versions on ${onDate}`);
        return found[0] ? clauseFromRow(found[0]) : null;
      });
    },
    getClausesByTag(tag, institution, onDate) {
      requireDate(onDate);
      return remembered(
        AS_OF_FUNCTIONS.getClausesByTag,
        { p_tag: tag, p_institution: institution, p_on_date: onDate },
        (data) => rows(data).map(clauseFromRow),
      );
    },
    getStatementAsOf(statementKey, onDate) {
      requireDate(onDate);
      return remembered(AS_OF_FUNCTIONS.getStatementAsOf, { p_statement_key: statementKey, p_on_date: onDate }, (data) => {
        const found = rows(data);
        return found[0] ? statementFromRow(found[0]) : null;
      });
    },
    getNearestClause(clauseKey, onDate): Promise<NearestClause | null> {
      requireDate(onDate);
      return remembered(PROPOSED_AS_OF_FUNCTIONS.getNearestClause, { p_clause_key: clauseKey, p_on_date: onDate }, (data) => {
        const row = rows(data)[0];
        if (!row) return null;
        const relation = String(row.relation) as NearestClauseRelation;
        if (!NEAREST_RELATIONS.includes(relation)) throw new Error(`clause provider: unknown relation for ${clauseKey}`);
        return { clause: clauseFromRow(row), relation, onDate };
      });
    },
    getAsOfRule(documentKey): Promise<AsOfRule> {
      return remembered(PROPOSED_AS_OF_FUNCTIONS.getAsOfRule, { p_document_key: documentKey }, (data) => {
        const value = Array.isArray(data) ? (data[0] as unknown) : data;
        const rule = typeof value === "object" && value !== null ? Object.values(value)[0] : value;
        return rule === "any_date" ? "any_date" : "event_date";
      });
    },
  };
}
