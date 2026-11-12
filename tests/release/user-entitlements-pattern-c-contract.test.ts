import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = process.cwd()
const migration = readFileSync(
  resolve(root, "supabase", "migrations", "20260914120000_align_user_entitlements_pattern_c.sql"),
  "utf8",
)
const originalSchema = readFileSync(
  resolve(root, "supabase", "migrations", "20260314055326_remote_schema.sql"),
  "utf8",
)
const patternCMigration = readFileSync(
  resolve(root, "supabase", "migrations", "20260828120000_complete_pattern_c_security.sql"),
  "utf8",
)

function indexOfRequired(source: string, marker: string) {
  const index = source.indexOf(marker)
  assert.notEqual(index, -1, `Missing required marker: ${marker}`)
  return index
}

test("entitlement migration fails closed before replacing the ownership foreign key", () => {
  const preflight = indexOfRequired(migration, "DO $preflight$")
  const addProfileForeignKey = indexOfRequired(migration, "REFERENCES public.profiles(id)")

  assert.ok(preflight < addProfileForeignKey)
  assert.match(
    migration,
    /FROM public\.user_entitlements ue\s+LEFT JOIN public\.profiles p ON p\.id = ue\.user_id\s+WHERE p\.id IS NULL/,
  )
  assert.match(migration, /ERRCODE = '23503'/)
  assert.match(migration, /Pattern C entitlement preflight failed/)
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.user_entitlements/i)
})

test("entitlement ownership is profiles-based with preserved cascade semantics", () => {
  assert.match(
    migration,
    /ADD CONSTRAINT user_entitlements_user_id_fkey[\s\S]*FOREIGN KEY \(user_id\)[\s\S]*REFERENCES public\.profiles\(id\)[\s\S]*ON DELETE CASCADE/,
  )
  assert.match(migration, /VALIDATE CONSTRAINT user_entitlements_user_id_fkey/)
  assert.match(
    patternCMigration,
    /router_sessions_converted_to_user_id_fkey[\s\S]*REFERENCES public\.profiles\(id\) ON DELETE SET NULL/,
  )
})

test("one profiles trigger provisions free entitlements idempotently", () => {
  assert.match(migration, /trigger_schema\.nspname = 'auth' AND trigger_table\.relname = 'users'/)
  assert.match(migration, /trigger_function\.proname = 'handle_new_user_entitlement'/)
  assert.match(migration, /AFTER INSERT ON public\.profiles/)
  assert.match(migration, /ON CONFLICT \(user_id\) DO NOTHING/)
  assert.match(
    migration,
    /INSERT INTO public\.user_entitlements \(user_id\)\s+SELECT p\.id\s+FROM public\.profiles p\s+ON CONFLICT \(user_id\) DO NOTHING/,
  )
  assert.doesNotMatch(migration, /DROP (?:TRIGGER|FUNCTION)[\s\S]*handle_new_user\(\)/)
})

test("entitlement reads use the signed Pattern C application UUID and least privilege", () => {
  const policy = migration.match(
    /CREATE POLICY entitlements_select_own[\s\S]*?USING \(([^;]+)\);/,
  )?.[0]
  assert.ok(policy)
  assert.match(policy, /user_id = public\.current_app_user_id\(\)/)
  assert.doesNotMatch(policy, /auth\.uid\(\)/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.user_entitlements FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT SELECT ON TABLE public\.user_entitlements TO authenticated/)
  assert.match(migration, /GRANT ALL ON TABLE public\.user_entitlements TO service_role/)
})

test("effective entitlements retain the case to profile to entitlement path", () => {
  assert.match(
    originalSchema,
    /select c\.user_id[\s\S]*from public\.cases c[\s\S]*where c\.id = p_case_id/,
  )
  assert.match(
    originalSchema,
    /from public\.user_entitlements ue[\s\S]*where ue\.user_id = v_case_user_id/,
  )
  assert.match(migration, /ALTER FUNCTION public\.get_effective_entitlement\(uuid\) SET search_path = ''/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_effective_entitlement\(uuid\) TO service_role/)
})
