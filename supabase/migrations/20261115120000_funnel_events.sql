-- Analytics 2 (brief W1 §N; Elena, 14 Nov 2026): the journey steps before and around sign-up, recorded from the browser
-- and keyed by a random number held for one browser tab. Later steps (account, evaluation, purchase) are read from the
-- timestamps already in their own tables, so nothing here identifies a person: no IP address, no user agent, no user
-- or case id, no story text. Written only by the service role through POST /api/funnel; no Data API access.
-- Kept 12 months, the same as technical logs.
create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null
    check (event in ('home_viewed', 'story_started', 'story_submitted', 'signup_reached', 'case_created')),
  anon_session_id uuid not null,
  path text check (char_length(path) <= 200),
  referrer_host text check (char_length(referrer_host) <= 200),
  utm_source text check (char_length(utm_source) <= 100),
  utm_medium text check (char_length(utm_medium) <= 100),
  utm_campaign text check (char_length(utm_campaign) <= 100),
  device_class text check (device_class in ('phone', 'tablet', 'desktop')),
  environment text not null check (environment in ('production', 'staging', 'development', 'test'))
);

alter table public.funnel_events enable row level security;
revoke all on public.funnel_events from anon, authenticated;

create index if not exists ix_funnel_events_created_at on public.funnel_events (created_at);
create index if not exists ix_funnel_events_event_created_at on public.funnel_events (event, created_at);

-- Where a case's visitor first came from, set once when the case is created, so evaluations can be counted by channel
-- (adviser's addition, approved by Elena 14 Nov). Channel fields only and no tab number, so funnel rows can never be
-- joined to a case.
alter table public.cases add column if not exists first_touch jsonb;
alter table public.cases add constraint cases_first_touch_channel_only check (
  first_touch is null
  or (
    jsonb_typeof(first_touch) = 'object'
    and first_touch - array['referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'device_class'] = '{}'::jsonb
  )
);
