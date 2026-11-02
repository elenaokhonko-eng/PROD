begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- Catalog rules: each query lists the offenders, so a failure names them.
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

select ok(
  not has_column_privilege('authenticated', 'public.consultation_reviews', 'reviewer_notes', 'select'),
  'authenticated cannot read consultation_reviews.reviewer_notes'
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
