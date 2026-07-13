# Held-aside migrations

## `20260711133000_state_machine_read_policies.sql`

**Do not move this file back into `supabase/migrations/`.**

### Why it is held aside

1. **Duplicate timestamp.** It shares version stamp `20260711133000` with
   `supabase/migrations/20260711133000_clerk_supabase_uuid_rls_alignment.sql`.
   Hosted `supabase db push` refuses to apply when two local files collide on
   the same version.

2. **Obsolete ownership model.** The file uses `auth.uid()` for case-owner
   SELECT policies. That model is incompatible with Clerk Pattern C
   (`JWT supabase_uuid` → `public.current_app_user_id()`).

3. **Never intended for apply after Pattern C.** It must not be applied on any
   environment that already has the Clerk Pattern C RLS alignment migration.

### Authoritative replacement

| Held aside | Authoritative replacement |
|---|---|
| `migrations_held_aside/20260711133000_state_machine_read_policies.sql` | `supabase/migrations/20260711133000_clerk_supabase_uuid_rls_alignment.sql` |

The replacement defines `public.current_app_user_id()` and case-scoped owner
SELECT policies for Layer 1 tables. Prefer that migration (already applied on
hosted project `ujilatkjweudsptpoqyr`) for all ownership reads.
