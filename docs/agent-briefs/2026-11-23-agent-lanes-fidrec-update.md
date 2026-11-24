# FIDReC pack update — work split into six agent lanes

23 November 2026 (revised the same day: the evidence check moved from buying to generation). Companion to `docs/agent-briefs/2026-11-20-agent-brief-fidrec-technical-records-and-standards-corpus.md` (brief v5, on `main`). Read the brief first; this file says who builds which part and which files each agent may touch.

State this is written against: `main` @ 59f5420 (in production, paid stages off). `feat/fidrec-standards-2026-11` @ 8a87cbe holds the two corpus migrations and has not moved since 22 November.

## How the split works

- One shared **integration branch**, `feat/fidrec-update`. Every lane branches from it and opens its pull request back into it. Nothing from this work goes to `main` until the whole update is assembled and tested. `main` stays releasable, and staging keeps deploying from `main`.
- **One owner per file.** The lists below are exhaustive. An agent that needs a change in a file it does not own writes the request in its pull request description; the owner makes the change.
- **A contract comes first** (Step 0). It fixes the shapes the lanes exchange, so lanes can build against each other without waiting.
- **Each agent uses its own local database.** No lane touches staging, production, GitHub settings, Render, Stripe, Clerk or the Supabase projects.
- Elena merges lanes into the integration branch in the order given at the end, then one pull request to `main`.

## Rules for every lane

1. Touch only the files your lane owns. New files go in the folders your lane owns.
2. Do not edit `supabase/functions/_shared/facts/index.ts`, `package.json` or the lockfile. Lane 6 owns them; ask in your pull request if you need an export or a dependency.
3. Only Lane 1 writes migrations on the integration branch. They are dated **20261201 or later**. Migrations on `main` stay earlier than that until the final merge.
4. The contract file is frozen after Step 0. Only Lane 6 changes it, and tells every lane when it does.
5. Fixtures and test data are synthetic (`CLAUDE.md`). Source documents (regulations, bank terms, card-network sections) go to private storage; only keys, hashes and links are committed.
6. A pull request is ready when the type check, the lane's own tests and the full contract suite pass.
7. Stop and report when blocked on another lane or on Elena. Do not work around it in a file you do not own.

## Before Step 0 — the evidence check on `main` (Gate B, release agent)

Elena's decision, 23 November: **documents never block buying a pack; they block generating it.** The check is refused at generation with a new reason beside `facts_unconfirmed` and `documents_processing`, and the checklist is not on the `/facts` page: it is built on the dashboard (`app/(case)/app/case/[id]/dashboard/**`, release agent) using `components/state-machine/facts/pack-evidence.tsx`, in draft PR #35 on `main`, which is not merged yet.

This work touches files a lane owns later: the two pack functions and builders (Lane 6). The dashboard stays with the release agent. So it is **built and merged on `main` before `feat/fidrec-update` is created.** After Step 0, any further change to it is made by the lane that owns the file.

## Step 0 — set-up and contract (Lane 6 does this first; everyone else starts after it merges)

1. Create `feat/fidrec-update` from `feat/fidrec-standards-2026-11` rebased onto `main` (with the evidence check already on `main`).
2. Rename the two corpus migrations to `20261201120000_standards_corpus.sql` and `20261202120000_standards_review_links.sql`. They are applied nowhere, so renaming is safe.
3. Add `supabase/functions/_shared/facts/update/contract.ts`:
   - the new fact types (brief Phase 3b): `AccessEvent`, `CardAuthEvent`, `DeviceRecognition`, `ReportedEvent` uses, `CardDisputeResponse`, `InstitutionFaultLabel`, and the 4a additions (balance before first disputed payment, alert threshold, token activation method);
   - `ComparisonLine` — `{ clauseKey, record, expected, outcome: 'differs' | 'matches' | 'not_shown' | 'not_applicable', evidenceIds }`;
   - `SectionBuilder` — one function per pack section: `(input: SectionInput) => SectionResult`;
   - `ClauseProvider` — `getClauseAsOf`, `getClausesByTag`, `getStatementAsOf`, matching the database functions, plus an in-memory fake for tests;
   - constants: section IDs and their order (brief 4i, with `disputed_amount_charges` after `duty_time_checks` per the review of 24 Nov 2026, Decision 8), the clause keys the rules cite, the statement keys (brief 4d, 4a link statements, Phase 7 seeds).
4. Add four synthetic cases under `tests/fixtures/fidrec-update/`: an account case in SRF scope; a card-only case (token activated, card added to a wallet, 3-D Secure payments); a mixed case; a case with no technical records.
5. Commit this file to `docs/agent-briefs/`.

