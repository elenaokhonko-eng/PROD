# Model-call inventory (gate C0)

Spec: `docs/agent-briefs/2026-11-08-spec-model-cost-controls-and-key-security.md` §2. Prepared 8 Nov 2026 for Elena's
approval. Token counts were measured on 8 Nov against the real APIs with the staging keys and **synthetic data only**
(the e2e SMS story, corpus stories `short-01`, `sms-02`, `long-01`, `long-02`, the synthetic statement PDF and the
synthetic statement and police report texts). No prompt or response text is recorded here. Measurement spend:
under US$0.05.

## Prices used (list, per 1M tokens, checked 8 Nov 2026)

| Model | Input | Cached input | Output | Source |
|---|---|---|---|---|
| gpt-4.1-mini (fact extraction, case extraction) | $0.40 | $0.10 | $1.60 | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |
| gpt-4o-mini-2024-07-18 (summary, pinned snapshot) | $0.15 | $0.075 | $0.60 | same page, gpt-4o-mini row. Assumption: the dated base snapshot is billed as gpt-4o-mini; the page's $0.30/$1.20 row for this ID is the fine-tuned price |
| gpt-4.1 (corpus judge, test only) | $2.00 | $0.50 | $8.00 | same page |
| text-embedding-3-small (paid stages only) | $0.02 | — | — | same page |
| gemini-3.8-flash (evidence, router, transcription), Standard tier | $0.75 | $0.075 | **$3.75 including thinking tokens** | [Gemini API pricing](https://aistudio.google.com/docs/pricing) |

**Gemini prices double on 1 January 2027** (input $1.50, output $7.50). The page lists no separate audio price for
3.8 Flash; transcription below assumes the text input price and the 25 audio tokens per second stated for the
transcription models (assumption, not confirmed for 3.8 Flash).

## Every model call

Stage 1 = runs with paid stages off. "Before sign-in" = reachable without a Clerk session (`middleware.ts` protects
only `/app/*`; API routes check auth themselves).

| # | Call (file:line) | Purpose | Provider / model (env override) | Stage 1 | Trigger | User waiting | Before sign-in | Output cap | Timeout / retries | Calls per case |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `lib/server/facts/run-reconcile.ts:208` → `lib/server/ai/generate-json.ts:100` | Fact extraction, one call per source | OpenAI Responses, gpt-4.1-mini (`OPENAI_MODEL`) | Yes | Opening the confirm screen / facts check (`/api/cases/[id]/facts`, snapshot) when the story, an answer or a document changed | Yes ("Checking your story…") | No | **None** | 30 s, 1 SDK retry; 4 sources in parallel | Story 1 + 1 per ready document + 1 for free-text answers; again only for a source that changed (unchanged sources reuse candidates) |
| 2 | `supabase/functions/_shared/facts/summary-ladder.ts:171` (bright-function) | Free-evaluation summary | OpenAI chat, gpt-4o-mini-2024-07-18 (`TIER0_MODEL`) | Yes | "Confirm and continue" / "Try again" (`/api/edge/tier0`) | Yes | No | **None** (length rule ≤ 450 words) | 40 s per call, 1 retry, 90 s budget | 1; at most 2 ladder attempts × 2 provider attempts = 4 |
| 3 | `supabase/functions/run_case_extract_v4/index.ts:1289` (`openaiExtract`, :304) | Structured case extraction (gaps, follow-up questions) | OpenAI Responses, gpt-4.1-mini (`CASE_EXTRACT_MODEL`) | Yes | Intake submit (`use-submit-intake.ts:21`), automatic re-run when documents settle (`use-auto-refire-extract.ts:72`), saved follow-up answers | Yes (follow-up questions) | No | **None** | 1 retry only if the JSON is invalid (:341) | Typically 2–3 |
| 4 | `supabase/functions/evidence_processed_v2/index.ts:447` (`runGemini`, :315) | Read and classify each uploaded document; returns its full text (`raw_text`) | Gemini REST, gemini-3.8-flash (`EVIDENCE_GEMINI_MODEL`) | Yes | Worker job after an upload | Partly (documents "still being read") | No | **None**; output grows with document length; thinking unbudgeted | Up to 4 attempts on 429/overload | 1 per document |
| 5 | `app/api/transcribe/route.ts:56` | Voice-to-text for the story box | Gemini SDK, gemini-3.8-flash (`GOOGLE_GENERATIVE_AI_MODEL`) | Yes (home page and story box) | Microphone button | Yes | **Yes: no auth, no rate limit, no audio size limit** | **None** | SDK default | 0–3 |
| 6 | `app/api/router/classify/route.ts:143` | Router triage signals | Gemini SDK, gemini-3.8-flash | Yes (`/router`) | "Check my complaint path" | Yes | **Yes** (rate limit 20/min per IP) | **None** | SDK default | 0–1 (router users only) |
| 7 | `app/api/router/questions/route.ts:87` | Router follow-up questions | Gemini SDK, gemini-3.8-flash | Yes (`/router/questions`) | Router | Yes | **Yes** (20/min per IP) | **None** | SDK default | 0–1 |
| 8 | `app/api/triage/analyze/route.ts:39,51,63` | Proxies 6 and 7 (and the rules engine) | — | Yes | Router | Yes | **Yes** (30/min per IP) | — | — | adds to 6/7 |
| 9 | `lib/server/ai/model-health.ts:50`, `supabase/functions/ai_model_health_v1/index.ts:51` | Model health probe | Gemini 1-token generation; OpenAI model lookup (free) | Yes | `/api/health/release` (signed-in), admin probe | No | No | 1 token | 15 s, cached 60 s | negligible |
| 10 | `supabase/functions/run_case_decision_v1/index.ts:415,435` | Decision run + embeddings | OpenAI Responses gpt-4.1-mini (`CASE_DECISION_MODEL`), text-embedding-3-small | **No (paid stages)** | Worker after payment | No | No | None | — | 0 in stage 1 |
| 11 | `supabase/functions/run_report_selfserve_v1/index.ts:283` | Self-serve report | OpenAI Responses gpt-4.1-mini (`SELF_SERVE_REPORT_MODEL`) | **No (paid)** | Worker after payment | No | No | None | — | 0 |
| 12 | `lib/server/fidrec/*.ts` (generate-case-themes, -findings, -evidence-requests, -investigation-questions, extract-bank-assertions, consolidate-*, link-assertions-findings), `retrieve-theme-regulatory-clauses.ts:193` | Tier 2 FIDReC pack | OpenAI Responses gpt-4.1-mini via `generateJson`; embeddings via `generate-embedding.ts:19` | **No (paid)** | `/api/fidrec/tier2/*` | Yes | No | None | 30 s default | 0 |
| 13 | `supabase/functions/backfill_embeddings_v1/index.ts:35` | Regulatory corpus embeddings | text-embedding-3-small | Admin only | Admin trigger | No | No | — | — | 0 per case |
| 14 | `scripts/tier0-corpus/run.ts` | Corpus: extraction, summary, gpt-4.1 judge | as 1 and 2, plus gpt-4.1 | Test only | Manual run | — | — | — | — | about US$1.50 per full run (153 runs) |

## Measured tokens per call (synthetic data)

| Call | Sample | Input | Cached | Output (incl. thinking) | Cost |
|---|---|---|---|---|---|
| 1 Fact extraction, story | short-01 | 833 | 0 | 435 | $0.0010 |
| | e2e SMS story | 873 | 0 | 534 | $0.0012 |
| | sms-02 | 871 | 0 | 554 | $0.0012 |
| | long-01 (~550 words) | 1,417 | 0 | 844 | $0.0019 |
| | long-02 (~1,650 words) | 2,613 | 0 | 846 | $0.0024 |
| 1 Fact extraction, document | statement + police report text | 1,155 | 0 | 611 | $0.0014 |
| 1 Fact extraction, answers | journey free text | 851 | 0 | 290 | $0.0008 |
| 2 Summary | short-01 / SMS / sms-02 | 1,045–1,265 | 0 | 94–141 | $0.0002–0.0003 |
| | long-01 / long-02 | 1,720 / 2,962 | 0 | 256 / 268 | $0.0004 / $0.0006 |
| 3 Case extraction | SMS story + digest | 1,300 | 0 | 255 | $0.0009 |
| | long-01 + digest | 2,388 | 0 | 286 | $0.0014 |
| 4 Evidence (Gemini) | 1-page statement PDF | 1,429 | 0 | 338 + 287 thinking | $0.0034 |
| | ~6× statement text | 2,546 | 0 | 771 + 666 thinking | $0.0073 |
| 6 Router classify (approximate prompt) | SMS story | 77 | 0 | 81 + 564 thinking | $0.0025 |
| 5 Transcription (estimate, not measured: no synthetic audio) | 2-minute recording | ~3,000 | — | ~400 + ~300 thinking | ~$0.005 |

No call had cached tokens. The fixed part of each prompt is under OpenAI's 1,024-token caching minimum (fact
extraction ~800, summary ~900), so reordering alone will not trigger caching for these calls.

