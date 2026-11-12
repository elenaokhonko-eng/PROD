begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.profiles (id, email) values ('10000000-0000-4000-8000-0000000000a9', 'harbor-usage@example.invalid');
insert into public.cases (id, user_id, claim_type, primary_narrative)
values ('a0000000-0000-4000-8000-0000000000a9', '10000000-0000-4000-8000-0000000000a9', 'phishing_scam', 'Synthetic story.');

insert into public.model_usage (environment, caller, purpose, provider, model, input_tokens, output_tokens, outcome, estimated_cost_usd, case_id, user_id)
values
  ('test', 'web', 'fact_extraction', 'openai', 'gpt-4.1-mini', 1000, 500, 'ok', 0.0012, 'a0000000-0000-4000-8000-0000000000a9', '10000000-0000-4000-8000-0000000000a9'),
  ('test', 'edge', 'summary', 'openai', 'gpt-4o-mini-2024-07-18', 2000, 300, 'ok', 0.0005, 'a0000000-0000-4000-8000-0000000000a9', null),
  ('production', 'edge', 'summary', 'openai', 'gpt-4o-mini-2024-07-18', 2000, 300, 'ok', 9, null, null);

select is(public.model_usage_spend_today('test'), 0.0017::numeric, 'today''s spend is summed per environment');

select throws_ok(
  $$insert into public.model_usage (environment, caller, purpose, provider, model, outcome) values ('test', 'web', 'x', 'anthropic', 'm', 'ok')$$,
  '23514', null, 'only known providers'
);
select throws_ok(
  $$insert into public.model_usage (environment, caller, purpose, provider, model, outcome, input_tokens) values ('test', 'web', 'x', 'openai', 'm', 'ok', -1)$$,
  '23514', null, 'token counts are not negative'
);
select hasnt_column('public', 'model_usage', 'prompt', 'no prompt text is stored');
select hasnt_column('public', 'model_usage', 'response', 'no response text is stored');

-- Deleting the case keeps the spend but drops the link.
delete from public.cases where id = 'a0000000-0000-4000-8000-0000000000a9';
select is((select count(*)::integer from public.model_usage where environment = 'test' and case_id is null), 2, 'case deletion clears the case link and keeps the rows');

-- Signed-in and anonymous callers can neither read nor write.
set local role authenticated;
select throws_ok($$select count(*) from public.model_usage$$, '42501', null, 'authenticated cannot read');
reset role;
set local role anon;
select throws_ok($$insert into public.model_usage (environment, caller, purpose, provider, model, outcome) values ('test', 'web', 'x', 'openai', 'm', 'ok')$$, '42501', null, 'anon cannot write');
select throws_ok($$select public.model_usage_spend_today('production')$$, '42501', null, 'anon cannot read spend');
reset role;

select * from finish();
rollback;
