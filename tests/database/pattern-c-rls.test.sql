begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.profiles (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'harbor-rls-a@example.invalid'),
  ('20000000-0000-4000-8000-000000000002', 'harbor-rls-b@example.invalid');

insert into public.cases (id, user_id, claim_type, case_summary)
values
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'phishing_scam', 'owner-a-control'),
  ('b0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'phishing_scam', 'owner-b-control');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"user_clerk_a","supabase_uuid":"10000000-0000-4000-8000-000000000001"}',
  true
);

select is(
  public.current_app_user_id(),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'Pattern C resolves Clerk supabase_uuid rather than sub'
);
select is((select count(*)::integer from public.cases), 1, 'user A sees exactly one owned case');
select ok(
  exists(select 1 from public.cases where id = 'a0000000-0000-4000-8000-000000000001'),
  'user A sees its own case'
);
select ok(
  not exists(select 1 from public.cases where id = 'b0000000-0000-4000-8000-000000000002'),
  'user A cannot see user B case'
);
select results_eq(
  $$
    with changed as (
      update public.cases
      set case_summary = 'cross-user-write-must-not-persist'
      where id = 'b0000000-0000-4000-8000-000000000002'
      returning id
    )
    select count(*)::integer from changed
  $$,
  $$values (0)$$,
  'user A cross-user update changes zero rows'
);
select results_eq(
  $$
    with changed as (
      update public.cases
      set case_summary = 'owner-a-updated'
      where id = 'a0000000-0000-4000-8000-000000000001'
      returning id
    )
    select count(*)::integer from changed
  $$,
  $$values (1)$$,
  'user A can update its own case through Pattern C'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"user_clerk_b","supabase_uuid":"20000000-0000-4000-8000-000000000002"}',
  true
);
select results_eq(
  $$select id from public.cases order by id$$,
  $$values ('b0000000-0000-4000-8000-000000000002'::uuid)$$,
  'user B sees only its own case after user A writes'
);

select * from finish();
rollback;
