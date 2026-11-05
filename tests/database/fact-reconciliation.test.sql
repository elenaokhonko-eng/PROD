begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

insert into public.profiles (id, email)
values
  ('10000000-0000-4000-8000-0000000000f1', 'harbor-facts-a@example.invalid'),
  ('20000000-0000-4000-8000-0000000000f2', 'harbor-facts-b@example.invalid');

insert into public.cases (id, user_id, claim_type, primary_narrative)
values
  ('a0000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'phishing_scam', 'Synthetic story A.'),
  ('b0000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000000f2', 'phishing_scam', 'Synthetic story B.');

-- Story history
select is(
  (select count(*)::integer from public.case_story_revisions where case_id = 'a0000000-0000-4000-8000-0000000000f1'),
  1,
  'a new case records story revision 1'
);
select is(
  (select origin from public.case_story_revisions where case_id = 'a0000000-0000-4000-8000-0000000000f1'),
  'onboarding',
  'the first story revision comes from onboarding'
);
update public.cases set primary_narrative = 'Synthetic story A, corrected.' where id = 'a0000000-0000-4000-8000-0000000000f1';
update public.cases set case_summary = 'unrelated change' where id = 'a0000000-0000-4000-8000-0000000000f1';
select is(
  (select array_agg(revision || ':' || origin order by revision) from public.case_story_revisions
   where case_id = 'a0000000-0000-4000-8000-0000000000f1'),
  array['1:onboarding', '2:user_edit'],
  'a story edit adds revision 2; other case updates add nothing'
);

-- Answer history
insert into public.case_responses (case_id, question_key, response_value, response_type)
values
  ('a0000000-0000-4000-8000-0000000000f1', 'previous_contact', 'No', 'text'),
  ('a0000000-0000-4000-8000-0000000000f1', 'journey_reported_to_bank', 'yes', 'text'),
  ('a0000000-0000-4000-8000-0000000000f1', 'gap_police_report', 'yes', 'text');
update public.case_responses set response_value = 'Yes'
  where case_id = 'a0000000-0000-4000-8000-0000000000f1' and question_key = 'previous_contact';
update public.case_responses set response_value = 'Yes'
  where case_id = 'a0000000-0000-4000-8000-0000000000f1' and question_key = 'previous_contact';
select is(
  (select array_agg(response_value order by created_at, id) from public.case_response_revisions
   where case_id = 'a0000000-0000-4000-8000-0000000000f1' and question_key = 'previous_contact'),
  array['No', 'Yes'],
  'a changed answer adds a revision; saving the same value does not'
);
select is(
  (select array_agg(question_key || ':' || origin order by question_key) from (
     select distinct question_key, origin from public.case_response_revisions
     where case_id = 'a0000000-0000-4000-8000-0000000000f1') o),
  array['gap_police_report:follow_up', 'journey_reported_to_bank:journey', 'previous_contact:intake'],
  'answer revisions are classified as intake, follow-up or journey'
);

-- Fact records written by the service role
insert into public.case_fact_reconcile_runs (id, case_id, input_hash, status)
values
  ('c0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1', 'hash-a', 'completed'),
  ('c0000000-0000-4000-8000-0000000000f2', 'b0000000-0000-4000-8000-0000000000f2', 'hash-b', 'completed');
insert into public.case_fact_findings (id, case_id, run_id, fact_key, finding_type, "values", values_hash)
values
  ('d0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-0000000000f1',
   'reported_to_police', 'conflict', '[{"value":"yes"},{"value":"no"}]', 'vh-a'),
  ('d0000000-0000-4000-8000-0000000000f2', 'b0000000-0000-4000-8000-0000000000f2', 'c0000000-0000-4000-8000-0000000000f2',
   'total_loss', 'conflict', '[]', 'vh-b');
insert into public.case_fact_snapshots (id, case_id, stage, facts, hash, run_id)
values
  ('e0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1', 'free', '{}', 'snap-a',
   'c0000000-0000-4000-8000-0000000000f1');
insert into public.case_fact_confirmation_events (case_id, snapshot_id, event)
values ('a0000000-0000-4000-8000-0000000000f1', 'e0000000-0000-4000-8000-0000000000f1', 'snapshot_created');

select throws_ok(
  $$ update public.case_fact_snapshots set hash = 'changed' where id = 'e0000000-0000-4000-8000-0000000000f1' $$,
  'P0001',
  'case_fact_snapshots rows are immutable',
  'a snapshot cannot be updated'
);
select throws_ok(
  $$ update public.case_fact_confirmation_events set event = 'reopened' $$,
  'P0001',
  'case_fact_confirmation_events rows are immutable',
  'an audit event cannot be updated'
);
select throws_ok(
  $$ update public.case_fact_findings set status = 'resolved' where id = 'd0000000-0000-4000-8000-0000000000f1' $$,
  '23514',
  null,
  'a resolved finding must record when it was resolved'
);

-- User A, signed in through Clerk
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"user_clerk_facts_a","supabase_uuid":"10000000-0000-4000-8000-0000000000f1"}',
  true
);

select is((select count(*)::integer from public.case_story_revisions), 2, 'user A sees only its own story revisions');
select is((select count(*)::integer from public.case_fact_findings), 1, 'user A sees only its own findings');
select is((select count(*)::integer from public.case_fact_snapshots), 1, 'user A sees its own snapshot');
select is((select count(*)::integer from public.case_response_revisions
           where case_id = 'b0000000-0000-4000-8000-0000000000f2'), 0, 'user A sees no answer history of user B');
select throws_ok(
  $$ insert into public.case_fact_findings (case_id, run_id, fact_key, finding_type, values_hash)
     values ('a0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-0000000000f1', 'x', 'agreed', 'h') $$,
  '42501',
  null,
  'user A cannot write findings directly'
);
select throws_ok(
  $$ update public.case_fact_findings set status = 'not_sure', resolved_at = now()
     where id = 'd0000000-0000-4000-8000-0000000000f1' $$,
  '42501',
  null,
  'user A cannot resolve a finding without the server route'
);
select throws_ok(
  $$ insert into public.case_story_revisions (case_id, revision, story_text, origin)
     values ('a0000000-0000-4000-8000-0000000000f1', 9, 'injected', 'user_edit') $$,
  '42501',
  null,
  'user A cannot write story history directly'
);

-- Anonymous visitors see nothing
reset role;
set local role anon;
select throws_ok(
  $$ select count(*) from public.case_fact_snapshots $$,
  '42501',
  null,
  'anon cannot read snapshots'
);

-- Deleting a case removes its fact records, immutable rows included
reset role;
delete from public.cases where id = 'a0000000-0000-4000-8000-0000000000f1';
select is(
  (select count(*)::integer from public.case_fact_snapshots where case_id = 'a0000000-0000-4000-8000-0000000000f1'),
  0,
  'snapshots are deleted with their case'
);
select is(
  (select count(*)::integer from public.case_story_revisions where case_id = 'a0000000-0000-4000-8000-0000000000f1'),
  0,
  'story history is deleted with its case'
);

select * from finish();
rollback;