## Cost per free evaluation

Typical case (spec): one story, journey answers, one uploaded statement (assume 3 pages), one summary; 3 case
extractions; fact extraction for story, document and answers, plus one answers re-run.

| Step | Calls | Cost |
|---|---|---|
| Case extraction (3) | 3 × $0.0009 | $0.0028 |
| Evidence, 3-page statement | 1 | ~$0.0070 |
| Fact extraction (story, document, answers ×2) | 4 | $0.0042 |
| Summary | 1 | $0.0003 |
| **Total** | | **≈ US$0.014** |

Worst case: a 1,650-word story, 5 multi-page documents, case extraction 5 times with its JSON retry, fact extraction
re-run 3 times with retries, the summary ladder's 4 provider calls, and 3 voice recordings: **≈ US$0.10**.

**Cost per free evaluation ≈ US$0.015 (typical), ≈ US$0.10 worst case. Per 1,000 evaluations ≈ US$15 typical,
≈ US$100 if every case were worst case.** From 1 January 2027 the Gemini share doubles: typical ≈ US$0.022, ≈ US$22
per 1,000. Optional pre-sign-in use adds about US$0.005 per voice recording and US$0.005 per router session.

## Pre-sign-in model calls (spec B2)

- **`/api/transcribe`** (Gemini): no sign-in, **no rate limit, no audio size or length limit, no output cap**. The
  largest exposure: anyone can post long audio repeatedly.