## The lanes

### Lane 1 — Corpus (brief Phase 1 remainder and Phase 2)

Branch `lane/corpus`.

Owns:
- `supabase/migrations/202612*` (all migrations on the integration branch)
- `scripts/standards/**` (loader, verification sheet, rule-citation build step)
- `supabase/standards/manifests/mas.*`, `abs.*`, `fidrec.*`
- `supabase/standards/seeds/statements/` files for `eupg.*`, `srf.*`, `abs.*`, `mas.*`, `link.*`, `bridge.*`
- `supabase/standards/seeds/institutions.json`
- `scripts/sql/tests/test_standards*`, `tests/contracts/standards-*.test.ts`
- `supabase/functions/_shared/facts/rules/srf.ts` and `rules/fidrec.ts` (moving citations to clause keys only)

Work, in order:
1. Fix the statement approval check so "does not apply to cards" statements can be approved (add an explicit exclusion flag, with a test).
2. Build the loader: source file in private storage plus a manifest gives a draft version. Running it twice changes nothing; another database gets identical hashes. It also produces a verification sheet (each clause beside its source page).
3. Load, each as its own pull request: EUPG (16 Dec 2024); SRF Guidelines and workflow infographic; FSM-N05 and FSM-N06; ABS card code; MAS reply of 7 Jan 2025; ABS release of 17 Feb 2025; then the rest of the brief's Phase 2 table.
4. Seed the institutions list from `institutions.ts`.
5. Move the citations in `rules/srf.ts` and `rules/fidrec.ts` to clause keys; fill the rule-citation table from code; test that every citation resolves.
6. Enter the seed statements as drafts.
7. Later: run Lane 5's manifests through the loader.

Needs Elena: verify each loaded version; approve each statement.

### Lane 2 — Evidence (brief Phase 3)

Branch `lane/evidence`.

Owns:
- `supabase/functions/_shared/facts/extraction.ts`, `keys.ts`, `answers.ts`, `reconcile.ts`, `free-sections.ts`, `display.ts`
- `supabase/functions/run_case_extract_v4/**`, `supabase/functions/evidence_processed_v2/**`
- `lib/server/facts/facts-service.ts`, `lib/server/facts/run-reconcile.ts`
- `app/(case)/app/case/[id]/facts/**` (the device confirmation screen)
- `supabase/functions/_shared/ip-location/**`, `scripts/ip-db/**`
- `app/api/privacy/**` (export and deletion of the new facts)
- `docs/legal/drafts/privacy-technical-records.md` (draft text only; the live policy is not edited)
- `tests/contracts/evidence-*.test.ts`, `tests/contracts/ip-location.test.ts`

Work:
1. Two document types: `bank_access_record`, `card_authentication_record`.
2. The new facts, using the contract types; extraction against synthetic records.
3. The device confirmation screen ("Is this one of your devices?").
4. IP location lookup against a locally loaded database; a shortlist of databases with licence terms.
5. Export and deletion for the new facts; nothing written to analytics or logs.
6. Draft privacy-policy wording for the new data.

Needs Elena: choice of IP database; the privacy wording.

### Lane 3 — Comparisons (brief 4a, 4b, 4c)

Branch `lane/comparisons`.

Owns (all new files):
- `supabase/functions/_shared/facts/rules/duty-time-checks.ts`
- `supabase/functions/_shared/facts/rules/mas-notice-checks.ts`
- `supabase/functions/_shared/facts/rules/industry-practice-checks.ts`
- `supabase/functions/_shared/facts/rules/link-statements.ts`
- `supabase/functions/_shared/facts/rules/dispute-charges-checks.ts` (section `disputed_amount_charges`; review of 24 Nov 2026, Decision 8)
- `tests/contracts/duty-time-checks.test.ts`, `mas-notice-checks.test.ts`, `industry-practice-checks.test.ts`, `link-statements.test.ts`, `dispute-charges-checks.test.ts`

Work: each file exports `SectionBuilder`s that take the contract facts and a `ClauseProvider` and return `ComparisonLine`s. Build and test against the fake provider and the Step 0 fixtures. Includes the fraud-surveillance condition, the further-device login lines, routing by payment type and institution type, and the boundary tests in the brief's Phase 4 gate. Reads `rules/instrument-scope.ts`; does not edit it.

### Lane 4 — Sequence and customer fault (brief 4d, 4e, 4f, 4g)

Branch `lane/sequence-fault`.

