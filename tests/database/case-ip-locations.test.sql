-- Tests for 20261204120200_case_ip_locations.sql. Synthetic data only (documentation IP ranges, RFC 5737 / 3849).
begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into public.profiles (id, email)
values
  ('10000000-0000-4000-8000-0000000000e1', 'harbor-ip-a@example.invalid'),
  ('20000000-0000-4000-8000-0000000000e2', 'harbor-ip-b@example.invalid');

insert into public.cases (id, user_id, claim_type, primary_narrative)
values
  ('a0000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'phishing_scam', 'Synthetic story A.'),
  ('b0000000-0000-4000-8000-0000000000e2', '20000000-0000-4000-8000-0000000000e2', 'phishing_scam', 'Synthetic story B.');

-- The IP database: two editions of a synthetic database, IPv4 and IPv6.
insert into public.ip_location_ranges (database, database_edition, range_start, range_end, country, city, asn, organisation)
values
  ('synthetic-lite', '2026-10-01', '192.0.2.0', '192.0.2.127', 'SG', 'Synthetic City', 64500, 'Synthetic Net A'),
  ('synthetic-lite', '2026-10-01', '192.0.2.128', '192.0.2.255', 'XA', 'Other City', 64501, 'Synthetic Net B'),
  ('synthetic-lite', '2026-11-01', '192.0.2.0', '192.0.2.255', 'XB', 'Moved City', 64502, 'Synthetic Net C'),
  ('synthetic-lite', '2026-10-01', '2001:db8::', '2001:db8::ffff', 'SG', 'Synthetic City', 64500, 'Synthetic Net A');

select is(
  (select city from public.lookup_ip_location_v1('192.0.2.10', 'synthetic-lite', '2026-10-01')),
  'Synthetic City',
  'an address is found in the range that holds it'
);
select is(
  (select city from public.lookup_ip_location_v1('192.0.2.200', 'synthetic-lite', '2026-10-01')),
  'Other City',
  'the neighbouring range is not mistaken for it'
);
select is(
  (select city from public.lookup_ip_location_v1('192.0.2.10', 'synthetic-lite', '2026-11-01')),
  'Moved City',
  'a lookup reads only the edition it names'
);
select is(
  (select count(*)::integer from public.lookup_ip_location_v1('198.51.100.7', 'synthetic-lite', '2026-10-01')),
  0,
  'an address in no range returns no row'
);
select is(
  (select city from public.lookup_ip_location_v1('2001:db8::1', 'synthetic-lite', '2026-10-01')),
  'Synthetic City',
  'IPv6 addresses are looked up in IPv6 ranges'
);
select throws_ok(
  $$ insert into public.ip_location_ranges (database, database_edition, range_start, range_end)
     values ('synthetic-lite', '2026-10-01', '203.0.113.9', '203.0.113.1') $$,
  '23514',
  null,
  'a range must not end before it starts'
);
select throws_ok(
  $$ insert into public.ip_location_ranges (database, database_edition, range_start, range_end)
     values ('synthetic-lite', '2026-10-01', '203.0.113.0/24', '203.0.113.255') $$,
  '23514',
  null,
  'range bounds are single addresses'
);

-- Lookups kept with the case, with the database and edition they were made with.
insert into public.case_ip_locations (case_id, ip, country, city, asn, organisation, database, database_edition)
values
  ('a0000000-0000-4000-8000-0000000000e1', '192.0.2.10', 'SG', 'Synthetic City', 64500, 'Synthetic Net A', 'synthetic-lite', '2026-10-01'),
  ('b0000000-0000-4000-8000-0000000000e2', '192.0.2.200', 'XA', 'Other City', 64501, 'Synthetic Net B', 'synthetic-lite', '2026-10-01');
select throws_ok(
  $$ insert into public.case_ip_locations (case_id, ip, database) values ('a0000000-0000-4000-8000-0000000000e1', '192.0.2.11', 'synthetic-lite') $$,
  '23502',
  null,
  'a lookup records the database edition'
);
select throws_ok(
  $$ insert into public.case_ip_locations (case_id, ip, flags, database, database_edition)
     values ('a0000000-0000-4000-8000-0000000000e1', '192.0.2.12', '{residential}', 'synthetic-lite', '2026-10-01') $$,
  '23514',
  null,
  'only the contract''s network flags are accepted'
);

-- User A, signed in through Clerk
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"user_clerk_ip_a","supabase_uuid":"10000000-0000-4000-8000-0000000000e1"}',
  true
);
select is((select count(*)::integer from public.case_ip_locations), 1, 'user A sees only the lookups of its own case');
select throws_ok(
  $$ insert into public.case_ip_locations (case_id, ip, database, database_edition)
     values ('a0000000-0000-4000-8000-0000000000e1', '192.0.2.13', 'synthetic-lite', '2026-10-01') $$,
  '42501',
  null,
  'user A cannot write lookups directly'
);
select throws_ok(
  $$ select count(*) from public.ip_location_ranges $$,
  '42501',
  null,
  'a signed-in user cannot read the IP database'
);
select throws_ok(
  $$ select * from public.lookup_ip_location_v1('192.0.2.10', 'synthetic-lite', '2026-10-01') $$,
  '42501',
  null,
  'a signed-in user cannot run lookups'
);

-- Anonymous visitors see nothing
reset role;
set local role anon;
select throws_ok(
  $$ select count(*) from public.case_ip_locations $$,
  '42501',
  null,
  'anon cannot read lookups'
);

-- Deleting a case removes its lookups
reset role;
delete from public.cases where id = 'a0000000-0000-4000-8000-0000000000e1';
select is(
  (select count(*)::integer from public.case_ip_locations where case_id = 'a0000000-0000-4000-8000-0000000000e1'),
  0,
  'deleting a case deletes its IP lookups'
);
select is((select count(*)::integer from public.case_ip_locations), 1, 'other cases keep theirs');

select * from finish();
rollback;
