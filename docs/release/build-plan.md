# Build plan after go-live

Status: 14 November 2026. One order of work across every open brief, so nothing is built twice or out of order.
Sources:
- the stage 2 plan (`docs/release/stage2-plan.md`, branch `feat/stage2-paid-packs`);
- website brief W1 with Addenda V, M and A v2 (`docs/agent-briefs/`, not in git);
- the cutover checklist.

Progress is reported as items done against items planned.

## Rules that shape the order

1. **People own the legal acts.** A person creates the account, accepts the Terms, pays, confirms the facts and
   starts generation. Software never does these (Addendum A P3.1, Terms clause 5 draft).
2. **Publish a discovery file only for something that exists** (Addendum A). The scanner score is not a target.
3. **Every reader gets the same content.** Markdown copies equal their HTML pages; no user-agent branches.
4. **Owner review before every generation** (Addendum A P3.4) applies to all three outputs. The paid packs are
   built on it from the start, so they are not reworked when Phase 3 arrives.
5. **Terms and Privacy change only with text Elena supplies after legal review**, with the 14-day notice of Terms
   clause 10 for material changes.

## Order of work

| # | Track | Contents | Gate | Status |
|---|---|---|---|---|
| 1 | Crawl files | robots.txt, sitemap, llms.txt, icons, noindex default, canonical fix | Elena merge | **Live 14 Nov** (PR #8) |
| 2 | Addendum A Phase 1, part 1 | Content signals; `describedby` Link header | Elena merge | **Live 14 Nov** (PR #9); robots.txt reached crawlers once Cloudflare's 4-hour cached copy expired |
| 3 | Addendum A Phase 1, part 2 | `Cache-Control: public, max-age=3600` on every crawl and discovery file; Addendum M markdown copies and `Accept: text/markdown` negotiation (with `x-markdown-tokens`); `alternate` Link header; `llms.txt` lists the copies; `llms-full.txt`; `/auth.md` and the agent skill with its index (texts approved 14 Nov) | Elena merge | Next |
| 4 | W1 Batch 1 (P0) | First screen and phone button; one CTA label; trust row (wording b); "What GuideBuoy is"; phone story form; sign-up without Singpass; text fixes; titles (L3); type scale (V1) and story box (V4); copy ledger and test updates; all public baselines re-taken | G-W1 staging review | After 3 |
| 5 | Analytics 2 (W1 §N) | New `funnel_events` table; seven journey steps plus the before-sign-up steps (started typing, submitted, reached sign-up, case created) linked by a per-tab random id; journey times as totals (median, slowest quarter); Analytics 1 and its tracker unchanged | Migration through the hashed procedure | With 4 |
| 6 | Stage 2 step 0 | Upload after the evaluation, facts re-checked and a new evaluation offered; voice and text add up; one date format; refused starts and checkouts logged; no default institution in the FIDReC narrative | — | After 4 |
| 7 | Owner review gate (P3.4) | Review screen with source and "entered by" per fact; tick box (wording pending legal review); fresh email code; confirmation record hashed to the content; generation refused without it. Applies to the free evaluation now and to both packs as they are built | Lawyer's confirmation wording | With 8 |
| 8 | Stage 2 milestones 1–5 | Migration 40 (readiness and `workflow_type`); bank pack; FIDReC pack with the route question before payment; journey and pricing pages; release with Stripe live | Elena at each gate | Target 1 Dec (moves with the real date) |
| 9 | W1 Batch 2 (P1) | Emergency and route strips, product cards, About and team (each person's OK), samples from a synthetic case, navigation, FAQ in HTML, structured data, link previews, Guides scaffolding | G-W1, G-W2 | After 8, or alongside if 8 waits on a gate |
| 10 | Addendum A Phase 2 | W1 §P tools (FIDReC deadline calculator, "Is my scam covered?"), public JSON API, `openapi.json`, `/.well-known/api-catalog`, MCP server with read-only tools and server card | G-A2a design note, G-A2b lawyer read | After 9 |
| 11 | Addendum A Phase 3 | Connected assistants (OAuth 2.1 with PKCE, `case:read` and `case:write` only), proposed-not-confirmed entries, activity log, OAuth discovery files, new auth.md and skill | Signed Terms and Privacy, 14-day notice, G-A3a design note, security review | After 10 |

## The free evaluation as an API

Elena asked for the free evaluation to be an API candidate (14 Nov). Under rule 1 it cannot be a no-sign-in
public API: generating it needs an account and the owner's confirmation. It comes in two steps:
- **Phase 2:** the public tools give a short, rule-based first answer ("Is my scam covered?", the FIDReC
  deadline). The `how_to_start` tool hands the person the start link. No story is accepted.
- **Phase 3:** a connected assistant prepares the case through `case:write`, and `get_case_status` reports
  `awaiting_owner_review`. The owner reviews, confirms and starts the free evaluation in the browser.
  `get_output` then lets the assistant read it.

## Terms of Service v2.1 (held)

Built on branch `web/terms-2-1`, not published (Elena, 14 Nov). Clause 5.1 to 5.3 of Annex T replace clause 5;
`/terms` keeps v2.0 with a notice and switches by itself on the effective date. It waits for the Privacy Policy
changes Elena is preparing, so both can go out with one notice. Before sending a notice, count the account holders on
production: on 14 Nov there were 2 profiles (both Elena's) and 1 other Clerk sign-up with no profile or case.

## Lessons for releases

- Cloudflare caches `.txt` and `.xml` for 4 hours unless the app sets `Cache-Control`. Every crawl and discovery
  file sets a 1-hour cache itself. Runbook: `docs/runbooks/web-release-and-cloudflare.md`; skill:
  `.claude/skills/cloudflare-release`.
- Check a release one minute after Render reports `live`; the old instance answers briefly.

## Running items from go-live

- 19 Nov: delete the suspended maintenance service if no rollback was needed (Elena's OK).
- 12 Dec: first key rotation.
- Canary: off until Elena decides.
- Week-one list (cutover checklist): account button on every page, WhatsApp button, foreign-key indexes, worker SMTP
  settings in `render.yaml`, CI job time limits, Gemini key check.
- CI cost: move the public Playwright lane from Windows to Linux and re-take its baselines (needs Elena's OK).
- Security check in the browser: session cookies marked Secure.

## Open decisions

| # | Decision | Owner |
|---|---|---|
| O1 | When to publish the new Terms clause 5 and the Privacy changes, after legal review | Elena and lawyer |
| O2 | Model training on de-identified cases (Privacy Policy §2, D-OPEN-1) | Elena and lawyer |
| O3 | Final confirmation wording for P3.4, and whether it differs for free and paid outputs | Lawyer |
| O4 | Stage 2 release date (moves `PAID_STAGES_AVAILABLE_FROM`) | Elena |
