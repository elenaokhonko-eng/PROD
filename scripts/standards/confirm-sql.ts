// The SQL that applies a person's confirmations to a database: reviews of what rests on a version, the version's
// move to verified, and statements' move to approved. Only what the plan calls ready is written.
//
// Every step first checks that the database holds the content the record covers (the source file's hash, every
// clause's hash, the statement's wording) and stops the whole run if it does not. The database's own triggers then
// decide: a version with an unreviewed dependant, or a statement resting on a clause that is not verified and in
// force, is refused there. Running the SQL again changes no row.

import type { ConfirmationPlan, PlannedApproval, PlannedReview, PlannedVersion } from "./confirmations.ts"
import { sqlLiteral, sqlTextArray } from "./sql.ts"

function timestamp(value: string): string {
  return `${sqlLiteral(value)}::timestamptz`
}

function reviewSql(v: PlannedVersion, r: PlannedReview): string {
  const values = `${sqlTextArray(r.clause_text_sha256)}, ${sqlLiteral(r.outcome)}, ${sqlLiteral(r.by)}, ${timestamp(r.at)}, ${sqlLiteral(r.note)}`
  const update = `DO UPDATE SET clause_text_sha256 = EXCLUDED.clause_text_sha256, outcome = EXCLUDED.outcome,
      reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at, note = EXCLUDED.note
    WHERE (r.clause_text_sha256, r.outcome, r.reviewed_by, r.reviewed_at, r.note)
      IS DISTINCT FROM (EXCLUDED.clause_text_sha256, EXCLUDED.outcome, EXCLUDED.reviewed_by, EXCLUDED.reviewed_at, EXCLUDED.note)`
  if (r.kind === "statement") {
    const name = `${r.id} r${r.revision}`
    const match = `s.statement_key = ${sqlLiteral(r.id)} AND s.revision = ${r.revision}
      AND encode(sha256(convert_to(s.text, 'UTF8')), 'hex') = ${sqlLiteral(r.text_sha256)}`
    return `  IF NOT EXISTS (SELECT 1 FROM public.definition_statements s WHERE ${match}) THEN
    RAISE EXCEPTION 'confirm: statement % is not loaded with the wording that was reviewed', ${sqlLiteral(name)};
  END IF;
  INSERT INTO public.standard_dependant_reviews AS r (version_id, statement_id, clause_text_sha256, outcome, reviewed_by, reviewed_at, note)
  SELECT v_id, s.id, ${values} FROM public.definition_statements s WHERE ${match}
  ON CONFLICT (version_id, statement_id) WHERE statement_id IS NOT NULL ${update};`
  }
  return `  IF NOT EXISTS (SELECT 1 FROM public.standard_rule_citations c WHERE c.rule_id = ${sqlLiteral(r.id)}) THEN
    RAISE EXCEPTION 'confirm: rule % is not in standard_rule_citations', ${sqlLiteral(r.id)};
  END IF;
  INSERT INTO public.standard_dependant_reviews AS r (version_id, rule_cite, clause_text_sha256, outcome, reviewed_by, reviewed_at, note)
  VALUES (v_id, ${sqlLiteral(r.id)}, ${values})
  ON CONFLICT (version_id, rule_cite) WHERE rule_cite IS NOT NULL ${update};`
}

