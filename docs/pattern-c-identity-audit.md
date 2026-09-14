# Pattern C identity dependency audit

Baseline: `98daa6f227bd7a9bb1e1e7201550747a771e7cfe`

## Canonical invariant

`Clerk JWT supabase_uuid = public.profiles.id = public.cases.user_id = public.user_entitlements.user_id`

`public.current_app_user_id()` is the only application-ownership resolver. A Clerk identity is external; it does not require, and must not be represented by, a fabricated `auth.users` row.

## Active production paths

| Dependency | Occurrence | Classification and result |
| --- | --- | --- |
| Clerk JWT mapping | `lib/auth.ts` | Reads the signed `supabase_uuid` claim and returns it separately from the external Clerk user ID. Active and canonical. |
| Clerk provisioning | `app/api/webhooks/clerk/route.ts`, `lib/server/clerk-webhook.ts`, `lib/server/clerk-profile-provisioner.ts` | Verified `user.created` webhook calls the service-role-only provisioning RPC, then patches only Clerk `public_metadata.supabase_uuid`. Active and canonical. |
| Profile provisioning RPC | `supabase/migrations/20260909120000_harden_clerk_profile_provisioning.sql` | Atomically creates or reuses `public.profiles.id` by unique `clerk_id`. Active migration-defined path. |
| Application UUID resolver | `supabase/migrations/20260828120000_complete_pattern_c_security.sql` | `public.current_app_user_id()` validates and returns `auth.jwt()->>'supabase_uuid'`. Active and canonical. |
| Pattern C report ownership | `supabase/migrations/20260712120000_reports_pattern_c_case_scoped_ownership.sql` | Uses `current_app_user_id()` for application ownership. Active and canonical. |
| Effective entitlement | `supabase/migrations/20260314055326_remote_schema.sql` | `get_effective_entitlement(p_case_id)` resolves `cases.user_id` and queries `user_entitlements.user_id`. Active; this proves the entitlement key must be `profiles.id`. |
| Eligibility consumer | `supabase/migrations/20260419140000_get_case_eligibility_self_serve.sql` | Calls `get_effective_entitlement`. Active indirect RPC consumer. |
| Tier 2 gate | `lib/server/fidrec/assert-tier2-eligible.ts` | Calls `get_effective_entitlement` through trusted server code. Active direct consumer. |
| Router conversion | `app/api/router/session/route.ts`, `app/api/cases/create-from-session/route.ts` | Writes the authenticated application's `supabaseUuid` to `router_sessions.converted_to_user_id`. Active. |
| Router conversion FK | `supabase/migrations/20260828120000_complete_pattern_c_security.sql` | Retargets `router_sessions.converted_to_user_id` to `public.profiles(id) ON DELETE SET NULL`. Active and already corrected. |

## Legacy but still installed at the baseline

| Dependency | Occurrence | Finding |
| --- | --- | --- |
| Entitlement FK | `supabase/migrations/20260314055326_remote_schema.sql` | `user_entitlements_user_id_fkey` references `auth.users(id) ON DELETE CASCADE`. Proven defect; superseded by the additive `20260914120000` migration. |
| Entitlement RLS | `supabase/migrations/20260314055326_remote_schema.sql` | `entitlements_select_own` compares `user_id = auth.uid()`. Proven defect; replaced with `current_app_user_id()`. |
| Entitlement function | `supabase/migrations/20260314055326_remote_schema.sql` | `handle_new_user_entitlement()` is installed but no repository migration attaches it to a trigger. A copied database may retain such a trigger; the additive migration removes only obsolete entitlement triggers and repurposes the function for `profiles`. |
| Legacy Supabase Auth profile function | `supabase/migrations/20260314055326_remote_schema.sql` | `handle_new_user()` creates a profile from an `auth.users` insert. Any installed trigger using this distinct function is preserved so the supported legacy signup path converges through the new profile entitlement trigger. |
| Historical `auth.users` ownership FKs | `supabase/migrations/20260314055326_remote_schema.sql` | The dump defines application-owned foreign keys to `auth.users`; `20260828120000_complete_pattern_c_security.sql` removes/retargets the active set to `profiles`. The corrected migration suite must leave no public application FK to `auth.users`. |
| Router conversion FK | `supabase/migrations/20260314055326_remote_schema.sql` | Historical definition references `auth.users(id)`; already superseded by `20260828120000`. No new router migration is required. |

## Historical, dead, and test-only occurrences

| Dependency | Occurrence | Classification |
| --- | --- | --- |
| Entitlement identity warning | `supabase/migrations/20260711133000_clerk_supabase_uuid_rls_alignment.sql` | Migration-only historical note describing the old `auth.uid()`/`auth.users` assumption. |
| Legacy profile trigger scripts | `scripts/002_create_profile_trigger.sql`, `scripts/023_clerk_migration.sql` | Historical operational scripts; the latter removes the former trigger path. They are not the current Clerk webhook/RPC path. |
| `has_feature` | `supabase/migrations/20260314055326_remote_schema.sql` | Malformed dump artifact named `has_feature (feature_key text)` and returning `void`. No active TypeScript or RPC caller was found. It is not changed by this remediation. |
| Pattern C SQL fixtures | `scripts/sql/tests/pattern-c-legacy-fixtures.sql`, `scripts/sql/tests/test-pattern-c-security.sql`, `tests/database/pattern-c-rls.test.sql` | Test-only identities, legacy triggers, `auth.users` rows, JWT claims, FK checks, RLS isolation, provisioning, and migration preservation assertions. |
| Migration conflict fixture | `scripts/sql/tests/migration-conflicts/32-orphan-user-entitlement.sql` | Test-only orphan inserted inside a rolled-back transaction to prove fail-closed migration behavior. |

## Trigger and provisioning decision

The single authoritative default-entitlement mechanism is an `AFTER INSERT` trigger on `public.profiles`. It inserts one free entitlement with `ON CONFLICT (user_id) DO NOTHING`.

This choice makes the Clerk RPC atomic: a failed entitlement insert rolls back the profile insert, while retries converge on the same profile and primary-keyed entitlement. It also preserves the legacy Supabase Auth path because `auth.users -> handle_new_user() -> profiles` reaches the same trigger. Any `auth.users` trigger invoking `handle_new_user_entitlement()` is obsolete after the FK changes and is removed dynamically to prevent trigger-order failures.

## Remaining occurrences and non-changes

- `auth.uid()` and `auth.users` remain in immutable historical migrations, legacy scripts, and deliberate test fixtures. They are not active application ownership dependencies after the ordered migration suite.
- `has_feature` remains untouched because it is malformed and has no proven active caller.
- `router_sessions.converted_to_user_id` needs no additional change because its active writer and corrected FK already use `profiles.id`.
- No anonymous or authenticated write grant is added. Authenticated users receive only RLS-filtered entitlement `SELECT`; service-role backend operations retain explicit access.
