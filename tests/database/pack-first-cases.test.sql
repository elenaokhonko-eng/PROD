begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

-- CR-2 (26 Nov 2026): the empty case created before payment. Synthetic rows only; rolled back at the end.
insert into public.profiles (id, email)
values
  ('30000000-0000-4000-8000-000000000003', 'harbor-packfirst-a@example.invalid'),
  ('40000000-0000-4000-8000-000000000004', 'harbor-packfirst-b@example.invalid');

insert into public.cases (id, user_id, claim_type)
values ('c0000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'phishing_scam');

select ok(not has_function_privilege('authenticated', 'public.open_pack_case_v1(uuid, boolean)', 'execute'), 'signed-in users cannot open a pack case themselves');
select ok(not has_function_privilege('anon', 'public.open_pack_case_v1(uuid, boolean)', 'execute'), 'visitors cannot open a pack case');
select ok(has_function_privilege('service_role', 'public.open_pack_case_v1(uuid, boolean)', 'execute'), 'the server can');
select ok(not has_column_privilege('authenticated', 'public.cases', 'pack_first_at', 'insert'), 'signed-in users cannot insert the marker');
select ok(not has_column_privilege('authenticated', 'public.cases', 'pack_first_at', 'update'), 'signed-in users cannot update the marker');
select ok(not has_function_privilege('anon', 'public.fill_pack_case_v1(text, text, text, text, text)', 'execute'), 'visitors cannot fill a case');

select is(
  public.get_case_product_readiness_v1('c0000000-0000-4000-8000-000000000003', 'self_serve_report') ->> 'reason',
  'story_missing',
  'an ordinary case without a story cannot buy the bank pack'
);
select is(
  public.get_case_product_readiness_v1('c0000000-0000-4000-8000-000000000003', 'fidrec_tier2_pack') ->> 'reason',
  'story_missing',
  'nor the FIDReC pack'
);

select is(public.open_pack_case_v1('30000000-0000-4000-8000-000000000003', false), null, 'looking does not create');
create temporary table opened as select public.open_pack_case_v1('30000000-0000-4000-8000-000000000003', true) as id;
grant select on opened to authenticated;
select isnt((select id from opened), null, 'a pack case is created');
select is(public.open_pack_case_v1('30000000-0000-4000-8000-000000000003', true), (select id from opened), 'and reused, not duplicated');

select is(
  public.get_case_product_readiness_v1((select id from opened), 'self_serve_report') ->> 'ready',
  'true',
  'the pack case can buy the bank pack before any story'
);
select is(
  public.get_case_product_readiness_v1((select id from opened), 'fidrec_tier2_pack') ->> 'reason',
  'complaint_not_raised',
  'the FIDReC route question still comes before payment'
);
select lives_ok(
  $$select * from public.reserve_checkout_purchase_v1((select id from opened), 'self_serve_report', '30000000-0000-4000-8000-000000000003')$$,
  'the purchase attaches to the pack case'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"user_clerk_packfirst","supabase_uuid":"30000000-0000-4000-8000-000000000003"}',
  true
);
select throws_ok(
  $$update public.cases set pack_first_at = now() where id = 'c0000000-0000-4000-8000-000000000003'$$,
  '42501', null,
  'an ordinary case cannot be marked by its owner'
);
select throws_ok(
  $$insert into public.cases (user_id, claim_type, pack_first_at) values ('30000000-0000-4000-8000-000000000003', 'phishing_scam', now())$$,
  '42501', null,
  'nor can a marked case be inserted'
);

create temporary table filled as
select public.fill_pack_case_v1('Synthetic story.', null, 'phishing_scam', repeat('a', 64), repeat('b', 64)) as id;
select is((select id from filled), (select id from opened), 'the story fills the pack case');
select is(
  public.fill_pack_case_v1('Synthetic story.', null, 'phishing_scam', repeat('a', 64), repeat('b', 64)),
  (select id from opened),
  'a retry of the same submission returns the same case'
);
select throws_ok(
  $$select public.fill_pack_case_v1('Another story.', null, 'phishing_scam', repeat('a', 64), repeat('c', 64))$$,
  'P0001', 'fill_pack_case_v1: idempotency key reused with different request',
  'the same key cannot carry a different story'
);
select is(
  public.fill_pack_case_v1('A second synthetic story.', null, 'phishing_scam', repeat('d', 64), repeat('e', 64)),
  null,
  'with no case waiting, nothing is filled'
);
reset role;

select is((select primary_narrative from public.cases where id = (select id from opened)), 'Synthetic story.', 'the story is on the case');
select results_eq(
  $$select revision, story_text, origin from public.case_story_revisions where case_id = (select id from opened)$$,
  $$values (1, 'Synthetic story.'::text, 'onboarding'::text)$$,
  'one first story revision, as for any new case'
);
select results_eq(
  $$select intake_type::text, narrative_text, source::text from public.case_intake where case_id = (select id from opened)$$,
  $$values ('initial'::text, 'Synthetic story.'::text, 'text'::text)$$,
  'one initial intake row, as for any new case'
);
select isnt(public.open_pack_case_v1('30000000-0000-4000-8000-000000000003', true), (select id from opened), 'the next pack after a story gets its own case');
select is(public.open_pack_case_v1('40000000-0000-4000-8000-000000000004', false), null, 'another account has none of this');

select * from finish();
rollback;