Owns (all new files):
- `supabase/functions/_shared/facts/rules/account-access-sequence.ts`
- `supabase/functions/_shared/facts/rules/customer-fault-definitions.ts`
- `supabase/functions/_shared/facts/rules/customer-conduct.ts`
- `supabase/functions/_shared/facts/rules/institution-terms.ts` (resolving a configured term request as of a date)
- matching test files under `tests/contracts/`

Work: the same pattern as Lane 3. The sequence section prints statement keys, not wording; the wording lives in the statement seeds (Lanes 1 and 5).

### Lane 5 — Bank terms and card networks (brief Phases 6 and 7)

Branch `lane/terms-schemes`.

Owns:
- `supabase/standards/manifests/visa.*`, `mastercard.*`, and one manifest per institution document
- `supabase/standards/seeds/statements/` files for `visa.*` and `mc.*`
- `supabase/standards/seeds/term-requests/*.json`
- `supabase/functions/_shared/facts/rules/card-dispute-checks.ts` and its test

Work:
1. Card networks: extract only the manifest sections from the current Visa and Mastercard editions (brief Phase 7); draft the statements in the networks' own terms.
2. `card-dispute-checks.ts` against the contract and the fake provider.
3. Bank terms: start with the institution in the first real case. Collect each document and its earlier versions; write manifests and term-request rows.
4. Test loads on its own local database with Lane 1's loader, then hand the manifests to Lane 1.

Needs Elena: approve each scheme statement; confirm which institution comes first. Depends on Lane 1 step 2 (the loader) for its loads; items 1 and 2 can start before that.

### Lane 6 — Assembly (Step 0, brief 4h, 4i, Phase 5, final integration)

Branch `lane/assembly`.

Owns:
- `supabase/functions/_shared/facts/update/contract.ts`, `tests/fixtures/fidrec-update/**`
- `supabase/functions/_shared/facts/fidrec-pack.ts`, `bank-pack.ts`, `index.ts`, `validate-output.ts`
- `supabase/functions/_shared/facts/rules/instrument-scope.ts`
- `supabase/functions/run_fidrec_pack_v1/**`, `run_bank_pack_v1/**`, `run_case_decision_v1/**` (including the evidence check's refusal at generation once Step 0 is done)
- `lib/server/facts/fidrec-pack-pdf.ts`, `bank-pack-pdf.ts`
- `package.json`, the lockfile
- `tests/e2e/**` and `tests/contracts/fidrec-pack*.test.ts` for the updated pack

Work:
1. Step 0.
2. A section registry in `fidrec-pack.ts`: the pack calls each lane's `SectionBuilder` in the contract's order. Until a lane merges, its section is a stub that prints nothing.
3. A database-backed `ClauseProvider` that reads only through the as-of functions.
4. Rendering of the new sections in the pack and its PDF.
5. The no-verdict-wording guard for templates, statements and model output.
6. The "Standards" section by retrieval (Phase 5); retire the model-written duties section.
7. The bank pack's request line for missing technical records.
8. After all lanes merge: end-to-end runs of the four synthetic cases; then the pull request to `main`.

## Separate track on `main` — Gate B (not part of the lanes)

The release agent keeps `main`: the evidence check before generation (see "Before Step 0"), the Stripe product names, and the paid-stages-on release. It owns `lib/billing/**`, `app/(case)/app/case/[id]/dashboard/**`, `app/(case)/app/case/[id]/checkout/**`, `app/api/payments/**` and any migration dated before 20261201. No lane edits those. The rules for buying a pack are unchanged. Lane 6 merges `main` into the integration branch after each Gate B merge.

## Order of merging into `feat/fidrec-update`

1. Step 0 (Lane 6).
2. Lane 1, items 1–2 (approval fix, loader).
3. Lanes 2, 3 and 4, in any order, as each is ready.
4. Lane 1's document loads and statements, as Elena verifies and approves them.
5. Lane 5.
6. Lane 6's assembly, last.
7. One pull request from `feat/fidrec-update` to `main`, then staging, then the release gates.

## What cannot be made parallel

- The evidence check merges on `main` before Step 0.
- Step 0 must merge before any other lane starts.
- Document loads wait on Elena's verification; statements wait on her approval.
- Assembly and the end-to-end runs come after the lanes.

## First message for each agent

"You are Lane N of the FIDReC pack update. Read brief v5 and `docs/agent-briefs/2026-11-23-agent-lanes-fidrec-update.md`. Branch `lane/<name>` from `feat/fidrec-update`. Edit only the files your lane owns. Use your own local database. Open your pull request into `feat/fidrec-update`, not `main`. Report and stop when you are blocked on another lane or on me."
