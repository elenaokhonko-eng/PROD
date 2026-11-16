-- Cutover checklist, week one (Elena, 12 Nov 2026): index the 11 foreign keys the database advisor lists as
-- unindexed, so deletes on the parent tables and joins on these columns do not scan the child table. Additive only:
-- no data, policy or grant changes. The tables are small, so a plain index build inside the migration is fine.
create index if not exists ix_case_narratives_fact_snapshot_id on public.case_narratives (fact_snapshot_id);
create index if not exists ix_reports_fact_snapshot_id on public.reports (fact_snapshot_id);
create index if not exists ix_case_story_revisions_created_by_profile_id on public.case_story_revisions (created_by_profile_id);
create index if not exists ix_case_response_revisions_created_by_profile_id on public.case_response_revisions (created_by_profile_id);
create index if not exists ix_case_fact_findings_resolved_by_profile_id on public.case_fact_findings (resolved_by_profile_id);
create index if not exists ix_case_fact_findings_run_id on public.case_fact_findings (run_id);
create index if not exists ix_case_fact_snapshots_created_by_profile_id on public.case_fact_snapshots (created_by_profile_id);
create index if not exists ix_case_fact_snapshots_run_id on public.case_fact_snapshots (run_id);
create index if not exists ix_case_fact_confirmation_events_actor_profile_id on public.case_fact_confirmation_events (actor_profile_id);
create index if not exists ix_case_fact_confirmation_events_finding_id on public.case_fact_confirmation_events (finding_id);
create index if not exists ix_case_fact_confirmation_events_snapshot_id on public.case_fact_confirmation_events (snapshot_id);
