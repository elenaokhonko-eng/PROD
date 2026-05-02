# State Machine / Workflow Document

> ✅ **2026-04-21 PM — Masha feedback reconciliation complete.** The canonical sequence is now **3 Tier-0 functions** (`evidence_processed_v2` → `run_case_extract_v4` with gap loop → `bright-function`) and **2 Tier-1 functions** on the Render worker (`run_case_decision_v1` → `run_report_selfserve_v1`). `candidate-transactions` and `compute-loss` are **Masha-internal fallbacks only** — not in this State Machine. `gemini-task` is **archived**. "Validation" is a **Postgres trigger** on `case_extract_runs`, not a separate function call. Pre-login landing-page narrative capture is **client-side only** (sessionStorage / Clerk `unsafeMetadata`) — no anonymous Supabase rows, so Slice 0 Pattern C is unchanged. Layer 3 is a **human-in-the-loop contact form** shown right after the Tier-1 report: identity + **age** + **employment status** + two **FIDReC-qualification checkboxes** (≥ 30 days since last FI reply? FI issued final response?); server snapshots `amount_lost_sgd` + `financial_institution` from the latest `case_extract_runs` row so Dance's triage view matches what the user saw. LinkedIn CTAs and generic "coming soon" waitlist framing remain deprecated. The binding contract is [`2026-04-21-Masha-Feedback-Reconciliation.md`](./2026-04-21-Masha-Feedback-Reconciliation.md) §0 and §6. This State Machine has been rewritten to match.
> ✅ **2026-04-26 / 2026-05-02 updates.** Layer 3 and Tier 2 are now the same post-Tier-1 surface: FIDReC handoff form, on-page Scam and Fraud Specialist recommendation, persistent root-layout WhatsApp `wa.me` link, and Slice 8 specialist consult / case-pack commerce. The contact form still has no edge-function calls. Structured validation gaps now render from `v_case_validation_gap_items` first, with `questions_to_user` fallback.

**Purpose.** This document describes exactly what happens, in what order, when a user clicks each button or triggers each event in the GuideBuoy product. It is the **execution plan** the frontend will implement against.

**Binding contract.** This document is downstream of [`Front-to-Back-End-Integration-Summary.md`](./Front-to-Back-End-Integration-Summary.md). Every node, arrow, and implementation note in this document references a **specific section** of the Integration Summary in the form `[§N.M]`. If the two documents ever disagree, the Integration Summary wins and this document must be updated.

**Execution plan.** The slice-by-slice refactor plan derived from this document lives in [`State-Machine-Refactor-Plan.md`](./State-Machine-Refactor-Plan.md). Start there when implementing.

**Test plan.** The consolidated QA checklist lives in [`Test-Plan.md`](./Test-Plan.md). Appendix B.10 remains the canonical end-to-end walkthrough, and the standalone test plan mirrors the current smoke gates.

**Layer model (from Integration Summary §1).**
- **Pre-layer — public landing page (unauthenticated, client-side only).** User types / voice-records their story; narrative lives in `sessionStorage` (or Clerk `unsafeMetadata` once sign-up starts). **No Supabase write.** Materialised into `cases` + `case_intake` on the first authenticated request post-login.
- **Layer 1 = Tier 0 = `free`** — post-login intake → evidence upload → extract + gap loop → Tier-0 free narrative.
- **Layer 2 = Tier 1 = `self_serve_report`** — Render worker: conditional upstream re-runs → decision → paid self-serve report.
- **Layer 3 / Tier 2 — post-report FIDReC handoff + specialist commerce.** Same surface after the Tier-1 report. Contact form: user enters age + employment status + two FIDReC-qualification checkboxes + optional message; server snapshots `amount_lost_sgd` + `financial_institution` from the latest extract; one `upsert` into contact-requests storage + email to Dance. No edge function on the contact path. The root-layout WhatsApp `wa.me` link remains available on every route, and Slice 8 adds SGD 99 / SGD 800 specialist add-ons on this surface.

---

## Table of contents

