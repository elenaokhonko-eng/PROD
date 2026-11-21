import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// FIDReC standards brief v5, section 3.2 rule 9: pack code reads clause text only through the as-of functions
// (match_standards_v1, get_clause_as_of_v1, get_clauses_by_tag_v1), never from the corpus tables directly.
// The database side (rules 3, 7, 8) is scripts/sql/tests/test_standards_corpus.sql.

const MIGRATION = 'supabase/migrations/20261122120000_standards_corpus.sql'
const REVIEW_LINKS = 'supabase/migrations/20261123120000_standards_review_links.sql'
const CORPUS_TABLES = [
  'standard_clauses', 'standard_document_versions', 'standard_documents', 'definition_statements', 'definition_statement_clauses',
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === '_archive' ? [] : sourceFiles(path)
    return /\.(ts|tsx|mts)$/.test(name) ? [path] : []
  })
}

test('no app or edge code reads the corpus tables directly', () => {
  const offenders: string[] = []
  for (const file of [...sourceFiles('lib'), ...sourceFiles('app'), ...sourceFiles('supabase/functions')]) {
    const source = readFileSync(file, 'utf8')
    for (const table of CORPUS_TABLES) {
      if (new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]`).test(source)) offenders.push(`${file}: ${table}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('the corpus is service-role only and verified text is guarded', () => {
  const sql = readFileSync(MIGRATION, 'utf8')
  assert.match(sql, /FROM PUBLIC, anon, authenticated;\s*GRANT SELECT, INSERT, UPDATE, DELETE ON public\.standard_documents/)
  assert.doesNotMatch(sql, /GRANT [^;]* TO (anon|authenticated)\b/)
  for (const table of ['standard_documents', 'standard_document_versions', 'standard_clauses', 'definition_statements', 'institution_term_requests', 'standard_dependant_reviews']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), table)
  }
  for (const trigger of ['standard_clauses_guard', 'standard_versions_guard', 'definition_statements_guard']) {
    assert.match(sql, new RegExp(`CREATE TRIGGER ${trigger}`), trigger)
  }
  // Every read filters on verified status and the as-of date.
  for (const fn of ['match_standards_v1', 'get_clause_as_of_v1', 'get_clauses_by_tag_v1']) {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`))
    const end = body.indexOf('$$;', body.indexOf('AS $$'))
    const text = body.slice(0, end)
    assert.match(text, /v\.status = 'verified'/, fn)
    assert.match(text, /COALESCE\(c\.effective_from_override, v\.effective_from\) <= p_on_date/, fn)
    assert.match(text, /v\.effective_to IS NULL OR v\.effective_to > p_on_date/, fn)
  }
})

test('legacy rows come in as drafts, so nothing changes until a version is verified', () => {
  const sql = readFileSync(MIGRATION, 'utf8')
  assert.match(sql, /'legacy_import', 'selected_sections'/)
  assert.match(sql, /AND provenance <> 'legacy_import'/)
})

test('statements are read by the wording they were checked against, and rules count in the verify check', () => {
  const sql = readFileSync(REVIEW_LINKS, 'utf8')
  for (const table of ['standard_institutions', 'definition_statement_clauses', 'standard_rule_citations']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\.${table} ENABLE ROW LEVEL SECURITY`), table)
  }
  assert.match(sql, /FROM PUBLIC, anon, authenticated;\s*GRANT SELECT, INSERT, UPDATE, DELETE ON public\.standard_institutions/)
  assert.doesNotMatch(sql, /GRANT [^;]* TO (anon|authenticated)\b/)
  for (const trigger of ['definition_statement_clauses_guard', 'definition_statements_link', 'standard_dependant_reviews_guard', 'standard_dependant_reviews_link']) {
    assert.match(sql, new RegExp(`CREATE TRIGGER ${trigger}`), trigger)
  }
  // The as-of statement read goes through the verified, dated clause read and matches the recorded wording.
  const body = sql.slice(sql.indexOf('FUNCTION public.get_statement_as_of_v1('))
  const text = body.slice(0, body.indexOf('$$;', body.indexOf('AS $$')))
  assert.match(text, /s\.status = 'approved'/)
  assert.match(text, /get_clause_as_of_v1\(k, p_on_date\)/)
  assert.match(text, /l\.text_sha256 = c\.text_sha256/)
  // Institutions are codes, held by foreign key on both tables that name one.
  assert.match(sql, /standard_documents_institution_fkey FOREIGN KEY \(institution\) REFERENCES public\.standard_institutions\(code\)/)
  assert.match(sql, /institution_term_requests_institution_fkey FOREIGN KEY \(institution\) REFERENCES public\.standard_institutions\(code\)/)
  assert.match(sql, /'rule ' \|\| rc\.rule_id/)
})
