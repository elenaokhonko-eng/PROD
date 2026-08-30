# Release environment and recovery

This contract applies to the Next.js app, Render worker, Supabase project, Clerk instance, Stripe account, and SMTP provider used by one environment. Preview and production must use separate credentials and data.

## Environment contract

### Next.js app

| Variable | Requirement |
| --- | --- |
| `HARBOR_DEPLOYMENT_ENVIRONMENT` | Explicit deployment class: `preview` or `production`. Checkout creation fails closed when absent or invalid. |
| `CHECKOUT_REDIRECT_ORIGIN` | Server-only HTTPS origin for Stripe success/cancel redirects, with no path, query, credentials, or fragment. It must exactly match `NEXT_PUBLIC_APP_URL`. Preview must not equal the production origin. |
| `HARBOR_PRODUCTION_APP_ORIGIN` | Server-only canonical production HTTPS origin. Preview checkout is rejected if it targets this origin; production checkout must match it exactly. |
| `NEXT_PUBLIC_APP_URL` | Canonical app origin for public links, app/worker communication, and comparison with the server-controlled checkout redirect origin. |
| `NEXT_PUBLIC_SITE_URL` | Public site origin and allowed redirect origin. |
| `RELEASE_COMMIT_SHA` | Full deployed Git SHA. Optional when Render supplies `RENDER_GIT_COMMIT`; one of them is required for release evidence. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same environment's Supabase project and public key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Never expose through a `NEXT_PUBLIC_` variable or browser bundle. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Same environment's Clerk instance. The Clerk `supabase` JWT template must sign a stable UUID as `supabase_uuid`. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Same Stripe mode and endpoint. Preview uses test-mode keys only. |
| `STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD` | One-time S$18 price. Currency and unit amount must match the catalogue. |
| `STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD` | One-time S$188 price. Currency and unit amount must match the catalogue. |
| `STRIPE_PRICE_ID_HUMAN_CONSULT_30M_SGD` | Optional legacy reference only. Consultation checkout and fulfilment are disabled; historic verified events are recorded without allocating a consultation. |
| `WORKER_SECRET` | High-entropy shared secret present only in the app and worker. Rotate both deployments together. |
| `EDGE_PROXY_HMAC_SECRET` | Server-only secret containing at least 32 random bytes. Supply the identical value to the app, worker, and Supabase Edge Functions. Never name it `NEXT_PUBLIC_*`, log it, place it in a request body, expose it to a browser, or substitute/forward a service-role key. |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_GENERATIVE_AI_MODEL` | Router, transcription, and legacy pack generation. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Server-side Tier 2 helpers. |
| `SIMULATION_KEY` | App-to-report-function secret; must match the Supabase function secret. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP transport. Use TLS and environment-specific credentials. |
| `SMTP_SECURE`, `SMTP_REQUIRE_TLS` | Use implicit TLS only when required by the provider; otherwise require STARTTLS. |
| `EMAIL_FROM`, `EMAIL_FROM_NAME`, `ADMIN_EMAIL` | `EMAIL_FROM` must belong to a provider-verified sender domain. |

Optional SMTP pool, timeout, and retry variables are documented in `.env.example`.

### Render worker

The worker requires `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `WORKER_SECRET`, and `EDGE_PROXY_HMAC_SECRET` with values matching the app environment. The HMAC secret must also exactly match the Supabase Edge secret; worker startup rejects values shorter than 32 bytes. It also requires `RELEASE_COMMIT_SHA` or Render's `RENDER_GIT_COMMIT` for SHA-bound evidence. `WORKER_RUN_ONCE=1` is for controlled diagnostics only.

`WORKER_SECRET` authenticates worker-to-app requests but does not authorize arbitrary work. Every worker request must also identify a running durable job, its case, its optional document binding, type, and exact immutable `locked_at` claim token. The app and database re-check the DB-time lease before signing or accepting any mutation. The worker never forwards `EDGE_PROXY_HMAC_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`; the app uses the former only to sign the canonical request envelope.

### Supabase

Apply migrations in filename order. Deploy Edge Functions from the same Git SHA. Required function secrets are:

- Platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- `GuideBuoy_EdgeFunction` and optional model selectors for OpenAI-backed functions.
- `GEMINI_API_KEY` and optional `EVIDENCE_GEMINI_MODEL` for evidence processing.
- `SIMULATION_KEY` matching the app for report generation.
- `EDGE_PROXY_HMAC_SECRET` matching the app and worker exactly, with at least 32 random bytes. Rotate all three environments together; in-flight signatures stop validating and consumed-request replay records remain harmless.

Clerk is the identity provider. Application ownership is `public.profiles.id`, carried only in the signed `supabase_uuid` claim and resolved by `public.current_app_user_id()`. Do not introduce `auth.uid()` or `auth.users` ownership dependencies.