1. [Conventions used in every diagram](#1-conventions-used-in-every-diagram)
2. [Master sequence (all four layers end-to-end)](#2-master-sequence-all-four-layers-end-to-end)
3. [Diagram 1 — Layer 1 (Tier 0, free): intake → gap loop → evidence loop → Tier-0 draft](#3-diagram-1--layer-1-tier-0-free-intake--gap-loop--evidence-loop--tier-0-draft)
4. [Diagram 2 — Layer 1 → Layer 2 transition: eligibility gate → Stripe checkout → entitlement upgrade → background-job enqueue](#4-diagram-2--layer-1--layer-2-transition-eligibility-gate--stripe-checkout--entitlement-upgrade--background-job-enqueue)
5. [Diagram 3 — Layer 2 (Tier 1, paid report): S-decision-running → S-report-drafting → S-report-ready](#5-diagram-3--layer-2-tier-1-paid-report-s-decision-running--s-report-drafting--s-report-ready)
6. [Diagram 4 — Layer 3 / Tier 2: FIDReC handoff + specialist commerce](#6-diagram-4--layer-3--tier-2-fidrec-handoff--specialist-commerce)
7. [Per-node implementation checklist (cross-referenced to Integration Summary §9)](#7-per-node-implementation-checklist-cross-referenced-to-integration-summary-9)
8. [Error states and retry rules](#8-error-states-and-retry-rules)
9. [Verification checklist before shipping the State Machine code](#9-verification-checklist-before-shipping-the-state-machine-code)

---

## 1. Conventions used in every diagram

### 1.1 Node types

| Style | Meaning |
|---|---|
| **Regular state** (`S-name`) | A screen or UI state the user can observe. |
| **Pending / loading state** (`S-name-pending`) | A transient state with a loading spinner or progress UI. |
| **Background-only state** (`bg-name`) | Work happening on the server; no UI state on the user's side. |
| **Terminal state** (filled) | End of that layer's flow. User may return via a back-button / history. |
| **Composite state** | A state that contains sub-states (drawn as nested blocks in Mermaid). |

### 1.2 Transition label format

Every arrow in the diagrams uses this format:

```
trigger / action
```

- **Trigger** — what causes the transition. One of:
  - `click:<element>` — user action.
  - `POST <fn>:ok` / `POST <fn>:err` — edge function response.
  - `rt:<table>:<event>` — Supabase Realtime event on a table.
  - `rpc:<name>:ok` — Postgres RPC response.
  - `timer:<ms>` — timeout.
- **Action** — what the frontend does in response, abbreviated. Full rule lives in §7.

### 1.3 Rules that apply to every diagram

These come directly from the Integration Summary and are **non-negotiable** for every arrow:

| # | Rule | Source |
|---|---|---|
| R1 | **Every edge-function call is 3-hop:** `browser → Next.js /api/edge/<fn> → Supabase edge function`. Never draw a 2-hop arrow. | IS §8.1 gotcha 2; IS §9.2 |
| R2 | **Every edge-function name is imported from `lib/edge-functions.ts`.** Never inline strings. The file now exports exactly **five** frontend-invoked constants — `EVIDENCE_FN`, `EXTRACT_FN`, `TIER0_FN`, `DECISION_FN`, `REPORT_FN` — plus audit-only guards for legacy / archived / fallback-only functions. | IS §8.1 gotcha 5; IS §9.1 |
| R3 | **Only `run_case_extract_v4`** (no `v1`/`v2`/`v3` — all archived 2026-04-21). v4's internal version string reads `v3.2555…`; the folder name is the contract. | IS §8.1 gotcha 5; reconciliation doc §2 |
| R4 | **`force` flag is never exposed in MVP UI.** Every re-run is "natural" (input changed → we call without `force`). | IS §8.1 gotcha 7; IS §9.8 |
| R5 | **Validation reads are two-step via `get_case_eligibility.resolved_ids`.** Never query `v_latest_validation` or `case_validation_runs` by `case_id`. Validation rows are populated by a **Postgres trigger on `case_extract_runs`** invoking **`run_validation_v1`** — not a separate edge-function call. **`case_validation_runs` stays the parent state row** (`status`, `missing_fields`, `questions_to_user`, `error_message`). **Gap UI prefers `v_case_validation_gap_items`** for the same `validation_run_id`, ordered by `sort_order`, normalized into the UI question shape; fallback to parent `questions_to_user` only when the view returns no rows. If `status = 'error'`, show `error_message` and block Tier-0 auto-fire. | IS §4.5, §8.1 gotcha 6; IS §9.4; reconciliation doc §0.3 Q2 |
| R6 | **Tier-0 panels are render-whatever-exists** — never block on a specific row count. | IS §8.1 gotcha 1; IS §9.5 |
| R7 | **Evidence upload MIME whitelist: PDF, PNG, JPEG, DOCX.** Reject everything else client-side before Storage. | IS §8.1 gotcha 4; IS §9.6 |
| R8 | **`case_documents.processing_status` transitions are driven by Supabase Realtime**, not polling. | IS §8.2 decision A; IS §9.3 |
| R9 | **Decision runs in Layer 2 only**, on the **Render background worker**, after the Stripe webhook enqueues a `jobs` row. Webhook returns `200` in <1 second and does NOT call `run_case_decision_v1` / `run_report_selfserve_v1` directly. The Tier-0 narrative (`bright-function`) does NOT depend on a decision run — this was explicitly confirmed in the 2026-04-21 PM reconciliation. | IS §8.2 decision B; IS §9.7; IS §10.3; reconciliation doc §0.3 Q1 |
| R10 | **Tier-0 narrative (`bright-function`) fires once**, after the gap loop has no blocking missing fields AND ≥1 document is `ready`, AND after one final freshness-check pass of `run_case_extract_v4`. User may also re-trigger via "Refresh draft" from `S1-Tier0Draft`. | IS §8.2 decision C; reconciliation doc §0.1 |
| R11 | **Extract auto-re-fires in Tier-0** after (a) initial intake is complete, (b) every gap-question answer, (c) every successful `evidence_processed_v2` that produces a `case_documents.processing_status='ready'`, and (d) once as a freshness-check pass right before `bright-function`. | IS §8.2 decision D; reconciliation doc §0.1 |
| R12 | **Layer 3 / Tier 2 contact path has no edge-function calls.** The post-report surface includes the human-in-the-loop FIDReC form, specialist recommendation copy, the persistent root-layout WhatsApp `wa.me` link, and Slice 8 specialist add-ons. **User-entered form fields:** first name, last name, email, phone, **age** (integer), **employment status** (`professional` / `retiree` / `student` / `other`), two FIDReC-qualification checkboxes (**>= 30 days since last FI reply?**, **FI issued final response?**), optional message. **Auto-captured server-side, never trusted from the client:** `user_id` (column `DEFAULT auth.uid()`), `case_id` (validated via RLS-scoped ownership probe), `amount_lost_sgd` + `financial_institution` (snapshotted from the latest `case_extract_runs` row at insert time). One `upsert` (UNIQUE on `user_id + case_id`) into the contact-requests storage table via `/api/contact-requests`, plus one notification email to Dance. WhatsApp is third-party only and R13-safe on public pages. Slice 8 paid add-ons use Stripe checkout/webhook routes, not Supabase edge functions. **Deprecated:** LinkedIn CTAs, generic "coming soon" waitlist framing, and the old 4-field minimal form. | IS §8.1 gotcha 3; IS §9.9, §10.5, §10.6; reconciliation doc §0.4 |
| R13 | **Pre-login narrative capture is client-side only.** The public landing page writes the hero-prompt narrative + transcript to `sessionStorage` (and to Clerk `unsafeMetadata` once the user clicks into the Clerk sign-up widget). **No Supabase write happens before Clerk auth succeeds** — Slice 0 Pattern C stays intact. On the first authenticated request post-login, the client sends the stored narrative in the body of `POST /api/cases/bootstrap`, which the server route materialises into `cases` + `case_intake` via `createUserClient()` (RLS `WITH CHECK (user_id = auth.uid())` fills `user_id` automatically). The client then clears `sessionStorage`. | reconciliation doc §0.3 Q5 (Dance answer C, revised after Pattern C cross-check); runbooks/slice-0-auth-reconciliation.md §3.4 |
| R14 | **Tier-1 upstream re-runs are conditional.** The Render worker, after picking up the `jobs` row queued by the Stripe webhook, re-runs `evidence_processed_v2` per new `case_documents` row only if the user uploaded more evidence on the Tier-1 upgrade screen, and re-runs `run_case_extract_v4` only if (a) narrative was edited OR (b) any evidence was re-processed. If nothing changed, both are skipped and the worker proceeds directly to `run_case_decision_v1` then `run_report_selfserve_v1`. | reconciliation doc §0.3 Q8 |

---

## 2. Master sequence (all four layers end-to-end)

This is the one-page overview. The four detailed diagrams after this are zooms into each layer.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant FE as Frontend (Next.js)
    participant SR as Next.js server route /api/edge/*
    participant CK as Clerk
    participant SB as Supabase (DB + Edge Fn + Realtime)
    participant ST as Stripe
    participant BG as Render background worker

    rect rgb(235, 230, 245)
        note over U,SB: Pre-login (public landing, CLIENT-SIDE ONLY — R13)
        U->>FE: Type / voice-record story in hero prompt
        FE->>FE: Persist {narrative, transcript} to sessionStorage (no Supabase write)
        U->>FE: Click "Get my free report"
        FE->>CK: Open Clerk sign-up widget (narrative copied to unsafeMetadata)
        U->>CK: Complete sign-up / sign-in
        CK-->>FE: Clerk session + JWT (supabase template)
        note over SB: handle_new_user() trigger auto-inserts auth.users + profiles with same UUID
    end

    rect rgb(230, 245, 220)
        note over U,SB: Layer 1 — Tier 0 (FREE) — 3 functions
        FE->>SR: POST /api/cases/bootstrap {narrative, transcript} (reads sessionStorage)
        SR->>SB: createUserClient → INSERT cases + case_intake (RLS fills user_id = auth.uid())
        SR-->>FE: 200 + caseId
        FE->>FE: Clear sessionStorage
        U->>FE: Upload document on evidence screen
        FE->>SR: POST /api/evidence/upload — Storage + INSERT case_documents [§4.2]
        SR->>SB: createUserClient upload + insert pending row
        SR-->>FE: 200 + caseDocumentId
        FE->>SR: POST /api/edge/evidence {document_id} — FUNCTION 1
        SR->>SB: POST /functions/v1/evidence_processed_v2
        SB-->>SR: 200
        SB-->>FE: Realtime: case_documents status updates → ready
        note over FE: After ≥ minimum intake AND doc ready, fire extract (R11)
        FE->>SR: POST /api/edge/extract {case_id} — FUNCTION 2
        SR->>SB: POST /functions/v1/run_case_extract_v4
        SB-->>SR: 200 + extract_run.id (Postgres trigger populates validation — R5)
        SR-->>FE: 200
        FE->>SB: rpc get_case_eligibility → two-step read of extract + validation
        U->>FE: Answer gap question (loop)
        FE->>SB: INSERT case_intake (gap_response)
        FE->>SR: POST /api/edge/extract (re-run, still FUNCTION 2)
        note over FE: Loop gap / upload until missing_fields = [] AND ≥1 doc ready (R10)
        FE->>SR: POST /api/edge/extract (freshness-check pass, still FUNCTION 2)
        FE->>SR: POST /api/edge/tier0 {case_id} — FUNCTION 3 (fires once)
        SR->>SB: POST /functions/v1/bright-function
        SB-->>SR: 200
        SR-->>FE: 200
        FE->>SB: Read case_narratives (render-whatever-exists — R6)
    end

    rect rgb(220, 235, 250)
        note over U,BG: Layer 1 → Layer 2 transition
        FE->>SB: rpc get_case_eligibility
        SB-->>FE: eligible_actions.run_report_selfserve = true
        U->>FE: Click "Buy full report"
        FE->>ST: Redirect to Stripe Checkout
        U->>ST: Pay
        ST->>SR: Webhook POST /api/stripe/webhook
        SR->>SB: UPSERT case_entitlements plan='self_serve_report' + INSERT jobs (atomic)
        SR-->>ST: 200 OK (<1s)
        note over FE: User returned to /checkout/success → navigates to Layer 2 screen
        U->>FE: (optional) Add more documents / edit narrative on Tier-1 upgrade screen
    end

    rect rgb(250, 240, 215)
        note over U,BG: Layer 2 — Tier 1 (PAID) — 2 functions + conditional re-runs (R14)
        BG->>SB: Poll jobs WHERE status='queued' FOR UPDATE SKIP LOCKED
        note over BG: IF new docs since last decision → loop evidence (R14)
        BG->>SR: POST /api/edge/evidence (per new doc)
        SR->>SB: POST /functions/v1/evidence_processed_v2
        note over BG: IF narrative edited OR any evidence reprocessed → one extract
        BG->>SR: POST /api/edge/extract {case_id}
        SR->>SB: POST /functions/v1/run_case_extract_v4
        BG->>SR: POST /api/edge/decision {case_id} — FUNCTION 4
        SR->>SB: POST /functions/v1/run_case_decision_v1
        SB-->>SR: 200 + decision_run_id
        SB-->>FE: Realtime: case_decision_runs INSERT → advance to L2-ReportDrafting
        BG->>SR: POST /api/edge/report {case_id} — FUNCTION 5
        SR->>SB: POST /functions/v1/run_report_selfserve_v1 (+simulation_key)
        SB-->>SR: 200 + report_json
        SB-->>FE: Realtime: reports INSERT (status=COMPLETED) → advance to L2-ReportReady
        FE->>U: Render report
    end

    rect rgb(245, 225, 240)
        note over U,SB: Layer 3 / Tier 2 — FIDReC handoff form + specialist commerce (contact path has no edge function, R12)
        U->>FE: Click "Need help escalating to FIDReC? → Get help from a specialist" on L2-ReportReady
        FE->>U: Render form (identity auto-filled from Clerk; age + employment + two FIDReC-qualification checkboxes; amount lost + FI shown read-only)
        U->>FE: Enter age, employment status, check 30-day + final-response booleans, optional message, submit
        FE->>SR: POST /api/contact-requests (NO user_id / amount / FI in body)
        SR->>SB: RLS ownership probe on cases + snapshot read of latest case_extract_runs
        SR->>SB: upsert into contact-requests storage table (UNIQUE on user_id+case_id) with snapshot + form fields
        SR->>SR: Send notification email to Dance (failure logged, does not fail request)
        SR-->>FE: 201 { ok: true, id }
        FE->>U: "Thanks — we'll be in touch within 1–2 business days to help you prepare your FIDReC submission"
    end
```

---

## 3. Diagram 1 — Layer 1 (Tier 0, free): bootstrap → evidence → extract + gap loop → Tier-0 narrative

Layer 1 now has **five sub-phases** in the Masha-confirmed canonical sequence:
- **S1-Bootstrap** — first authenticated request post-login materialises the `cases` + `case_intake` rows from the sessionStorage narrative (R13).
- **S1-EvidenceFirstUpload** — user is prompted to upload at least one document. Each upload → `evidence_processed_v2` (R1, R7, R8). **Canonical step 1.**
- **S1-GapLoop** — once minimum intake is present AND ≥1 doc is `ready`, `run_case_extract_v4` fires for the first time; UI enters the gap loop. Each answer / new upload re-fires extract (R11). **Canonical step 2 (fires multiple times).**
- **S1-FreshnessCheck** — final freshness-check extract pass right before tier-0 narrative (R10, R11 clause d).
- **S1-Tier0DraftPending** → **S1-Tier0Draft** — `bright-function` fires once, writes `case_narratives`, rendered per R6. **Canonical step 3.**

```mermaid
stateDiagram-v2
    direction TB
    [*] --> S1_Bootstrap

    state "S1-Bootstrap\n(POST /api/cases/bootstrap from sessionStorage — R13)" as S1_Bootstrap
    state "S1-EvidenceFirstUpload\n(\"Upload at least one supporting document\")" as S1_EvidenceFirstUpload
    state "S1-GapLoop\n(gap questions + evidence panel; extract re-fires on each input change)" as S1_GapLoop {
        [*] --> GL_Idle
        state "GL-Idle\n(questions rendered, awaiting user)" as GL_Idle
        state "GL-AnsweringGap\n(user typing/choosing)" as GL_AnsweringGap
        state "GL-Submitting\n(spinner on Save → POST /api/edge/extract)" as GL_Submitting
        state "GL-Uploading\n(per-doc progress bars → storage upload)" as GL_Uploading
        state "GL-Processing\n(per-doc Realtime status → evidence_processed_v2)" as GL_Processing

        GL_Idle --> GL_AnsweringGap: click:gap_input
        GL_AnsweringGap --> GL_Submitting: click:save_answer
        GL_Submitting --> GL_Idle: POST /api/edge/extract:ok
        GL_Submitting --> GL_AnsweringGap: POST /api/edge/extract:err

        GL_Idle --> GL_Uploading: click:upload_docs
        GL_Uploading --> GL_Processing: storage_upload:ok + INSERT case_documents
        GL_Processing --> GL_Idle: rt:case_documents:status=ready\n(auto-chain POST /api/edge/extract per R11)
        GL_Processing --> GL_Idle: rt:case_documents:status=failed\n(show retry CTA per R8)
    }
    state "S1-FreshnessCheck\n(final POST /api/edge/extract — R11 clause d)" as S1_FreshnessCheck
    state "S1-Tier0DraftPending\n(spinner: \"Preparing your free draft\")" as S1_Tier0Pending
    state "S1-Tier0Draft\n(free draft screen: summary + checklist + minimal SRF signal)" as S1_Tier0Draft

    S1_Bootstrap --> S1_EvidenceFirstUpload: POST /api/cases/bootstrap:ok\n(caseId returned; sessionStorage cleared)

    S1_EvidenceFirstUpload --> S1_EvidenceFirstUpload: upload → POST /api/edge/evidence\n(evidence_processed_v2 per doc)
    S1_EvidenceFirstUpload --> S1_GapLoop: rt:case_documents:status=ready\n(≥1 doc ready AND minimum intake present → first POST /api/edge/extract)

    S1_GapLoop --> S1_FreshnessCheck: click:generate_draft OR auto-trigger\n(missing_fields=[] per R10)
    S1_FreshnessCheck --> S1_Tier0Pending: POST /api/edge/extract:ok
    S1_FreshnessCheck --> S1_GapLoop: POST /api/edge/extract:err

    S1_Tier0Pending --> S1_Tier0Draft: POST /api/edge/tier0:ok\n(read case_narratives per R6)
    S1_Tier0Pending --> S1_GapLoop: POST /api/edge/tier0:err

    S1_Tier0Draft --> S1_FreshnessCheck: click:refresh_draft\n(freshness-check extract, then re-POST /api/edge/tier0)
    S1_Tier0Draft --> S1_GapLoop: click:back_to_evidence\n(user wants to add more data)
    S1_Tier0Draft --> [*]: navigate to Layer 1→2 transition\n(see Diagram 2)
```

### Layer 1 — per-state contracts

| State | What the user sees | What is running | Reads | Writes |
|---|---|---|---|---|
| **S1-Bootstrap** | Brief post-Clerk-login splash: *"Setting up your case…"* (≤1 s). | Client reads `sessionStorage` / `unsafeMetadata` → `POST /api/cases/bootstrap` which uses `createUserClient()`. | `sessionStorage` (`gb.narrative`, `gb.transcript`). | `INSERT cases` + `INSERT case_intake (intake_type='initial')` via user-scoped client; RLS `WITH CHECK` fills `user_id = auth.uid()`. |
| **S1-EvidenceFirstUpload** | Upload prompt with MIME whitelist copy (R7). Each upload shows a processing chip. No gap questions yet — the form waits for the first document to come back `ready`. | Realtime channel open on `case_documents` filtered by `case_id`. **`POST /api/evidence/upload`** (Storage + INSERT `case_documents` per IS §4.2 — no DB auto-insert from storage), then server route `POST /api/edge/evidence` per file (`evidence_processed_v2`). | `case_documents_enriched` for per-doc verification + extractions. | Edge function writes `case_documents_content`, `case_document_verifications`, `case_document_chunks`, `case_document_extractions`; app owns the `case_documents` metadata row. |
| **S1-GapLoop** | Two-column UI: left = gap questions, right = evidence upload. Entered after first doc is ready + minimum intake present; at that moment the frontend fires the **first** `POST /api/edge/extract`. | Same Realtime + extract auto-chain. | Two-step read (R5): `rpc get_case_eligibility` → `case_extract_runs` + parent `case_validation_runs` by PK. Preferred question source: **`v_case_validation_gap_items`** by `validation_run_id`, `ORDER BY sort_order, created_at`, normalized to `ValidationQuestion`; fallback to parent `questions_to_user` only when no gap rows exist. If parent `status = 'error'`, show `error_message`. | On gap answer: `INSERT case_intake (intake_type='gap_response')` / response row, then re-run extract. |
| **GL-Submitting** | Save button spinner. | POST `/api/edge/extract`. | — | Edge function appends `case_extract_runs`; trigger runs `run_validation_v1` → `case_validation_runs` + `case_validation_gap_items`. |
| **GL-Processing** | Per-doc progress: `pending → parsing → verifying → chunking → extracting → ready/failed`. | Realtime subscription drives transitions (R8). Server route auto-chains `/api/edge/extract` on `status=ready` (R11 clause c). | `case_documents_enriched` view. | App created the `case_documents` row on upload; edge function updates statuses and writes `case_documents_content`, verifications, chunks, extractions. |
| **S1-FreshnessCheck** | Still on gap-loop screen with a muted "Finalising extract…" indicator. | One final `POST /api/edge/extract` (canonical step 2 clause d — freshness pass). | — | Another `case_extract_runs` row (append-only per R4). |
| **S1-Tier0DraftPending** | Full-screen spinner. Copy: *"Preparing your free draft — up to 15 seconds."* | POST `/api/edge/tier0` (canonical step 3 — `bright-function`, fires once — R10). | — | Edge function upserts `case_narratives` rows. |
| **S1-Tier0Draft** | Free draft screen with three optional panels per R6 (IS §9.5): `tier0_summary`, `tier0_evidence_checklist`, `tier0_srf_signal` (the last is now a **minimal** signal per Masha's 2026-04-21 confirmation — it only reports `bank_path_relevant`, `telco_path_relevant`, and FIDReC eligibility flags; no SRF duties analysis). | Idle. | `SELECT narrative_type, title, text_content, created_at FROM case_narratives WHERE case_id = :id`. | — |

### Layer 1 — binding rules reminder

- R1–R11 and R13 all apply in Layer 1. R9, R12, R14 do not (those are Layer 2 / Layer 3).
- `force: true` is NEVER sent to `run_case_extract_v4` or `bright-function` from Layer 1 (R4).
- Validation rows are written by a **Postgres trigger on `case_extract_runs`**, not by a separate edge-function call (R5).
- `bright-function` fires **once** per Tier-0 draft (R10). Re-firing on "Refresh draft" re-enters `S1-FreshnessCheck` first so the narrative always runs against the latest extract.

---

## 4. Diagram 2 — Layer 1 → Layer 2 transition: eligibility gate → Stripe checkout → entitlement upgrade → background-job enqueue

This is the shortest diagram but the most subtle, because it spans three systems (frontend, Stripe, Render worker) and most of it happens with the user watching a loading screen.

```mermaid
stateDiagram-v2
    direction TB
    [*] --> T_EligibilityGate

    state "T-EligibilityGate\n(check if user can buy report)" as T_EligibilityGate
    state "T-BuyReportCTA\n(show \"Buy full report\" button on Tier-0 screen)" as T_BuyReportCTA
    state "T-BlockedOnPrereq\n(show \"Add N more documents\" nudge)" as T_BlockedOnPrereq
    state "T-CheckoutRedirect\n(briefly showing \"Redirecting to Stripe…\")" as T_CheckoutRedirect
    state "T-StripeCheckout\n(Stripe-hosted page; user pays)" as T_StripeCheckout
    state "T-PaymentSuccessLanding\n(return URL, before webhook lands)" as T_PaymentSuccessLanding
    state "T-PaymentCancelled" as T_PaymentCancelled

    T_EligibilityGate --> T_BuyReportCTA: rpc:get_case_eligibility:ok\n(eligible_actions.run_report_selfserve == true)
    T_EligibilityGate --> T_BlockedOnPrereq: rpc:get_case_eligibility:ok\n(eligible_actions.run_report_selfserve == false)
    T_BlockedOnPrereq --> T_EligibilityGate: click:retry\n(after user adds the missing piece)
    T_BuyReportCTA --> T_CheckoutRedirect: click:buy_report
    T_CheckoutRedirect --> T_StripeCheckout: Stripe Checkout session created
    T_StripeCheckout --> T_PaymentSuccessLanding: Stripe redirects to /checkout/success?case_id=…
    T_StripeCheckout --> T_PaymentCancelled: Stripe redirects to /checkout/cancel?case_id=…
    T_PaymentCancelled --> T_BuyReportCTA: click:try_again

    T_PaymentSuccessLanding --> [*]: navigate to Layer 2 Diagram 3\n(L2-UpgradeScreen)

    note right of T_PaymentSuccessLanding
        Webhook lands in parallel (server-side, invisible to user).
        On webhook: UPDATE case_entitlements + INSERT jobs row.
        Webhook returns 200 in <1s (R9).
        Frontend does NOT wait for webhook to redirect —
        it uses Stripe's return URL, then relies on
        Realtime on case_decision_runs/reports (Diagram 3).
    end note
```

### Layer 1 → Layer 2 transition — per-state contracts

| State | What the user sees | What is running | Reads | Writes |
|---|---|---|---|---|
| **T-EligibilityGate** | Still on Tier-0 draft screen; single `supabase.rpc` call in background. | Frontend calls `supabase.rpc('get_case_eligibility', { p_case_id })`. | RPC `get_case_eligibility` → `eligible_actions.run_report_selfserve`, `prerequisites.*`. | — |
| **T-BuyReportCTA** | "Buy full report — SGD $XX" CTA above the free draft. | Idle. | — | — |
| **T-BlockedOnPrereq** | Nudge card explaining what's missing (e.g. *"Add at least one supporting document"*). | Idle. | Same eligibility response (use `prerequisites` to drive the copy). | — |
| **T-CheckoutRedirect** | Full-screen *"Redirecting to secure payment…"* for 300–1000 ms. | POST to `/api/stripe/create-checkout-session` (Next.js route) with `case_id` + `user_id` in metadata → returns Stripe-hosted URL → `window.location` redirect. | — | (internal) Stripe creates a Session. |
| **T-StripeCheckout** | Stripe-hosted page. Not our UI. | Nothing on our side. | — | — |
| **T-PaymentSuccessLanding** | `/app/case/[id]/checkout/success` — brief *"Payment received, setting things up…"* screen while it redirects to the Layer 2 report view. | Frontend navigates to `/app/case/[id]/report`. | — | — |
| **T-PaymentCancelled** | `/app/case/[id]/checkout/cancel` with a retry CTA. | Idle. | — | — |
| **bg-webhook** *(not shown in diagram; runs on server only)* | — | Webhook route: (1) verify Stripe signature, (2) `UPSERT case_entitlements plan='self_serve_report'`, (3) `INSERT jobs (job_type='post_payment_report_generation', case_id, user_id, status='queued')`, (4) return `200` in <1s (R9, §9.7). | — | `case_entitlements` + `jobs`. |

### Layer 1 → Layer 2 — binding rules reminder

- R9 (background job) is critical. The webhook handler must NOT call `run_case_decision_v1` or `run_report_selfserve_v1` itself — it only enqueues.
- The user's transition to Layer 2 is driven by **Stripe's return URL**, not by the webhook. This means the user may land on the Layer 2 report screen **before** the webhook has finished. That is fine because Layer 2's first state (S-decision-running) is itself a waiting state driven by Realtime.

---

## 5. Diagram 3 — Layer 2 (Tier 1, paid report): upgrade → conditional re-runs → decision → report

Layer 2 has an optional **upgrade screen** that lets the user add more evidence or edit their narrative before the Render worker picks up the queued job. The worker then runs conditional upstream re-runs (R14) before the two canonical Tier-1 functions.

```mermaid
stateDiagram-v2
    direction TB
    [*] --> L2_UpgradeScreen

    state "L2-UpgradeScreen\n(\"Before we generate your report, add anything we missed\")" as L2_UpgradeScreen
    state "L2-UpstreamReRun\n(\"Re-processing your latest evidence…\")" as L2_UpstreamReRun
    state "L2-DecisionRunning\n(\"Analysing your case…\")" as L2_DecisionRunning
    state "L2-ReportDrafting\n(\"Drafting your report…\")" as L2_ReportDrafting
    state "L2-ReportReady\n(full report rendered)" as L2_ReportReady
    state "L2-ReportFailed\n(\"Something went wrong, please contact support\")" as L2_ReportFailed

    L2_UpgradeScreen --> L2_UpstreamReRun: click:generate_report\n(IF new docs OR narrative edited — R14)
    L2_UpgradeScreen --> L2_DecisionRunning: click:generate_report\n(ELSE skip upstream re-runs — R14)
    L2_UpstreamReRun --> L2_DecisionRunning: worker: evidence + extract done

    L2_DecisionRunning --> L2_ReportDrafting: rt:case_decision_runs:INSERT\n(row for this case_id appears)
    L2_DecisionRunning --> L2_ReportFailed: timer:120s\n(no decision row within 2 min)

    L2_ReportDrafting --> L2_ReportReady: rt:reports:INSERT\n(status='COMPLETED' row appears)
    L2_ReportDrafting --> L2_ReportFailed: timer:120s\n(no report row within 2 min of decision)

    L2_ReportReady --> [*]: (terminal within Layer 2; entry point to L3)
    L2_ReportFailed --> [*]: click:contact_support
```

### Layer 2 — per-state contracts

| State | What the user sees | What is running | Reads | Writes |
|---|---|---|---|---|
| **L2-UpgradeScreen** | *"Your payment was received. Before we generate your full report, you can upload any additional documents or edit your narrative."* UI mirrors the Tier-0 evidence/intake panels but with a prominent "Generate my report →" CTA. | Idle; Realtime channel open on `case_documents`. | Same reads as Layer 1. | Same writes as Layer 1 (new `case_documents`, narrative edits via `case_intake`). No edge function fires from this screen — all re-processing is deferred to the worker (R9). |
| **L2-UpstreamReRun** | Progress UI: *"Re-processing your latest evidence…"*. Only entered when R14 conditions are met. | Render worker runs `evidence_processed_v2` per new `case_documents` row, then one `run_case_extract_v4` call. | — | — |
| **L2-DecisionRunning** | Progress UI: *"Analysing your case against Singapore regulations and prior decisions…"* + soft progress animation. | Realtime subscription on `case_decision_runs` filtered `case_id=eq.<id>`. Render worker is calling `/api/edge/decision` (canonical step 4). | — | — |
| **L2-ReportDrafting** | Progress UI: *"Drafting your complaint report — up to 30 seconds."* | Realtime subscription on `reports` filtered `case_id=eq.<id>` AND `status=eq.COMPLETED`. Render worker is calling `/api/edge/report` (canonical step 5). | — | — |
| **L2-ReportReady** | Full report UI: title, executive summary, timeline, disputed transactions (capped 5), totals, responsibility points, requested resolution, evidence checklist, disclaimers, limitations, missing facts. **Plus** a bottom CTA: *"Need help submitting to FIDReC? Contact us →"* which navigates to Diagram 4. | Idle. | `SELECT * FROM reports WHERE case_id = :id ORDER BY created_at DESC LIMIT 1` (IS §8.1 gotcha 7 — always show latest). Optionally also show decision summary from `case_decision_runs` (latest row or via `get_latest_decision_run(:case_id)`). | — |
| **L2-ReportFailed** | Error card: *"We hit a snag generating your report. Your payment is safe — we've been alerted."* + contact-support CTA. | Idle. | — | — (backend alerting via `jobs.last_error` — out of scope for the diagram). |

### Layer 2 — binding rules reminder

- R9 (background job writes both `case_decision_runs` and `reports`). The frontend never calls `/api/edge/decision` or `/api/edge/report` directly from Layer 2 — only the Render worker calls them.
- R14 — the worker's upstream re-runs (`evidence_processed_v2` per new doc, `run_case_extract_v4` once) are **conditional** on the user adding evidence or editing the narrative on `L2-UpgradeScreen`. If they skip the upgrade step entirely, both are skipped and the worker proceeds straight to canonical step 4.
- R4 — `force: true` is NOT sent from the MVP UI. Even the "regenerate report" button, if added later, would refuse `force` at the UI level and require an admin-only path.
- IS §8.1 gotcha 7 — the report view always shows the **latest** `reports` row (`ORDER BY created_at DESC LIMIT 1`).

### Layer 2 — post-MVP audit trail marker

Per §8.1 gotcha 7 and §9.8: today, `run_case_decision_v1` with `force: true` **overwrites** the existing row. This is fine because MVP UI never sends `force`, but **track a Supabase backlog ticket**: *"Add audit-trail table (`case_decision_runs_history`) so overwrites preserve prior versions."*

---

## 6. Diagram 4 — Layer 3 / Tier 2: FIDReC handoff + specialist commerce

Post-report surface. The contact form path has no edge function calls. The human-in-the-loop form is shown **immediately after the Tier-1 report is generated** (entered via a CTA on `L2-ReportReady`: *"Need help escalating to FIDReC? → Get help from a specialist"*). It collects identity + age + employment status + two FIDReC-qualification checkboxes + optional message from the user; server-side snapshots `amount_lost_sgd` and `financial_institution` from the latest `case_extract_runs` row at insert time, so Dance's triage view always matches the number the user saw on their report (per IS §9.9). The same surface keeps the root-layout WhatsApp entry point and, after Slice 8, adds specialist consult / case-pack Stripe add-ons (IS §10.6).

```mermaid
stateDiagram-v2
    direction TB
    [*] --> L3_FormFilling

    state "L3-FormFilling\n(identity auto-filled from Clerk;\nuser enters age, employment status,\ntwo FIDReC-qualification checkboxes,\noptional message; amount lost + FI\nshown read-only above the form)" as L3_FormFilling
    state "L3-Submitting\n(spinner on Submit; server snapshots\namount_lost_sgd + financial_institution\nfrom latest case_extract_runs)" as L3_Submitting
    state "L3-Confirmed\n(\"Thanks \u2014 we'll be in touch within\n1\u20132 business days to help you prepare\nyour FIDReC submission.\")" as L3_Confirmed

    L3_FormFilling --> L3_Submitting: click:submit_contact_request
    L3_Submitting --> L3_Confirmed: POST /api/contact-requests:ok
    L3_Submitting --> L3_FormFilling: POST /api/contact-requests:err (Zod/RLS/500)
    L3_Confirmed --> [*]
```

### Layer 3 / Tier 2 — per-state contracts

| State | What the user sees | What is running | Reads | Writes |
|---|---|---|---|---|
| **L3-FormFilling** | Human-in-the-loop form plus specialist recommendation copy. **Auto-filled, editable:** first name, last name, email, phone (from Clerk user profile). **User-entered:** `age` (int 13–120), `employment_status` (radio: professional / retiree / student / other), `thirty_days_since_last_fi_reply` (checkbox Y/N), `fi_issued_final_response` (checkbox Y/N), optional `message` (≤ 500 chars). **Read-only context card** above the form showing the snapshot values Dance will see: financial institution, reported loss (SGD), case ID. Hidden: `case_id` is carried in the route context; `user_id` is never sent (column `DEFAULT auth.uid()`). Root-layout WhatsApp remains visible; Slice 8 adds SGD 99 / SGD 800 CTAs on this surface. | Idle. | Clerk user profile client-side; the snapshot values displayed in the read-only card are also read via a user-scoped Supabase query on `cases` + latest `case_extract_runs.extract_json`. | — |
| **L3-Submitting** | Submit spinner. | `POST /api/contact-requests` (Next.js server route — not an edge function). Route performs: (1) Clerk session check, (2) Zod body validation, (3) RLS-scoped ownership probe on `cases`, (4) latest-extract snapshot read for `amount_lost_sgd` + `financial_institution`, (5) `upsert` into the contact-requests storage table (UNIQUE on `user_id + case_id`), (6) notification email to Dance (failure logged, does not fail the request). | — | One `upsert` into the contact-requests storage table (schema in IS §10.5 — currently defined as `escalation_waitlist`; follow-up migration may rename to `contact_requests`). One email to Dance. |
| **L3-Confirmed** | Success card: *"Thanks — we'll be in touch within 1–2 business days to help you prepare your FIDReC submission."* | Idle. | — | — |

### Layer 3 / Tier 2 — binding rules reminder

- R12 — no edge function calls from the contact path. The server-side contact call is `/api/contact-requests` -> Supabase `upsert` + email.
- Keep the existing root-layout WhatsApp `wa.me` link available on every route. Do not add a duplicate global widget. On this Layer 3 / Tier 2 surface, include Scam and Fraud Specialist recommendation copy; Slice 8 adds SGD 99 / SGD 800 Stripe add-ons.
- No LinkedIn CTAs or generic "coming soon" waitlist framing.
- **The client never sends `user_id`, `amount_lost_sgd`, or `financial_institution`** — those are snapshotted server-side. Any POST body containing those fields must be rejected / ignored by the route (R12 audit guard).
- Re-submit upserts: if the user reopens the form (e.g. to flip `fi_issued_final_response` to `true` after receiving the FI's letter), the `UNIQUE (user_id, case_id)` constraint + `onConflict` clause overwrites the prior row.
- Age is stored as a plain integer for MVP. If PII sensitivity later pushes us to age buckets, add a generated column rather than changing the widget.

---

## 7. Per-node implementation checklist (cross-referenced to Integration Summary §9)

This is the TODO list the frontend engineer works through, one file/screen at a time. Each row maps directly to an Integration Summary section.

| # | Artefact to build | Integration Summary section | State Machine nodes it touches |
|---|---|---|---|
| 1 | `lib/edge-functions.ts` — single constants file exporting **five** frontend-invoked edge-function names (`EVIDENCE_FN`, `EXTRACT_FN`, `TIER0_FN`, `DECISION_FN`, `REPORT_FN`) plus audit-only guards for legacy / archived / fallback-only. | IS §9.1 | All edge-function arrows across all four diagrams. |
| 2 | `/api/cases/bootstrap/route.ts` — accepts `{ narrative, transcript }` in body, reads Clerk session, uses `createUserClient()` to `INSERT cases + case_intake (intake_type='initial')`. No service-role write. (R13, Slice 0 Pattern C.) | IS §9.2, §10.4; runbooks/slice-0-auth-reconciliation.md §3.4 | S1-Bootstrap. |
| 3 | `/api/edge/extract/route.ts` — Next.js server route: **Clerk session → Clerk-signed Supabase JWT → RLS-enforced 1-row case-ownership probe → service-role fetch to edge function.** No manual `owner_user_id` check (RLS handles it). See IS §9.2 reference implementation. | IS §9.2, §10.4 | S1-GapLoop (first fire + gap-answer re-fires), GL-Submitting, evidence auto-chain in GL-Processing, S1-FreshnessCheck. |
| 4 | `/api/edge/tier0/route.ts` — same Pattern C wrapper, for `bright-function`. Fires once. | IS §9.2 | S1-Tier0DraftPending. |
| 5 | `/api/edge/evidence/route.ts` — same Pattern C wrapper, for `evidence_processed_v2`. | IS §9.2 | S1-EvidenceFirstUpload, GL-Uploading → GL-Processing transition, L2-UpstreamReRun (called by Render worker). |
| 6 | `/api/edge/decision/route.ts` — same Pattern C wrapper, for `run_case_decision_v1` (**Layer 2 only**, called by Render worker). | IS §9.2 | L2-DecisionRunning. |
| 7 | `/api/edge/report/route.ts` — same Pattern C wrapper, for `run_report_selfserve_v1` (called by Render worker; also injects `simulation_key`). | IS §9.2 | L2-ReportDrafting. |
| 8 | `/api/stripe/webhook/route.ts` — verify signature, upgrade entitlement, enqueue job, return 200 in <1s. Webhook does NOT call decision/report directly (R9). | IS §9.7, §10.3 | bg-webhook (T-PaymentSuccessLanding). |
| 9 | `/api/stripe/create-checkout-session/route.ts` — creates Stripe Checkout Session with `case_id` + `user_id` in metadata. | — (standard Stripe pattern) | T-CheckoutRedirect. |
| 10 | `/api/contact-requests/route.ts` — auth + Zod validation + RLS ownership probe on `cases` + latest-extract snapshot read (`amount_lost_sgd` + `financial_institution`) + `upsert` into contact-requests storage table (UNIQUE on `user_id + case_id`) + notification email to Dance. Client body does NOT contain `user_id`, `amount_lost_sgd`, or `financial_institution` (R12 audit guard). | IS §9.9, §10.5 | L3-Submitting. |
| 11 | Landing-page hero client code — persist narrative/transcript to `sessionStorage` + Clerk `unsafeMetadata`; on first authenticated page load, read back and `POST /api/cases/bootstrap`. No anonymous Supabase rows (R13). | Reconciliation doc §0.3 Q5 answer C (revised) | Pre-layer → S1-Bootstrap. |
| 12 | Realtime subscription on `case_documents` filtered by `case_id`. | IS §9.3 | S1-EvidenceFirstUpload, GL-Processing, L2-UpgradeScreen, L2-UpstreamReRun. |
| 13 | Realtime subscription on `case_decision_runs` filtered by `case_id`. | IS §9.7 | L2-DecisionRunning → L2-ReportDrafting. |
| 14 | Realtime subscription on `reports` filtered by `case_id` and `status='COMPLETED'`. | IS §9.7 | L2-ReportDrafting → L2-ReportReady. |
| 15 | Two-step validation read helper (RPC + PK lookup). Validation is produced by Postgres (`run_validation_v1` from the `case_extract_runs` trigger — R5), not an edge function. Keep **`case_validation_runs`** as the parent state row; read preferred **`v_case_validation_gap_items`** by `validation_run_id`, `ORDER BY sort_order, created_at`, normalize rows to `ValidationQuestion`, and fallback to `questions_to_user` only when the view returns zero rows. | IS §4.5, §9.4; reconciliation doc §0.3 Q2 | S1-GapLoop entry and every extract re-run completion. |
| 16 | Tier-0 draft render-whatever-exists component. | IS §9.5 | S1-Tier0Draft. |
| 17 | Evidence upload component with MIME whitelist (PDF / PNG / JPEG / DOCX). | IS §9.6 | S1-EvidenceFirstUpload, GL-Uploading, L2-UpgradeScreen. |
| 18 | Render background worker (separate service in `render.yaml`) — implements the **conditional upstream re-run** logic per R14 before calling decision then report. | IS §9.7, §10.3 | Everything in Diagram 3 from L2-UpstreamReRun onwards. |
| 19 | `jobs` table migration. | IS §10.3 | bg-webhook writes, Render worker reads. |
| 20 | Contact-requests storage table migration — schema includes `age` (int CHECK 13..120), `employment_status` (text CHECK in `professional`/`retiree`/`student`/`other`), `thirty_days_since_last_fi_reply` (boolean NOT NULL), `fi_issued_final_response` (boolean NOT NULL), `amount_lost_sgd` (numeric, server-snapshot nullable), `financial_institution` (text, server-snapshot nullable), `message` (text optional), plus existing identity / ownership / status / notes columns per IS §10.5. Currently defined as `escalation_waitlist`; follow-up migration may rename to `contact_requests` for naming consistency with Dance's 2026-04-21 PM decision. | IS §10.5 | L3-Submitting. |
| 21 | Repo cleanup: **delete the folders `supabase/functions/run_case_extract_v{1,2,3}`**. Masha already archived them from Supabase on 2026-04-21; only the repo copies remain. | IS §8.1 gotcha 5; reconciliation doc §4 | None directly (protects R3). |
| 22 | Repo cleanup: **delete the folders `supabase/functions/gemini-task`, `supabase/functions/candidate-transactions`, `supabase/functions/compute-loss`** IF the code lives in this repo. These are archived / Masha-internal fallbacks and should not be called from the frontend. If they're Masha-only Supabase-hosted functions with no repo checkout, no action required. | Reconciliation doc §4 | None directly (protects R2 audit guards). |
| 23 | Masha backlog: **add audit-trail table** for `case_decision_runs` overwrites (post-MVP). | IS §9.8 | None yet (future-proofing). |
| 24 | Masha backlog: **extend `evidence_processed_v2` to handle DOCX natively** (if the verification in IS §10.2 fails). | IS §10.2 | Upload whitelist. |

---

## 8. Error states and retry rules

All error handling follows a consistent pattern so the State Machine doesn't need a separate error arrow for every state.

### 8.1 Edge-function errors (any `/api/edge/*`)

| Error | User-facing behaviour | Machine behaviour |
|---|---|---|
| 401 (Clerk session invalid) | Redirect to sign-in page. | Navigate out of the State Machine; resume on return. |
| 403 (RLS violation — case not owned by this user) | Show *"You don't have access to this case."* card. Surfaces as Postgres error `42501` from the user-scoped Supabase client in the server route (§9.2). | Terminal; user must start a new case. |
| 404 (case or prerequisite missing) | Show inline *"We couldn't find the case data — refreshing…"* and auto-retry once after 2s. The server route returns 404 when the ownership probe read returns zero rows. | If the retry also 404s, fall back to the previous state (e.g. decision → re-enter gap loop). |
| 500 (internal) | Show generic *"Something went wrong — please try again."* toast with retry button. | Stay in current state; on retry click, re-fire the same POST. |

### 8.2 Realtime disconnects

Supabase Realtime can drop a connection (network flap, tab backgrounded too long). Handle this at the subscription level:

- On `CHANNEL_ERROR` or `CLOSED`, attempt to reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s).
- **While disconnected, do not pretend the state is stuck.** After 15 seconds without reconnection, fall back to a single-shot read of the relevant table and continue the state machine based on what's there.
- For Layer 2 (Diagram 3) specifically, this fallback is critical because the user is staring at a progress screen: use Visibility API + Realtime reconnect events to trigger a fallback read on `case_decision_runs` and `reports` when the tab refocuses.

### 8.3 Stripe-specific errors

| Situation | Behaviour |
|---|---|
| Stripe Checkout closed without paying | Redirect to `/app/case/[id]/checkout/cancel`. Allow retry. |
| Webhook fails to verify signature | Webhook route returns 400. Stripe retries on its side. No user-facing UI (user never sees it). |
| Webhook signature verified but `case_entitlements` update fails | Webhook returns 500. Stripe retries. **Idempotency:** `case_entitlements` upgrade must be safe to repeat (use `UPSERT`). |
| Webhook verified + entitlement upgraded but `jobs` INSERT fails | Same as above — webhook returns 500, Stripe retries. **Do not commit the entitlement upgrade without also committing the `jobs` row.** Wrap in a single transaction in the webhook handler. |

### 8.4 Background-worker failures

The Render worker updates `jobs.status` to `failed` after exhausting retries (recommended: 3 attempts with exponential backoff). When `jobs.status = 'failed'` for the case, the frontend's Layer 2 diagram hits the `timer:120s` fallback and transitions to **L2-ReportFailed**.

---

## 9. Verification checklist before shipping the State Machine code

Run through this list once the code is written and before end-to-end testing:

- [ ] Every edge-function call in the codebase goes through `/api/edge/*` (R1). `grep -r 'functions/v1' app/` should return only matches inside `/api/edge/*/route.ts`.
- [ ] Every edge-function name is imported from `lib/edge-functions.ts` (R2). `grep -r 'run_case_extract\|bright-function\|evidence_processed\|run_case_decision\|run_report_selfserve' app/ lib/ services/ --include='*.ts' --include='*.tsx'` should only show matches in `lib/edge-functions.ts` and test files.
- [ ] No call site references `candidate-transactions`, `compute-loss`, or `gemini-task` from any production code path (R2 audit guard). `grep -r 'candidate-transactions\|compute-loss\|gemini-task' app/ lib/ services/ --include='*.ts' --include='*.tsx'` should only show matches in `lib/edge-functions.ts` (audit-only constants) and this doc.
- [ ] No code path in the frontend or server routes sets `force: true` for any function (R4).
- [ ] Validation reads use `get_case_eligibility` + PK lookup, not `v_latest_validation` by `case_id` (R5). Grep for `v_latest_validation` — should be zero hits in `app/` and `lib/`. No code path calls a "validation edge function" — validation is Postgres (`run_validation_v1`). Gap UI prefers `v_case_validation_gap_items` by `validation_run_id`, ordered by `sort_order`, and falls back to `questions_to_user` only when the view returns zero rows. `status = 'error'` surfaces `error_message` and blocks Tier-0 auto-fire. When using structured gaps, `case_validation_gap_items` row count aligns with `jsonb_array_length(missing_fields)` on the parent validation run unless status is `error` (§4.5).
- [ ] Tier-0 draft component does not conditionally render on a specific row count (R6). It renders each panel `if (narratives[type])` independently.
- [ ] Upload component rejects anything outside PDF / PNG / JPEG / DOCX at the file-picker step (R7).
- [ ] `case_documents` subscription is Realtime, not polling (R8). Grep for `setInterval.*case_documents` — should be zero hits.
- [ ] Stripe webhook handler does NOT call `/api/edge/decision` or `/api/edge/report` directly (R9). Those calls must come from the Render worker only. Decision does NOT run in Tier-0.
- [ ] `bright-function` fires **once** per Tier-0 draft (R10) — after parent validation `status !== 'error'`, `missing_fields.length === 0`, at least one `case_documents.processing_status === 'ready'`, and after the freshness-check extract pass.
- [ ] Every successful `evidence_processed_v2` server-route response triggers a follow-up call to `/api/edge/extract` (R11 clause c). Every gap-answer save triggers a follow-up call too (R11 clause b).
- [ ] Layer 3 / Tier 2 contact path contains zero calls to `/api/edge/*` (R12). `grep -r '/api/edge' app/\(.*\)layer3\|contact-requests` should return nothing for the form/contact route. Keep the root-layout WhatsApp `wa.me` link, confirm no duplicate global widget, confirm L3 specialist copy, and keep LinkedIn / generic coming-soon waitlist framing out.
- [ ] Landing-page hero code writes narrative/transcript to `sessionStorage` + Clerk `unsafeMetadata` only — no Supabase write (R13). `grep -r 'supabase\|createClient\|INSERT' <landing-hero-component>` should return zero hits on any pre-Clerk-login code path.
- [ ] `/api/cases/bootstrap` uses `createUserClient()` (not the service-role client) and has no fallback for anonymous callers (R13). `grep -r 'serviceRoleKey\|SUPABASE_SERVICE_ROLE_KEY' app/api/cases/bootstrap/` should return zero hits.
- [ ] Render worker implements R14's conditional gate: it queries `case_documents` for rows newer than the last decision run, queries `case_intake` for rows newer than the last decision run, and skips both `evidence_processed_v2` and `run_case_extract_v4` when neither returns anything.
- [ ] Error states at §8.1 are implemented for every `/api/edge/*` call site.
- [ ] Realtime reconnection logic at §8.2 is implemented.

---

## Appendix A — Glossary pointers

Any term not defined here is defined in the [Integration Summary §11 Glossary](./Front-to-Back-End-Integration-Summary.md#11-glossary-function-name--folder-name).

Short reminders:

- `bright-function` = deployed folder name of the Tier-0 narrative generator (§9.1).
- `url_catalogue` = deployed folder name of `decision_url_inbox` (admin only, not in this State Machine).

## Appendix B — Reviewer's walkthrough (end-to-end narrative for one test user)

> **Purpose.** A worked-example story that walks one invented user, **Priya Menon**, from signing up to downloading her paid report. Every paragraph names the state node it represents so someone new to the project can read this appendix alongside the diagrams and build a mental model in ~10 minutes. Where a database write, edge function, or RLS rule is triggered, it's called out inline. All IDs below are illustrative.
>
> **How to use this appendix.**
>
> - Engineers joining the frontend team: read this first, then open the diagrams. The node names here (`S1-Submitting`, `T-EligibilityGate`, etc.) are the exact IDs in §§3–6.
> - QA / product: use the timeline to build a first end-to-end test script.
> - Masha: the "backend side" column in each paragraph is a sanity-check on Edge Function and RPC contracts — if anything here disagrees with how `bright-function` or `run_report_selfserve_v1` actually behave, flag it.

### B.1 The user

Priya Menon, 42, Singapore resident. Three weeks ago she spotted a SGD 12,400 unauthorised transfer out of her DBS savings account to a Hong Kong beneficiary she doesn't recognise. DBS's initial response was unsatisfactory. A friend forwarded her a link to Guide Buoy AI.

### B.2 Signup (pre-State-Machine)

Priya lands on the marketing site, clicks **Sign up**, and goes through Clerk's sign-up flow using her Gmail. The moment she completes email verification:

- **Clerk** issues her a Clerk user ID (`user_2xYz…`) and a Clerk session cookie.
- **Supabase Third-Party Auth** consumes her Clerk JWT on her first authenticated Supabase request, creating `auth.users.id = 693567ab-1802-4a71-95ae-82e0aa597c53` (a UUID).
- The `handle_new_user()` trigger fires and inserts a matching row into `public.profiles` with the same UUID.
- This is **Pattern C** locked by Integration Summary §10.4. From this moment on, every RLS check on cases she later owns will compare `auth.uid()` to `cases.user_id` and return the same UUID.

No State Machine activity yet — she hasn't started a case.

### B.3 Layer 1 — Intake (S1-IntakeForm → S1-Submitting)

Priya clicks **Start my free case review**. The frontend navigates to `/app/case/new` and renders the intake form (**S1-IntakeForm**).

She fills:
- Narrative: *"On Sunday afternoon I noticed an SGD 12,400 transfer from my DBS savings to a Hong Kong beneficiary called 'Rising Star Trading'. I did not authorise this. I contacted DBS…"*
- Claim type: Unauthorised transaction
- Jurisdiction: Singapore
- Institution: DBS Bank
- Claim amount: 12400, SGD
- Incident date: 2026-03-29

She clicks **Submit**. The form transitions to **S1-Submitting** (spinner; copy *"Analysing your story…"*).

**What happens behind the curtain** (R1 — every edge-function call goes through a server route):
1. Browser `POST /api/edge/extract` with `{ narrative, claim_type, jurisdiction, institution_name, claim_amount, claim_currency, incident_date, /* case_id will be created */ }`.
2. Server route (`app/api/edge/extract/route.ts`, per §9.2):
   - Reads Clerk session → `userId = 'user_2xYz…'`, `token = getToken({ template: 'supabase' })`.
   - Creates a user-scoped Supabase client bound to that token.
   - Because this is the first call for a new case, the server route first `INSERT`s a row into `cases` using the user-scoped client. RLS policy *"Enable insert for users based on user_id"* (migration line 2564) lets it through because `user_id = auth.uid()`. Priya now has `cases.id = <new uuid>`, `cases.user_id = 693567ab-…`.
   - The server route then `POST`s to Supabase `functions/v1/run_case_extract_v4` with the service-role bearer, including the new `case_id`.
3. `run_case_extract_v4` writes a row to `case_extract_runs` (extract JSON) and `case_validation_runs` (gap questions — e.g. *"Was this transfer online or at a branch?"*, *"Have you filed a police report?"*).
4. Response returns to the browser with `extract_run_id` and `validation_run_id`. Total round-trip: ~2–3 seconds.

### B.4 Layer 1 — Gap loop + evidence upload (S1-GapLoop)

The UI transitions to **S1-GapLoop** — the two-column view: gap questions on the left (**GL-Idle**), evidence upload on the right.

**Gap questions load** via the two-step read (R5 — Integration Summary §9.4), with **`v_case_validation_gap_items`** as the preferred UI source (`validation_run_id`, `ORDER BY sort_order, created_at` — IS §4.5):
1. `supabase.rpc('get_case_eligibility', { p_case_id })` → response includes `resolved_ids.validation_run_id`.
2. `SELECT * FROM case_validation_runs WHERE id = <validation_run_id>` → returns parent validation state (`status`, `missing_fields`, `questions_to_user`, `error_message`).
3. `SELECT * FROM v_case_validation_gap_items WHERE validation_run_id = <validation_run_id> ORDER BY sort_order, created_at` → returns deterministic rows for the UI. The frontend normalizes `field_key` → `key`, `question_text` → `question`, `expected_answer_type` → `field_type`, and `answer_options` → `options`. If zero rows return, it normalizes parent `questions_to_user` as a legacy fallback.

Priya answers *"Was the transfer online?"* → **"Yes"**. This moves her into **GL-AnsweringGap** and then, on Save, into **GL-Submitting**. The server route calls `/api/edge/extract` again (R3 — `EXTRACT_FN` constant; note it's always `run_case_extract_v4`, never hardcoded). `case_intake` gets a new row with `intake_type='gap_response'`. The new extract run appends (R4 — re-runs always append for extract). Validation refreshes (`run_validation_v1` re-writes JSON + gap rows); another question appears: *"Do you have a statement showing the transfer?"*.

Meanwhile, in parallel, Priya drags-and-drops her DBS statement PDF onto the evidence panel (**GL-Uploading**). The uploader (R7 — §9.6 MIME whitelist):
- Accepts the PDF (MIME `application/pdf`).
- **`POST /api/evidence/upload`** → Supabase Storage + **`INSERT case_documents`** with `processing_status = 'pending'` (IS §4.2).
- Calls `POST /api/edge/evidence` to fire `evidence_processed_v2`.

The UI transitions the card to **GL-Processing**. A **Realtime subscription on `case_documents`** (R8 — §9.3) pushes live updates: `pending → parsing → verifying → chunking → extracting → ready`. Priya sees a progress bar animate over ~8 seconds, then a green *"Verified DBS statement — transfer confirmed"* chip.

On `status='ready'`, the frontend auto-fires another `/api/edge/extract` call (R11 — §8.1 gotcha 11: *"auto re-fire after evidence_processed_v2 success"*). Extract and validation refresh. Because the statement fills in the transfer reference and beneficiary fields, the next validation round returns `missing_fields = []` and `questions_to_user = []`. She's complete.

### B.5 Layer 1 — Tier-0 draft (S1-Tier0DraftPending → S1-Tier0Draft)

The frontend detects the guard condition (R10 — §8.1 gotcha 10): `missing_fields.length === 0` **and** at least one `case_documents` row with `processing_status = 'ready'`. It automatically fires `POST /api/edge/tier0` (wrapping `bright-function`). The UI transitions to **S1-Tier0DraftPending** — full-screen spinner, *"Preparing your free draft — up to 15 seconds."*

`bright-function` runs internally for ~10 s and writes three rows into `case_narratives`:
- `narrative_type = 'tier0_summary'`
- `narrative_type = 'tier0_evidence_checklist'`
- `narrative_type = 'tier0_srf_signal'`

The frontend does a `SELECT * FROM case_narratives WHERE case_id = :id ORDER BY created_at DESC` and renders the three panels (**S1-Tier0Draft**) following the render-whatever-exists rule (R6 — §9.5). Priya sees:
- **Your story so far** — a 3-paragraph summary.
- **Evidence prompts** — "Upload DBS's written response", "File a police report".
- **Preliminary signal — informational only** — *"Your case has characteristics similar to SRF-eligible claims. This is not a final decision; MAS guidance is complex."*

Priya reads it. She's impressed.

### B.6 Transition — Eligibility gate + checkout (T-EligibilityGate → T-PaymentSuccessLanding)

Priya scrolls to the bottom of the Tier-0 draft. Before showing the *Buy full report* CTA, the frontend silently fires a `supabase.rpc('get_case_eligibility', { p_case_id })` (**T-EligibilityGate**). The RPC returns:
- `eligible_actions.run_report_selfserve = true` — she meets prerequisites (extract complete, at least one ready document).
- `prerequisites.all_met = true`.
- `entitlement.plan = 'free'`.

The frontend transitions to **T-BuyReportCTA** — a prominent "Buy full report — SGD $49" card appears.

Priya clicks. The frontend `POST`s to `/api/stripe/create-checkout-session` with `case_id` and `user_id` in metadata. Stripe returns a hosted URL; the UI shows **T-CheckoutRedirect** for ~600 ms, then `window.location` navigates her to **T-StripeCheckout**. She enters her card, clicks Pay, Stripe redirects her back to `/app/case/[id]/checkout/success` (**T-PaymentSuccessLanding**).

**Behind the scenes (R9 — §9.7, webhook fan-out is a background job):**
1. Stripe sends `checkout.session.completed` to `/api/stripe/webhook` (**bg-webhook**).
2. Webhook route, in a single Postgres transaction: verifies signature → `UPSERT case_entitlements (case_id, plan='self_serve_report')` → `INSERT jobs (job_type='post_payment_report_generation', case_id, user_id, status='queued')` → returns `200` in ~700 ms.
3. A Render background worker is polling `jobs` for `status='queued'`. It picks Priya's job up within 1–2 s.

Priya's browser, still on **T-PaymentSuccessLanding**, detects entitlement upgrade (either via a 1-second poll on `case_entitlements` or by redirecting to Layer 2 after 1.5 s unconditionally) and navigates to `/app/case/[id]/report`.

### B.7 Layer 2 — Decision + report generation (L2-DecisionRunning → L2-ReportReady)

Priya lands on the Layer 2 screen in **L2-DecisionRunning**. The UI shows a calm progress animation: *"Analysing your case against Singapore regulations and prior decisions…"* with an estimated time (20–40 s).

The frontend opens a **Realtime subscription on `case_decision_runs` filtered by `case_id`** (§9.7). The Render worker, meanwhile:
1. Calls `POST /api/edge/decision` (server route wraps `run_case_decision_v1`). The edge function runs RAG against `public_decisions`, evaluates the claim, writes one row into `case_decision_runs`. ~15–25 s.
2. Realtime pushes the new row to Priya's browser. Transition to **L2-ReportDrafting** — copy flips to *"Drafting your complaint report — up to 30 seconds."*
3. The frontend opens a second **Realtime subscription on `reports` filtered by `case_id` and `status=COMPLETED`**.
4. The Render worker calls `POST /api/edge/report` (wraps `run_report_selfserve_v1`, server route injects `simulation_key`). The edge function composes the report, writes one row into `reports` with `status='COMPLETED'`. ~15–25 s.
5. Realtime pushes the `reports` row. Transition to **L2-ReportReady**.

The frontend reads `SELECT * FROM reports WHERE case_id = :id ORDER BY created_at DESC LIMIT 1` (R4 — always the latest re-run). Priya sees her full report: title, executive summary, timeline, disputed transaction table, requested resolution, evidence checklist, disclaimers. She can copy it, print it, or (post-MVP) download as PDF.

End-to-end, from the moment she clicked Pay to seeing her final report: **~60 seconds**.

### B.8 What Priya does *not* experience — Layer 3

Priya's case is a self-serve SRF matter — she will send her report to DBS herself. She never needs Layer 3.

If Priya later upgrades to Tier-1 and finishes her paid self-serve report, the report viewer shows a *"Need help escalating to FIDReC? → Get help from a specialist"* CTA. Clicking it takes her to **L3-FormFilling** — a human-in-the-loop form on the Layer 3 / Tier 2 surface. Her first name, last name, email, and phone are **auto-filled from her Clerk profile** (editable). She then enters her **age** (e.g. 62), picks an **employment status** (`retiree`), ticks the two FIDReC-qualification booleans (**≥ 30 days since last FI reply?** ✅ yes; **FI issued final response?** ✅ yes), and optionally writes a one-liner. Above the form sits a read-only context card showing what Dance will see on his side: *"DBS — reported loss SGD 58,400 — case `<uuid>`"* — those two numbers come from Priya's latest `case_extract_runs.extract_json`, not from form inputs. On submit, the browser POSTs to `/api/contact-requests` with the user-entered fields only (no `user_id`, no `amount_lost_sgd`, no `financial_institution` on the wire). The Next.js route (a) verifies Clerk session, (b) Zod-validates the body, (c) does an RLS-scoped ownership probe on `cases`, (d) reads the snapshot values from the latest `case_extract_runs` row, (e) `upsert`s one row into the contact-requests storage table (currently `escalation_waitlist` per IS §10.5; follow-up migration may rename to `contact_requests`) on the `(user_id, case_id)` unique key, (f) emails Dance. RLS enforces `user_id = auth.uid()` via the `DEFAULT auth.uid()` column plus the owned-case FK check. Dance opens his triage inbox, sees age / employment / two qualification flags / amount / FI at a glance, and picks up the conversation out-of-band over email or WhatsApp. The page also keeps the persistent WhatsApp entry point and specialist recommendation copy; after Slice 8 it can show SGD 99 / SGD 800 Stripe add-ons. No edge function runs from the contact path, and LinkedIn / generic waitlist framing stays out. If Priya later reopens the form to flip `fi_issued_final_response` after receiving the FI's final letter, the `UNIQUE (user_id, case_id)` constraint + `onConflict` clause overwrites her prior row — Dance sees one up-to-date record per user per case.

### B.9 Re-runs and edits (covered by the same diagrams)

A week later, Priya receives DBS's official written rejection letter. She logs in, navigates back to her case, and uploads the letter. The upload re-enters **GL-Uploading** → **GL-Processing** → Realtime ready → auto-fires `/api/edge/extract` (R11) → extract re-runs **append** (R4) → `get_case_eligibility` still says `eligible_actions.run_report_selfserve = true` — she can now regenerate her report.

She clicks **Update my report** (a CTA on the Layer 2 screen, visible when `reports` has at least one row and the extract timestamp is newer than the latest report). The frontend re-enqueues a report generation job via the same background-worker path. The new `reports` row appears via Realtime; the UI re-reads "latest row" and shows the updated version.

> Note (R4, §9.8): there is currently **no audit trail** for decision or report overwrites. The `jobs` table and `reports` versioning give you some traceability, but an explicit `case_decision_runs_history` table is a post-MVP backlog item (checklist row 20).

### B.10 What to look for when QA tests this flow

A sensible first E2E test script:

1. Sign up a fresh user, confirm `auth.users` row exists with `raw_user_meta_data.sub` = the same UUID as `profiles.id`.
2. Start a new case. Confirm `cases.user_id = auth.uid()` and RLS lets the user read back their case via the user-scoped Supabase client.
3. Answer one gap question. Confirm `case_intake.intake_type = 'gap_response'` row exists and a *new* `case_extract_runs` row is appended (not overwritten).
4. Upload a PDF. Confirm **`POST /api/evidence/upload`** returns **exactly one** `case_documents` row for `(storage_bucket, storage_path)` (no duplicate from storage trigger — disabled 2026‑05). Confirm `case_documents.processing_status` transitions via Realtime (`pending` → … → `ready`).
5. After an extract produces validation gaps, confirm **`case_validation_gap_items`** exists for `validation_run_id`, **`COUNT(*) = jsonb_array_length(missing_fields)`** on parent `case_validation_runs`, and rows sort correctly by **`sort_order`** (IS §4.5). In the UI, confirm the rendered question answer keys are real field keys such as `incident_date` / `reported_loss.amount`, never `undefined`; when `v_case_validation_gap_items` returns no rows for an old run, confirm `questions_to_user` JSON still renders. For a forced validation error, confirm `case_validation_runs.error_message` appears instead of a normal question panel.
6. Upload a `.txt` file. Confirm the UI rejects it client-side (R7) — no request should reach the server.
7. Reach the Tier-0 draft. Confirm all three `case_narratives` rows exist **and** that temporarily deleting any one row (e.g. `tier0_srf_signal`) and refreshing still renders the other two without breaking the screen (R6).
8. Pay via Stripe test card `4242 4242 4242 4242`. Confirm within 2 s: `case_entitlements.plan = 'self_serve_report'`, a `jobs` row exists with `status='queued'`, then progresses to `running` → `completed`.
9. Watch the Layer 2 progress screen complete without user intervention (R9 — no call from the webhook to decision/report).
10. Try to access another user's `case_id` by hand-crafting a request to `/api/edge/extract`. Confirm it returns `404` (server-route ownership probe) and **never a 200** — proving RLS + server-route belt-and-braces (§9.2).

---

## Appendix C — Change log

- **2026-05-02** — **Structured validation gaps + evidence upload contract.** IS §4.5 documents **`case_validation_gap_items`**, **`v_case_validation_gap_items`**, and **`run_validation_v1` dual-write** (deterministic join of `missing_fields` ↔ `questions_to_user`). SM R5 checklist row and gap-loop read contracts updated. Frontend wiring now keeps `case_validation_runs` as the parent state row, prefers **`v_case_validation_gap_items`** ordered by `sort_order` for rendered questions, normalizes DB rows/legacy JSON into `ValidationQuestion`, falls back to `questions_to_user` for old runs, sends typed `response_type`, and surfaces `error_message` when `status = 'error'`. **Storage → `case_documents`:** auto-insert trigger disabled; **`POST /api/evidence/upload`** is the sole writer of the metadata row after blob upload (IS §4.2); master sequence and B.10 QA steps updated.
- **2026-04-26** — **Layer 3 = Tier 2 + WhatsApp.** Layer 3 and Tier 2 are the same post-Tier-1 surface. The FIDReC contact form remains `/api/contact-requests` with no Supabase edge function; the root-layout WhatsApp `wa.me/6590727915` link is required on public and authenticated routes; Layer 3 adds Scam and Fraud Specialist recommendation copy; Slice 8 adds SGD 99 specialist consult and SGD 800 case-pack Stripe add-ons on this surface. This supersedes older "no WhatsApp" wording while keeping LinkedIn and generic coming-soon waitlist framing out of scope.
- **2026-04-20** — **§10.4 Clerk mapping locked (Pattern C).** Verified via Dashboard: `auth.users` populated with Supabase UUIDs, `cases.user_id → auth.users.id` FK, `handle_new_user()` trigger copies UUID into `profiles`. Integration Summary §9.2 rewritten to remove manual ownership check (RLS handles it). `escalation_waitlist.user_id` retyped from `text` to `uuid` referencing `auth.users.id`. State Machine §7 checklist row 2 and §8.1 error table updated. Added Appendix B reviewer's walkthrough.
- **2026-04-21 PM** — **Masha feedback reconciliation pass.** Canonical sequence locked to **3 Tier-0** (`evidence_processed_v2` → `run_case_extract_v4` with gap loop → `bright-function`) + **2 Tier-1** (`run_case_decision_v1` → `run_report_selfserve_v1`). `candidate-transactions` and `compute-loss` demoted to **Masha-internal fallbacks only** (no frontend wiring). `gemini-task` marked **archived**. **R9 rewritten** — decision runs in Layer 2 only, not Tier-0. **R10 rewritten** — `bright-function` fires once after the freshness-check extract pass. **R11 rewritten** — extract auto-re-fires on first upload, gap answer, and freshness check. **R12 rewritten** — Layer 3 became a simple FIDReC handoff contact form (name / email / phone / optional message) → `POST /api/contact-requests` + email Dance, with LinkedIn and generic "coming soon" waitlist framing removed. **2026-04-26 later supersedes the old WhatsApp/Tier-2 wording.** **R13 added** — pre-login landing-page narrative capture is **client-side only** (`sessionStorage` / Clerk `unsafeMetadata`) → no anonymous Supabase rows, Slice 0 Pattern C unchanged; first authenticated request calls `POST /api/cases/bootstrap`. **R14 added** — Tier-1 upstream re-runs are **conditional** on new documents / new intake rows since the last decision run. **§2 master sequence, Diagram 1, Diagram 3, Diagram 4, §7 checklist, §9 verification checklist, and Appendix B.8 all rewritten** to match. **Layer model** added a "pre-layer" (client-side only). **Diagram 2 `T-PaymentSuccessLanding`** now enters `L2-UpgradeScreen` (not `S-decision-running` directly). Binding contract: [`2026-04-21-Masha-Feedback-Reconciliation.md`](./2026-04-21-Masha-Feedback-Reconciliation.md) §0 and §6.
- **2026-04-21 PM late-afternoon** — **Layer 3 human-in-the-loop expansion.** Deprecated the 4-field "name / email / phone / optional message" minimal form from the morning reconciliation pass. **R12 rewritten** to capture (a) **age** (int 13–120), (b) **employment status** (`professional` / `retiree` / `student` / `other`), (c) **two FIDReC-qualification booleans** — `thirty_days_since_last_fi_reply`, `fi_issued_final_response`, and (d) an optional message. **Server-side snapshotting** added for `amount_lost_sgd` + `financial_institution` — pulled from the latest `case_extract_runs.extract_json` at insert time so Dance's triage table matches what the user saw on-screen. **IS §9.9 rewritten** with Group A (server-captured) / Group B (auto-filled, editable) / Group C (user-entered) field taxonomy + full `app/api/contact-requests/route.ts` sketch (Zod + RLS probe + latest-extract snapshot + `upsert` on `UNIQUE (user_id, case_id)` + notification email). **IS §10.5 rewritten** with the expanded `escalation_waitlist` schema (new columns + CHECK constraints). **IS §7 + §8.1 gotcha 3 updated** to match. **Diagram 4 + Layer 3 per-state contracts + checklist rows 10 & 20 rewritten.** **Appendix B.8 Priya walkthrough rewritten** with the retiree FIDReC handoff scenario. The `upsert` behavior lets the user re-submit if they later flip `fi_issued_final_response`. Client body explicitly does NOT carry `user_id`, `amount_lost_sgd`, or `financial_institution` — those are server-side guardrails.
- **2026-04-20** — **Slice 0 runbook published (setup + wipe, no migration).** The live `lib/auth.ts` and Clerk webhook still carry a Pattern B fallback (custom `profiles.clerk_id` lookup + random UUID). Because every current row in `auth.users` / `public.profiles` / `public.cases` is Elena's test data, Slice 0 **wipes** those rows rather than migrating them, then configures the Clerk JWT `supabase` template + the Supabase Third-Party Auth provider so that the next signup flows through Pattern C natively (`auth.users.id == profiles.id == cases.user_id`). The runbook at [docs/runbooks/slice-0-auth-reconciliation.md](runbooks/slice-0-auth-reconciliation.md) has the exact dashboard clicks, env-var checklist, truncate script, and three end-to-end smoke tests. A TODO comment at the top of `lib/auth.ts` points to the runbook; its removal (and the rewrite to a two-line `getCurrentUser()`) is the signal that Slice 0 is complete. Every subsequent slice builds against `auth.uid()` semantics — nothing downstream reintroduces a custom Clerk→UUID mapping. See Appendix D for the ordered execution steps.
- **2026-04-20** — Initial draft based on Integration Summary v1 (§§1–12 all locked except §10.2 DOCX and §10.4 Clerk mapping verification, both non-blocking for this document).

---

## Appendix D — Slice 0 execution plan (Clerk ↔ Supabase Third-Party Auth, Pattern C)

This appendix is the in-repo mirror of [docs/runbooks/slice-0-auth-reconciliation.md](runbooks/slice-0-auth-reconciliation.md). The runbook is the operational script (dashboard clicks, SQL, findings table); this appendix is the **durable plan reference** that every subsequent slice links back to.

### D.1 Prerequisites

| # | Item | Where |
|---|---|---|
| 1 | Supabase Dashboard access (owner/admin) | Supabase project |
| 2 | Clerk Dashboard access (production instance) | Clerk project |
| 3 | `.env.local` writable, dev server runnable locally | Local repo |
| 4 | Confirmation that every existing row in `auth.users` / `public.profiles` / `public.cases` is test data | Elena's sign-off |

### D.2 Documentation and SDKs referenced

No new npm packages. Pattern C is a pure JWT + JWKS handshake; the Clerk SDK and `supabase-js` already in the repo are enough.

| Doc / SDK | Version | Why |
|---|---|---|
| [Clerk — Integrate Supabase with Clerk](https://clerk.com/docs/integrations/databases/supabase) | current | Canonical step-by-step for the JWT template. |
| [Supabase — Third-Party Auth: Clerk](https://supabase.com/docs/guides/auth/third-party/clerk) | current | Enabling Clerk as a provider and the JWKS URL contract. |
| [Supabase — Clerk integration partner guide](https://supabase.com/partners/integrations/clerk) | current | End-to-end Next.js 15/16 example. |
| [Clerk — `getToken({ template })`](https://clerk.com/docs/references/javascript/session#get-token) | — | API already wired in `lib/supabase/{server,browser}.ts`. Template name must be exactly `supabase`. |
| `@clerk/nextjs` | ≥ `7.0.1` (already in `package.json`) | Server helpers (`auth()`) and client hooks (`useAuth()`). |
| `@supabase/supabase-js` | ^2 (already in `package.json`) | `createClient()` + Realtime + `auth.setSession()`. |

### D.3 Ordered execution steps

Follow in order; do not skip ahead.

1. **Configure the Clerk JWT template `supabase`.**
   - Clerk Dashboard → JWT Templates → New template.
   - Prefer the "Supabase" preset if shown. Otherwise use the manual claim block in runbook §1.2.
   - Template name = `supabase` (lowercase). Save. Copy the JWKS URL.

2. **Enable Clerk as a Third-Party Auth provider in Supabase.**
   - Supabase Dashboard → Authentication → Providers → Third-Party Auth → Clerk (fallback: Custom JWT).
   - Paste the JWKS URL, Issuer URL, and audience `authenticated`. Save.

3. **Verify `.env.local` carries all five keys** listed in runbook §1.4. No new variables are introduced; this step just prevents broken local dev.

4. **Take a pre-wipe Supabase backup** (Database → Backups → Create). Label `pre-slice-0-wipe-<YYYY-MM-DD>`. Rollback relies on this.

5. **Wipe test users on both sides.**
   - Supabase: run the `TRUNCATE ... CASCADE` + `DELETE FROM auth.users` script in runbook §2.3.
   - Clerk Dashboard → Users: select all and delete.

6. **Retire the Pattern B glue code.**
   - Rewrite `lib/auth.ts` to the two-line `getCurrentUser()` shown in runbook §3.1. Delete `getOrCreateProfile()`, the `profileId` concept, and the TODO comment block.
   - Delete the `public.profiles` insert branch in `app/api/webhooks/clerk/route.ts`. `handle_new_user()` does that job from the Supabase side now.
   - Run `rg "profileId|getOrCreateProfile" app/ lib/` and fix every remaining hit. Expected final count: 0.

7. **Run the three end-to-end smoke tests** in runbook §4.
   - §4.1 — fresh signup produces matching `auth.users.id` and `profiles.id`.
   - §4.2 — `auth.uid()` handshake via a Supabase RPC call returns RLS-filtered data (no JWT error).
   - §4.3 — `cases` insert succeeds without manual `user_id`; the returned row's `user_id` equals `auth.uid()`.

8. **Fill in the Findings table at the bottom of the runbook** (JWKS URL, row counts pre-wipe, timestamps, smoke-test pass/fail). This is the audit trail.

9. **Confirm completion.** All four statements below must be true.
   - `lib/auth.ts` no longer contains `getOrCreateProfile` or the TODO.
   - `rg "profileId|getOrCreateProfile" app/ lib/` → 0 hits.
   - All three smoke tests passed.
   - Change-log entries in Integration Summary §10.4 and this Appendix C updated with completion timestamp.

### D.4 What Slice 0 does **not** do

To avoid scope creep, the following explicitly belong to later slices:

- Editing `lib/supabase/server.ts` / `lib/supabase/browser.ts` — already done in Slice 1; they consume `getToken({ template: 'supabase' })` and will start working the moment Step 1 completes.
- Replacing old `/api/cases/*` routes — Slice 7 cleanup.
- Any RLS policy changes — out of scope; the existing policies already use `auth.uid()`.

### D.5 Failure modes and what they mean

| Symptom | Likely cause | Fix |
|---|---|---|
| `PGRST302` or `JWT expired` when a signed-in user hits an edge-proxied route | JWKS URL in Supabase does not match Clerk's signing key | Re-copy the URL from Clerk → JWT Templates → `supabase` and paste into the Supabase provider form |
| `auth.users.id` and `profiles.id` differ for a new signup | Clerk webhook still inserts into `profiles`; it races `handle_new_user()` | Confirm Step 6's webhook edit landed; redeploy the app |
| `cases` insert returns `new row violates row-level security policy` | The frontend sent a Supabase anon client, not the user-scoped one | Call `createUserClient()` from a server route, not `createClient()` |
| Pattern B code reappears in a later slice | Import from `lib/auth.ts` to get a `profileId` | `rg "profileId" app/ lib/` — every hit is a bug and must be replaced with `userId` (Pattern C) |

### D.6 Done condition

Slice 0 is done when every checkbox at the bottom of the runbook is ticked and this appendix's §D.3 Step 9 is true. From that point forward, every slice assumes `auth.uid()` returns the signed-in user's UUID and that UUID is the primary key across `auth.users`, `public.profiles`, and every `*.user_id` foreign key.