- **`/api/router/classify`** and **`/api/router/questions`** (Gemini): no sign-in, 20 per minute per IP.
- **`/api/triage/analyze`**: no sign-in, 30 per minute per IP, and calls the two router routes itself.
- All rate limits key on the first `X-Forwarded-For` address (`lib/rate-limit.ts:22`), which a client can set, and are
  held in memory per instance (reset on each deploy). They do not hold against a determined caller.

## Proposed numbers (for Elena's approval)

Assumptions: launch peak 20 evaluations per hour; bursts of 10 journeys in the same minute (the load test); about 4
Gemini requests per evaluation (evidence 1–3, transcription 0–1, router 0–2); about 100 evaluations on a busy launch
day.

| Setting (spec ref) | Expected peak | Proposed |
|---|---|---|
| Gemini requests per minute (§4) | ~10 in a burst | **30 RPM** |
| Gemini tokens per minute (§4) | ~10 requests × ~4,000 tokens = 40,000 | **120,000 TPM** |
| Gemini requests per day (§4) | ~400 | **1,500 RPD** |
| OpenAI monthly hard limit (§4) | ~3,000 evaluations × $0.015 ≈ $45 | spec's US$100, alert at US$50, production project US$80 |
| Daily circuit breaker (§5 B4) | ~100 × $0.015 + pre-sign-in ≈ US$2 per day; 3× = US$6 | **US$20 per day** (spec minimum), warning at US$16 |
| Single-case alert (§6 C2) | worst case ≈ US$0.10 | spec's US$2 stands (20× the worst case) |

Output caps (§5 B5, observed maximum + 30%, rounded up):

| Call | Observed max output | Proposed `max_output_tokens` |
|---|---|---|
| 1 Fact extraction | 846 | 1,100 |
| 2 Summary | 268 (450-word rule ≈ 600 tokens) | 800 (keeps the length rule as the binding limit) |
| 3 Case extraction | 286 | 400 |
| 4 Evidence | 1,437 including thinking for ~6× a statement; grows with pages because `raw_text` copies the document | 8,192, plus a thinking budget of 1,024 and a page or size limit on uploads; a lower cap would cut `raw_text` and break the JSON |
| 5 Transcription | ~700 estimated for 2 minutes | 2,000, with audio limited to 3 minutes |
| 6, 7 Router | 645 (mostly thinking) | 1,000 with thinking budget 256 |

## Surprises

1. **No model call sets an output cap** except the 1-token health probe (calls 1–7 and 10–13).
2. **Voice transcription is open before sign-in** with no rate limit and no size limit.
3. **Gemini thinking tokens are unbudgeted** and billed as output: 287–666 per call measured; 87% of the router call's
   output was thinking.
4. **Evidence processing returns the whole document text** as output, so its cost grows with page count, and it
   retries up to 4 times on overload.
5. **Rate limits can be bypassed** by setting `X-Forwarded-For`, and they reset on every deploy.
6. **Prompt caching gives nothing as the prompts stand**: the fixed parts are below the 1,024-token minimum.
7. Case extraction runs 2–3 times per case (intake, document refire, follow-up answers), each with the full template.
8. Stage 1 cost is low (about 1.5 US cents per evaluation); the material risks are the open pre-sign-in endpoints and
   unbounded document and audio size, not normal use.