Operational admin calls must use the server-only `signAdminEdgeRequest` helper with a non-empty audited actor ID. Both the signer and database accept admin envelopes only for `backfill_embeddings_v1` and `url_catalogue`; do not generalize this allowlist or use admin signing for case-scoped user/worker work.

Consumed Edge request IDs remain replay-protected for 24 hours. Schedule a daily service-role call to `select public.purge_edge_request_nonces_v1(10000);`, repeat in bounded batches only while the result equals 10,000, and record deleted counts. Alert if expired rows grow across two runs. Never truncate the table or delete rows before `retain_until`.

### Unapplied release-candidate migrations

These two files are unapplied, preview-only release-candidate material. Apply them in this exact order and never apply either file to production during this pass.

| Order | Migration | Final SHA-256 |
| --- | --- | --- |
| 1 | `20260829000000_release_security_and_fulfilment_hardening.sql` | `855a64117d8189415fcbb816e69834fe066bf9d861a849cec7c10b2fa3d55576` |
| 2 | `20260830000000_privileged_edge_and_evidence_jobs.sql` | `3eca73d64e98834cef92080654f8f832b80997b3411804cd7a183a20a00e47f7` |

Verify both hashes from the clean review SHA immediately before applying. `20260829` must finish before `20260830`; the latter supplies the nonce, durable evidence dispatch, lease-fencing, and settlement protocol required by the worker and privileged Edge Functions. Do not mark either migration applied manually or deploy code against only one of them.

Both migrations stop with actionable counts and sampled non-sensitive keys before their new historical-data constraints are created. A preflight failure is a release stop: compare the identified rows to Stripe/provider records or existing job outputs, record the decision, and rerun the unchanged migration. Do not auto-delete, auto-cancel, or guess which Stripe-backed purchase or job is canonical. Record the preview project ref, database output, migration hashes, and deployed commit SHA. Local fixtures and migration parsing are not live Supabase SQL evidence.

### Type-safety gate

`next.config.mjs` currently sets `typescript.ignoreBuildErrors: true`, so a passing `npm run build` is not a type-safety gate. Record a separate passing `npm run typecheck`. Removing that bypass or enforcing type errors in the Next build is a Frontend/Test-owned release gate and is not concealed by this backend release candidate.

### Preview evidence runner

Run `pnpm test:e2e:preview-handshakes` only against disposable preview infrastructure. It requires the `HARBOR_PREVIEW_*` variables declared by `tests/e2e/harbor-preview-handshakes.spec.ts`, including:

- `HARBOR_PREVIEW_EXPECTED_COMMIT_SHA`: full 40-character SHA served by both app and worker.
- `HARBOR_PREVIEW_CONFIRM_MUTATIONS=RUN_MUTATING_PREVIEW_HANDSHAKES`.
- `HARBOR_PREVIEW_CONFIRM_SUPABASE_REF`: exact preview project ref.
- An authenticated Clerk storage state, test Stripe webhook secret, TLS database URL, controlled worker case, and email sink.

The runner refuses known production hosts, verifies `/api/health/release`, and writes timestamped JSONL evidence to `test-results/harbor-preview-handshake-evidence.jsonl` by default. Retain that artifact with deployment logs; it contains no credentials.

## Preview deployment order

1. Freeze preview checkout creation and pause the worker. Record the full clean Git SHA, its parent, the two migration hashes above, and all local gate results.
2. Confirm the target project ref is the designated non-production Supabase project. Capture its migration ledger, row counts for affected payment/job tables, and a restorable database backup or provider point-in-time restore marker. Record the Storage bucket inventory separately; database backup does not back up object bytes.
3. Run the embedded migration preflights against a restored preview clone when available. Otherwise apply with stop-on-error and a transaction-capable migration runner while traffic remains paused. Any reported duplicate pending/established purchase, Stripe identity, fulfilment identity, legacy payment identity, malformed reservation, duplicate evidence job, unsupported job type, or invalid document binding blocks deployment until provider-backed reconciliation is complete.
4. Recompute both SHA-256 values from the checked-out clean SHA. Apply `20260829000000_release_security_and_fulfilment_hardening.sql`, verify it in the migration ledger, then apply `20260830000000_privileged_edge_and_evidence_jobs.sql` and verify again. Never reorder, squash, mark as applied, or run either migration on production.
5. Deploy every privileged Supabase Edge Function from the same SHA and set the matching `EDGE_PROXY_HMAC_SECRET`. Probe direct-anon, invalid-signature, stale-signature, replay, and valid signed paths before enabling the worker.
6. Verify the Clerk `supabase` JWT template, allowed origins, sign-up/sign-in/session-expiry behavior, and user webhook in preview.
7. Verify Stripe test prices, the test-mode webhook endpoint/signing secret, and sender-domain/SMTP configuration. Set `HARBOR_DEPLOYMENT_ENVIRONMENT=preview`, set `CHECKOUT_REDIRECT_ORIGIN` and `NEXT_PUBLIC_APP_URL` to the same preview origin, and set `HARBOR_PRODUCTION_APP_ORIGIN` to the distinct production origin. Reconcile existing preview Checkout Sessions and PaymentIntents before accepting new checkout traffic.
8. Deploy the Next.js app and confirm `/api/health/release` returns the expected SHA. Configure the same HMAC secret without a `NEXT_PUBLIC_*` prefix.
9. Deploy the Render worker from the same SHA. Confirm its release health/readiness and HMAC minimum-length startup check while the queue remains paused.
10. Run database/payment/job reconciliation, then enable the worker and preview checkout traffic. Run the preview handshake suite and retain timestamped JSONL evidence plus Clerk, Supabase, Stripe, Render, Storage/Realtime, and SMTP provider logs tied to the SHA.

