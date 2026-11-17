begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

-- Catalog rules: each query lists the offenders, so a failure names them.
-- Week one (12 Nov): every public foreign key has an index that starts with its columns.
select is_empty(
  $$
    select c.conrelid::regclass::text || ':' || c.conname
    from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey
      )
  $$,
  'every public foreign key has an index'
);

select is_empty(
  $$
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  $$,
  'every public table has row level security enabled'
);

select is_empty(
  $$
    select c.relname::text || ':' || p.privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(privilege)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('anon', c.oid, p.privilege)
  $$,
  'anon holds no write privilege on any public table or view'
);

select is_empty(
  $$
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any (c.reloptions), false)
  $$,
  'every public view runs with security_invoker'
);

select is_empty(
  $$select id from storage.buckets where public$$,
  'no Storage bucket is public'
);

select is_empty(
  $$
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not coalesce(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'), false)
  $$,
  'every public function pins search_path'
);

select is_empty(
  $$
    select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'public'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (qual = 'true' or with_check = 'true')
  $$,
  'no public write policy is always true'
);

select is_empty(
  $$
    select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'public' and (qual ~ 'auth\.uid\(' or with_check ~ 'auth\.uid\(')
  $$,
  'no public policy compares auth.uid() (Pattern C uses current_app_user_id())'
);

select is_empty(
  $$
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'm'
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))
  $$,
  'no materialized view is readable through the Data API'
);

select ok(
  not has_column_privilege('authenticated', 'public.consultation_reviews', 'reviewer_notes', 'select'),
  'authenticated cannot read consultation_reviews.reviewer_notes'
);

-- Analytics 2 (brief W1 §N): the funnel table holds no personal fields and is closed to the Data API.
select is_empty(
  $$
    select column_name::text
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'funnel_events'
      and column_name not in (
        'id', 'created_at', 'event', 'anon_session_id', 'path', 'referrer_host',
        'utm_source', 'utm_medium', 'utm_campaign', 'device_class', 'environment'
      )
  $$,
  'funnel_events has no column beyond the approved anonymous fields'
);

select ok(
  not has_table_privilege('anon', 'public.funnel_events', 'select')
    and not has_table_privilege('authenticated', 'public.funnel_events', 'select')
    and not has_table_privilege('authenticated', 'public.funnel_events', 'insert'),
  'funnel_events is closed to anon and authenticated'
);

-- Case-scoped read on the tier-2 analysis tables.
insert into public.profiles (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'harbor-sec-a@example.invalid'),
  ('20000000-0000-4000-8000-000000000002', 'harbor-sec-b@example.invalid');

insert into public.cases (id, user_id, claim_type, case_summary)
values
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'phishing_scam', 'owner-a-control'),
  ('b0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'phishing_scam', 'owner-b-control');

insert into public.case_themes (case_id, theme_type, theme_title)
values
  ('a0000000-0000-4000-8000-000000000001', 'other', 'Owner A theme'),
  ('b0000000-0000-4000-8000-000000000002', 'other', 'Owner B theme');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"user_clerk_a","supabase_uuid":"10000000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select case_id from public.case_themes$$,
  $$values ('a0000000-0000-4000-8000-000000000001'::uuid)$$,
  'user A reads only case themes on its own case'
);

select throws_ok(
  $$delete from public.case_themes$$,
  '42501',
  null,
  'authenticated cannot delete case themes'
);

select * from finish();
rollback;
