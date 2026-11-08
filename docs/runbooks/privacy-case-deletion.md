# Deleting a case (privacy request or owner instruction)

Deletion is a reviewed operator workflow: `request_privacy_deletion()` only records the request
(`privacy_deletion_requests`); nothing deletes data automatically. Run these steps for each case ID, on the
project the request belongs to. Record IDs and counts only, never case content.

1. **Storage objects.** List the case's objects in the `evidence` bucket (paths start with the case ID, and
   `case_documents.storage_path` names them) and delete them through the Storage API. Deleting table rows does
   not delete files.
2. **The case row.** `delete from public.cases where id = '<case id>'`. This cascades to every case table,
   including all fact tables: `case_story_revisions`, `case_response_revisions`, `case_fact_reconcile_runs`,
   `case_fact_candidates`, `case_fact_findings`, `case_fact_snapshots`, `case_fact_confirmation_events`, and
   `case_narratives`, `case_documents`, `case_responses` and `jobs`. `case_purchases` keeps the payment record
   with its `case_id` set to null (paid stages; retention rules apply).
3. **Rows that are not linked by a foreign key.** They hold IDs only, but name the deleted case:
   - `delete from public.analytics_events where event_data->>'case_id' = '<case id>'` (this includes the
     free-evaluation review rows `free_evaluation_summary` and `free_evaluation_summary_version`);
   - `delete from public.edge_request_nonces where case_id = '<case id>'`.
4. **Check.** Count rows that still mention the case ID in the tables above and in Storage; all counts are 0.
   Mark the `privacy_deletion_requests` row completed.

For a whole account, repeat for every case the user owns, then delete `analytics_events` rows with that
`user_id`, and delete the Clerk user.

The privacy export (`app/api/privacy/export/route.ts`) includes the same fact tables (`FACT_TABLES`).