Do not enable the proposed S$8/S$12 subscription or regeneration flow until product policy, Stripe price keys, entitlement statuses, proration, quotas, cancellation, grace periods, and refund behavior are approved. The current release supports case-scoped one-time purchases only. Human consultation checkout and allocation are disabled; a valid historic `human_consult_30m` webhook is retained as a verified payment record only and cannot create a consultation.

## Canonical wiring and retired paths

- Onboarding posts one stable idempotency key to `POST /api/cases/bootstrap`; the server-owned RPC returns the same case for an identical retry.
- The only enabled purchases are `self_serve_report` and `fidrec_tier2_pack`, both through `POST /api/payments/create-checkout-session`. A cancel return retries the same open pending reservation; an established-but-unfulfilled purchase is reconciled instead of charged again.
- `usePaymentStatus` refreshes the typed `GET /api/cases/[caseId]/capabilities` contract. The UI does not infer capability from redirect parameters or reconstruct billing state from database tables.
- Evidence uses `POST /api/evidence/upload` followed by atomic `POST /api/cases/[caseId]/evidence/process`; the latter registers the canonical document and durable processing job in one database transaction.
- Signed Stripe completion enqueues the idempotent `post_payment_report_generation` job. The worker owns extraction/decision/report execution, and the browser reads only Realtime outputs plus `GET /api/cases/[caseId]/job-status`.
- `/api/cases/[caseId]/generate-pack` is retired and must remain absent. A repository-wide caller check must return no production callers. Its canonical replacement is signed Stripe webhook fulfilment → durable report job → fenced worker → privileged Edge report function; there is no manual report-generation endpoint.
- Consultation checkout/allocation, subscriptions, portal management, and regeneration have no enabled CTA or API path. Their typed availability remains `policy_blocked`; the disabled consultation control performs no request.
- Render-check only the canonical route-group pages `app/(marketing)/pricing/page.tsx` and `app/(marketing)/how-it-works/page.tsx`. The duplicate top-level route files stay deleted.

## Reconciliation

Use provider dashboards as external evidence, but canonical ownership and capability come from the database. Never repair ownership from client metadata.

