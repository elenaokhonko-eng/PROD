# Model keys and costs

Cost-controls spec (`docs/agent-briefs/2026-11-08-spec-model-cost-controls-and-key-security.md`) §3 A2–A5, §4 and
§6 C3. Numbers approved by Elena on 8 Nov 2026 from `docs/release/model-call-inventory.md`. Key **names** only:
never write a key value here, in chat, in logs or in evidence.

## Which key each caller uses (A3)

| Caller | Runtime | OpenAI key | Gemini key | Where it is set |
|---|---|---|---|---|
| Web app (fact extraction, router, transcription, triage) | Render web service | `OPENAI_API_KEY` | `GOOGLE_GENERATIVE_AI_API_KEY` | Render → web service → Environment |
| Worker | Render worker | none (calls the web app's `/api/edge/*` routes) | none | — |
| Edge Functions (summary, case extraction, evidence reading, health check) | Supabase | `GuideBuoy_EdgeFunction` | `GEMINI_API_KEY` | Supabase → Edge Functions → Secrets |

Rules: staging and production never share a key; the web app and the Edge Functions never share a key. That makes
**eight keys** in total (four names × two environments). Each Google key sits in its own Cloud project or carries its
own quota, so one runaway caller cannot spend another's allowance.

## Restricting the Google keys (A2)

For the **production web key** (`GOOGLE_GENERATIVE_AI_API_KEY`), in Google Cloud → APIs & Services → Credentials →
the key:

1. **API restrictions:** Restrict key → only **Generative Language API**.
2. **Application restrictions:** IP addresses → add the Render production service's static outbound IPs. To find them:
   Render dashboard → the production web service → **Connect** → **Outbound** tab. Copy every listed address.
3. Save, then check `/api/health` and one free evaluation on production. A stolen key is now useless anywhere else.

The **Edge Function key** (`GEMINI_API_KEY` on Supabase) cannot be IP-restricted: Supabase Edge Functions have no
static outbound IP. Give it API restriction only, its own **low quota** (below), and rotate it **monthly**.

## OpenAI production project (A4)

In platform.openai.com → Projects, create **GuideBuoy production**. Create one project-scoped key for the web app
(`OPENAI_API_KEY`) and one for the Edge Functions (`GuideBuoy_EdgeFunction`). In the project's limits, allow only the
models in use: `gpt-4.1-mini` (fact and case extraction) and `gpt-4o-mini-2024-07-18` (summary). The keys live only on
the server (Render, Supabase secrets); a CI test fails if a key appears in the client bundle.

## Console settings (§4), set by Elena

| Provider | Setting | Value |
|---|---|---|
| OpenAI | Organisation monthly budget, hard limit | US$100, alert at US$50 |
| OpenAI | Production project budget | US$80 a month |
| Google Cloud | Budget with email alerts at 50%, 90%, 100% | US$100 a month |
| Google Cloud | Generative Language API quotas (production web key's project) | 30 requests per minute, 120,000 tokens per minute, 1,500 requests per day |
| Google Cloud | Edge Function key's project | the same per-minute quotas, 500 requests per day |
| Google Cloud (optional) | Billing kill switch (budget → Pub/Sub → function that detaches billing at 150%) | only if that project holds nothing else |
| Supabase | Spend cap | On |
| Clerk | Bot protection (captcha) on sign-up | On; check monthly active users weekly, act on a jump above 500 in a day |
| App | `MODEL_DAILY_CAP_USD` (Render web and worker) | 20 (warning email at 80%, model calls stop at 100%) |
| App | `COST_ALERT_EMAIL` (Render worker; falls back to `ADMIN_EMAIL`) | Elena's address |

Take a screenshot of each setting for the release evidence file (no key values visible).

## Rotating a key in under 10 minutes (A5)

Rotate every key at cutover and again 30 days later; rotate the Edge Gemini key monthly.

1. Create the new key in the provider console with the same restrictions as the old one (do not delete the old one
   yet).
2. **Render keys** (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`): Render → service → Environment → edit the
   value → Save, rebuild and deploy (or Manual Deploy → Deploy latest commit). About 3–5 minutes.
3. **Supabase keys** (`GuideBuoy_EdgeFunction`, `GEMINI_API_KEY`):
   `supabase secrets set NAME=… --project-ref <ref>` (type the value at the prompt or from a file, never in shell
   history), then redeploy the functions that read it:
   `supabase functions deploy bright-function run_case_extract_v4 evidence_processed_v2 ai_model_health_v1 --project-ref <ref>`.
4. **Verify:** call `ai_model_health_v1` (every model reports healthy) and run one free evaluation; on staging the
   release CI does this.
5. Delete the old key in the provider console. Record the rotation date (names only) in the release log.

**Rehearsal on staging (before cutover):** Elena creates new staging keys for all four names and passes them to the
agent through the environment, not chat; the agent swaps them using steps 2–4 against `yqqkkftfddxuxmpxwbcj` and
times it; Elena deletes the old staging keys.

## Alerts (§6 C2)

The worker checks hourly and emails `COST_ALERT_EMAIL` at most once per Singapore day per kind:

| Alert | Threshold |
|---|---|
| Daily spend | ≥ 80% of `MODEL_DAILY_CAP_USD` (at 100% calls stop; people get the summary version) |
| Single case | any case over US$2 in a day |
| Rate limiting | over 5% of model calls answered with HTTP 429 in the last hour (at least 20 calls) |

Each sent alert is recorded as an `analytics_events` row (`cost_alert`, with kind, day and environment). Emails hold
numbers, case IDs and the environment only. **Model unhealthy:** the existing `ai_model_health_v1` check and the web
health route report it. **Key used from an unexpected IP:** set a Google Cloud log-based alert on the API key's
audit logs for requests from outside the Render outbound IPs (Monitoring → Alerting); this is a console setting, not
app code.

## Weekly cost note (C3)

Every Monday for the first month, open `/analytics` (admin role only) → **Model costs**:

- **Today / Last 7 days:** spend, calls, cost per free evaluation (expect about US$0.015), summary-version rate
  (investigate above 10%), HTTP 429 count.
- **By purpose / by model:** evidence reading is normally the largest line; a jump in fact extraction or summary
  calls per evaluation means retries or a loop.
- **Top cases:** any case far above US$0.10 is worth a look (case IDs only).

**Raise a cap** only deliberately and in writing: when real use (not a loop or abuse) reaches 50% of a cap on two
days in a week. Raise the provider limit first, then `MODEL_DAILY_CAP_USD`. **Rotate** a key at once if usage
appears that `/analytics` does not explain, if a key may have been exposed, or on the 30-day and monthly schedule
above.