function versionSql(v: PlannedVersion): string {
  const d = v.manifest.document
  const ver = v.manifest.version
  const name = sqlLiteral(`${d.document_key}, ${ver.version_label}`)
  const clauses = v.manifest.clauses.map((c) => `  (${sqlLiteral(c.clause_key)}, ${sqlLiteral(c.text_sha256)})`).join(",\n")
  return `-- ${d.document_key}, ${ver.version_label} (${v.file}): confirmed by ${v.by} at ${v.at}.
TRUNCATE _confirm_clauses;
INSERT INTO _confirm_clauses (clause_key, text_sha256) VALUES
${clauses};

DO $confirm$
DECLARE
  v_id uuid;
  v_status text;
  v_file text;
  v_by text;
  v_at timestamptz;
BEGIN
  SELECT v.id, v.status, v.content_sha256, v.verified_by, v.verified_at INTO v_id, v_status, v_file, v_by, v_at
  FROM public.standard_document_versions v JOIN public.standard_documents d ON d.id = v.document_id
  WHERE d.document_key = ${sqlLiteral(d.document_key)} AND v.version_label = ${sqlLiteral(ver.version_label)};
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'confirm: % is not loaded', ${name};
  END IF;
  IF v_file IS DISTINCT FROM ${sqlLiteral(ver.content_sha256)} THEN
    RAISE EXCEPTION 'confirm: % holds a different source file from the one confirmed', ${name};
  END IF;
  IF EXISTS (
    (SELECT c.clause_key, c.text_sha256 FROM public.standard_clauses c WHERE c.version_id = v_id
     EXCEPT SELECT m.clause_key, m.text_sha256 FROM _confirm_clauses m)
    UNION ALL
    (SELECT m.clause_key, m.text_sha256 FROM _confirm_clauses m
     EXCEPT SELECT c.clause_key, c.text_sha256 FROM public.standard_clauses c WHERE c.version_id = v_id)
  ) THEN
    RAISE EXCEPTION 'confirm: % holds different clauses from the ones confirmed', ${name};
  END IF;
  IF v_status = 'verified' THEN
    IF v_by IS DISTINCT FROM ${sqlLiteral(v.by)} OR v_at IS DISTINCT FROM ${timestamp(v.at)} THEN
      RAISE NOTICE 'confirm: % was already verified by % at %; left as it is', ${name}, v_by, v_at;
    END IF;
    RETURN;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'confirm: % is %, not a draft', ${name}, v_status;
  END IF;

${v.reviews.map((r) => reviewSql(v, r)).join("\n\n")}${v.reviews.length ? "\n\n" : ""}  UPDATE public.standard_document_versions
  SET status = 'verified', verified_by = ${sqlLiteral(v.by)}, verified_at = ${timestamp(v.at)}
  WHERE id = v_id;
END
$confirm$;`
}

function approvalSql(a: PlannedApproval): string {
  const s = a.statement
  const name = sqlLiteral(`${s.statement_key} r${s.revision}`)
  return `-- Statement ${s.statement_key} r${s.revision}: approved by ${a.by} at ${a.at}, as of ${a.clauses_as_of}.
DO $confirm$
DECLARE
  s_id uuid;
  s_status text;
  s_by text;
  s_at timestamptz;
BEGIN
  SELECT s.id, s.status, s.approved_by, s.approved_at INTO s_id, s_status, s_by, s_at
  FROM public.definition_statements s
  WHERE s.statement_key = ${sqlLiteral(s.statement_key)} AND s.revision = ${s.revision}
    AND encode(sha256(convert_to(s.text, 'UTF8')), 'hex') = ${sqlLiteral(a.text_sha256)};
  IF s_id IS NULL THEN
    RAISE EXCEPTION 'confirm: statement % is not loaded with the wording that was approved', ${name};
  END IF;
  IF s_status = 'approved' THEN
    IF s_by IS DISTINCT FROM ${sqlLiteral(a.by)} OR s_at IS DISTINCT FROM ${timestamp(a.at)} THEN
      RAISE NOTICE 'confirm: statement % was already approved by % at %; left as it is', ${name}, s_by, s_at;
    END IF;
    RETURN;
  END IF;
  IF s_status <> 'draft' THEN
    RAISE EXCEPTION 'confirm: statement % is %, not a draft', ${name}, s_status;
  END IF;
  UPDATE public.definition_statements
  SET status = 'approved', approved_by = ${sqlLiteral(a.by)}, approved_at = ${timestamp(a.at)}, clauses_as_of = ${sqlLiteral(a.clauses_as_of)}::date
  WHERE id = s_id;
END
$confirm$;`
}

/** Null when nothing is ready or the records have errors. */
export function buildConfirmSql(plan: ConfirmationPlan): string | null {
  if (plan.errors.length) return null
  const versions = plan.versions.filter((v) => !v.waitingOn.length)
  const approvals = plan.approvals.filter((a) => !a.waitingOn.length)
  if (!versions.length && !approvals.length) return null
  return `-- Generated by scripts/standards/confirm.ts from supabase/standards/confirmations. Applies a person's recorded
-- confirmations: ${versions.length} version(s), ${approvals.length} statement(s). Run with psql; a second run changes nothing.
\\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _confirm_clauses (clause_key text PRIMARY KEY, text_sha256 text NOT NULL) ON COMMIT DROP;

${[...versions.map(versionSql), ...approvals.map(approvalSql)].join("\n\n")}

COMMIT;
`
}