```sql
-- Pre-migration checks: any returned row blocks the preview apply.
select case_id, product_code, count(*), array_agg(id order by created_at)
from public.case_purchases
where payment_provider = 'stripe'
  and payment_status in ('pending', 'paid', 'partially_refunded', 'refunded', 'disputed')
group by case_id, product_code
having count(*) > 1;

select payment_provider, provider_payment_intent_id, count(*), array_agg(id)
from public.case_purchases
where provider_payment_intent_id is not null
group by payment_provider, provider_payment_intent_id
having count(*) > 1;

select stripe_payment_intent_id, count(*), array_agg(id)
from public.payments
where stripe_payment_intent_id is not null
group by stripe_payment_intent_id
having count(*) > 1;

select document_id, count(*), array_agg(id)
from public.jobs
where job_type = 'evidence_document_processing' and document_id is not null
group by document_id
having count(*) > 1;

select coalesce(job_type, '<null>') as job_type, count(*)
from public.jobs
where job_type is null or job_type not in (
  'post_payment_report_generation', 'evidence_document_processing',
  'consultation_recording_ingest', 'consultation_transcribe',
  'consultation_summarise', 'consultation_case_insert'
)
group by job_type;

select id, case_id, job_type, document_id
from public.jobs
where (job_type = 'evidence_document_processing' and document_id is null)
   or (job_type = 'post_payment_report_generation' and document_id is not null);

select d.id, d.case_id, d.processing_status, d.is_processed, d.content_latest_id
from public.case_documents d
where (
    d.is_processed = true
    or lower(coalesce(d.processing_status, '')) in ('ready', 'processed', 'completed')
  )
  and not (
    d.is_processed = true
    and lower(coalesce(d.processing_status, '')) in ('ready', 'processed', 'completed')
    and (
      d.content_latest_id is not null
      or exists (
        select 1
        from public.case_document_extractions extraction
        where extraction.document_id = d.id and extraction.case_id = d.case_id
      )
    )
  );

-- Webhooks that need investigation or safe redelivery.
select provider_event_id, event_type, processing_status, error, created_at
from public.payment_webhook_events
where processing_status in ('received', 'failed')
order by created_at;

-- Pending sessions and established purchases whose fulfilment may need reconciliation.
select cp.id, cp.case_id, cp.product_code, cp.payment_status,
       cp.provider_checkout_session_id, cp.provider_payment_intent_id,
       cp.fulfilment_provider_event_id, ce.case_id is not null as has_entitlement,
       cp.updated_at
from public.case_purchases cp
left join public.case_entitlements ce on ce.case_id = cp.case_id
where cp.payment_status in ('pending', 'paid', 'partially_refunded', 'refunded', 'disputed')
order by cp.updated_at;

-- Queued, failed, or abandoned worker jobs.
select id, case_id, user_id, status, retry_count, locked_at, error, updated_at
from public.jobs
where status <> 'completed'
order by created_at;

-- Storage objects whose metadata rollback could not remove the uploaded object.
select id, storage_bucket, storage_path, reason, attempts, last_error, created_at
from public.storage_cleanup_queue
where resolved_at is null
order by created_at;
```

Redeliver the original signed Stripe event where possible. The `(payment_provider, provider_event_id)` ledger, checkout-session uniqueness, PaymentIntent uniqueness, fulfilment-event uniqueness, and job idempotency key make duplicate delivery safe. Out-of-order refunds/disputes remain replayable until Checkout completion creates the canonical purchase; reconciliation never deletes generated reports or purchased outputs.

The worker refreshes `jobs.updated_at` every minute. Each Edge request has a two-minute abort deadline and the whole job has a ten-minute deadline, both below the 15-minute abandoned-lease recovery window. A timeout or uncertain heartbeat leaves the job `running`, records the error, and stops heartbeats so `claim_next_job()` can recover it only after the full stale-lease window; it is never immediately requeued beside an uncertain downstream request. The claim RPC then changes `locked_at`. Old workers can no longer call the proxy or complete the reclaimed job with the stale token. Investigate repeatedly failed jobs before deliberately setting them back to `queued`.

For each unresolved `storage_cleanup_queue` row, verify that no matching `evidence` metadata row exists, remove the exact object from the recorded bucket/path with an audited service-role operation, increment `attempts` and record `last_error` on failure, or set `resolved_at` and `updated_at` on success. Never bulk-delete by case prefix, and never mark a row resolved before Storage confirms deletion.

## Rollback and forward-fix recovery

1. Pause the worker and disable new checkout creation before changing data or code. Keep the Stripe webhook reachable so events remain durably recorded in the provider and can be redelivered.
2. If a migration preflight fails, stop. Preserve its output and the backup marker, reconcile the sampled keys against Stripe or existing job artefacts, and rerun the unchanged migration. Never bypass the preflight or edit migration history.
3. If `20260829` succeeds but `20260830` fails, leave application/worker traffic paused. Do not deploy the release code against the partial schema. Reconcile the failure and finish `20260830`, or restore the entire preview database backup before any release traffic is admitted.
4. After either migration has carried release traffic, use an additive forward corrective migration. Do not reverse applied RLS, grants, identity mapping, payment ledgers, durable jobs, or lease constraints in place.
5. Roll the app and worker together only to a schema-compatible known-good SHA. Do not run mixed worker/app revisions or point a previous worker at the new queue protocol without an explicit compatibility review.
6. If a webhook failed, correct configuration or code and redeliver the same signed provider event. Do not fabricate a replacement event, move a refund/dispute state backward, or create a second purchase.
7. If a job timed out or its lease is uncertain, leave it running for the 15-minute stale-lease window; do not manually requeue it while a downstream request could still be active. The original claim must remain denied after expiry or reclaim.
8. Verify capabilities through `/api/cases/[caseId]/capabilities`; do not reconstruct UI state from several tables.
9. Never delete reports, documents, or purchased outputs because of a refund, dispute, cancellation, subscription loss, or rollback. Any future revocation policy requires a separate approved migration.
10. Re-run reconciliation and every preview handshake, then attach new timestamped evidence to the exact forward-fix or rollback SHA.
