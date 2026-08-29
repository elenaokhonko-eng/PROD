# Annotated screen specifications

All frame annotations below apply at **390 / 768 / 1440 px**. Use [approved copy](./copy-and-claims.md), not copy in legacy visual samples. The six connected flows at the end are the prototype priority. The 61 named A–I states are an acceptance inventory of presentation variants around canonical components and hooks—not 61 routes or a client-side state machine.

## Responsive frame rules

| Width | Shell | Composition | Controls |
|---|---|---|---|
| 390 | 16 px inline inset; one column | Full-width cards; task-only header; sticky primary action above safe area | Drawers/sheets for navigation and report outline; tabs stack/scroll only inside their labelled region; no clipped labels. |
| 768 | 24 px inset | One/two columns according to task; sidebar/outline collapses | Inline primary/secondary actions where they fit; otherwise stack with primary first. |
| 1440 | 32 px inset; 1280 px max | 12-column public grid; workspace can use evidence/question or report rails | Persistent context only where it helps the current task; text max 720 px. |

At each width, keyboard focus order follows visual/task order. Zoom/reflow cannot hide an action, error, status, or dialog close control.

## Family A — seven public pages

| Screen ID / route | Required content and state annotations |
|---|---|
| A1 `/` — Home/narrative capture | Reassurance and disclaimer precede type/record card. States: empty, typing, recording, paused, transcript-ready, restored local draft, invalid/empty submit, microphone denied (typed fallback), offline (disable sign-in handoff; retain draft). CTA begins sign-up with local draft preserved. |
| A2 `/product` — Product | Six-step journey, free/paid boundary, report preview built from live UI—not image text. Link to start, how it works and pricing. No outcome/authority claims. |
| A3 `/about` — About | Purpose, responsible-use disclaimer, owner-verified organisation/contact, and only ledger-approved copy. PDPA, encryption, and MAS public wording is withheld until its evidence and legal/compliance approval gate pass. Do not use government seals, certification language, or endorsements. |
| A4 `/marketplace` — Marketplace | Harbor cards for planned help categories: clinics, social-service resources, and warm handovers. Every CTA is inactive with “Planned—not currently available through GuideBuoy.” No referral, partnership, availability, or endorsement is implied. |
| A5 `/resources` — Resources | Search/filter, loading skeleton, no-results empty state, error/retry, external-link notice, optional authenticated relevance tag only when supplied by API. Future help-resource cards use the same inactive “Planned—not currently available through GuideBuoy.” treatment. |
| A6 `/faq` — FAQ/contact | Searchable categories and accordion; contact form empty, validation error, submitting, submitted, server error preserving values. Submitted copy is based on the canonical API result; use “Request received.” only for a durable server receipt. No time or refund promise. |
| A7 `/sign-in`, `/sign-up` — Authentication | Harbor shell around provider-owned auth, local-draft preservation explanation, email sign-in path, and a disabled “Singpass sign-in is not currently available.” option. It does not authenticate. Include loading, returning user, expired link, account-exists, auth error and offline states. Never falsely state a case exists before bootstrap. |

Public header/footer are specified in [component system](./component-and-sensory-system.md). `/privacy` and `/terms` require Harbor treatment and approved minimum truthful legal content before first release: readable title, fixed effective date and revision, owner-verified support path, and the approved deletion-request entry point. They must not invent policy, retention, refund, or legal terms. “Content is being prepared” alone cannot ship; expanded legal content is FF-003.

## Families B–I — authenticated and routed experience

| Family | Screens / state coverage | Required composition and non-invented behaviour |
|---|---|---|
| **B Router** | B1 `/router` story; B2 `/router/classify` processing/slow/error; B3 `/router/questions`; B4 bank-first; B5 telco/IMDA; B6 potentially-FIDReC; B7 waiting; B8 other; B9 out-of-scope; B10 `/router/tracker` empty/active/overdue/matured/reminder/date-correction. | One question per mobile frame; save/back/“I’m not sure”. Result is informational and only follows returned classification. Tracker reminder CTA stays disabled unless the supported API confirms it. |
| **C Bootstrap** | `/onboarding`: auth check, importing, success, no local story, expired local story, offline, access failure, server failure. | “We couldn’t start your case. Your saved draft is still here.” Retry, return home, support. Do not silently redirect/clear draft. |
| **D Free case** | `/app/case/new`: story edit, first upload, validation; `/app/case/[id]/dashboard`: evidence queued/uploading/reading/checking/organising/extracting/ready/failed/rejected/duplicate, gap loop save/saved/error/retry, finalising, draft pending/ready/partial. | 1440 questions/evidence split; 768 adaptive rail; 390 tabs/stack and sticky next action. Display accepted types, limits, and validation only from the upload API. Questions wait for server validation data; available draft panels render independently. |
| **E Upgrade/payment** | `/app/case/[id]/checkout`: prerequisite blocked, eligible plan, redirect, provider handoff, cancelled, returned/success, delayed entitlement. | Show price from approved catalogue; no browser eligibility calculation. Delayed state polls/receives actual status and prevents repurchase. Cancelled preserves case. |
| **F Report generation** | `/app/case/[id]/dashboard`: last update, reprocessing (only when data changed), analysis, drafting, slow/background, worker failure, realtime reconnect/offline. | Unknown-duration work uses stages, not fake percent. Each material output states: “Generated automatically by GuideBuoy AI. It has not been reviewed by a person.” On reconnect, read latest status; tell user if leaving is safe only when backend supports it. Failure preserves case and offers status retry/support. |
| **G Report/case** | `/app/case/[id]/dashboard`: report viewer, update available, dashboard empty/loading/error, collaborators invite/pending/accepted/expired/invalid/revoke/access states. | Desktop outline/read/action rails; tablet collapsible outline; mobile sheet + sticky actions. Reports show version/date, summary, timeline, transactions, totals, evidence, limitations and disclaimers. Only expose actions backed by API. |
| **H Post-report help** | Report action opens H1 chooser; H2 contact form; H3 submitting; H4 confirmation; H5 validation/server error; S$18/S$188 only when entitlement/route supports them. S$8/S$12 subscription offers remain blocked until lifecycle and server-catalogue support are released. | Context fields are read-only API data; name/email/phone/age/employment/timing answers/message are editable. Required boolean answers use radio groups. Duplicate submit locked. Confirmation says received—no response time. Show “Human consultation is not currently available.” as an inactive state. Future offers use “Planned—not currently available through GuideBuoy.” |
| **I System states** | Auth expired, access denied, not found, generic server error, offline/reconnecting, no cases/documents/report/collaborators/results/activity, skeletons. | Use professional Harbor system-page placeholders with task-relevant retry/back actions. Keep user input in memory/local draft where supported; modal/page gives retry and safe exit. No raw status codes, infrastructure language, or cross-user data. |

## Prototype priority flows

1. **Primary:** A1 → A7 → C → D upload/processing/gap loop → draft → E eligible → checkout return/delayed state → F analysis/draft → G report.
2. **Waiting route:** B1 → B2 → B3 → B7 → B10 active → matured → D.
3. **Bootstrap recovery:** A7 → C failure → retry → D upload, retaining local story.
4. **Document recovery:** D upload → rejected/corrupt/processing failure → replace or retry → ready → refreshed gaps.
5. **Payment/report recovery:** D draft → E checkout return → delayed confirmation → F → report failure → status retry/support with case retained.
6. **Help:** G → H chooser → contact validation error → corrected submit → confirmation/update; each catalogue-backed help checkout branches separately.

## State-machine node mapping

| Workflow node | Approved screen state |
|---|---|
| Pre-layer narrative | A1 empty/type/record/restored; A7 sign-in/up handoff |
| `S1-Bootstrap` | C importing/success/failure |
| `S1-IntakeForm`, `S1-Submitting` | D story intake/editing/submitting; server validation error retains values |
| `S1-EvidenceFirstUpload` | D first upload / upload validation |
| `S1-GapLoop` | D gap-and-evidence workspace shell |
| `GL-Idle`, `GL-AnsweringGap`, `GL-Submitting` | D gap question idle/editing/saving/error |
| `GL-Uploading`, `GL-Processing` | D per-file uploading/processing/ready/failed |
| `S1-FreshnessCheck` | D finalising banner |
| `S1-Tier0DraftPending`, `S1-Tier0Draft` | D draft preparing/ready/partial |
| `T-EligibilityGate` | E eligibility check on free-draft screen |
| `T-BuyReportCTA` | E eligible S$18 report card |
| `T-BlockedOnPrereq` | E prerequisite card with one resolve action |
| `T-CheckoutRedirect`, `T-StripeCheckout` | E branded redirect / provider-owned checkout handoff |
| `T-PaymentSuccessLanding`, `T-PaymentCancelled` | E returned/delayed confirmation / cancelled state |
| `L2-UpgradeScreen`, `L2-UpstreamReRun` | F final update / conditional reprocessing |
| `L2-DecisionRunning`, `L2-ReportDrafting`, `L2-ReportFailed`, `L2-ReportReady` | F analysing/drafting/failure; G report ready |
| `L3-FormFilling`, `L3-Submitting`, `L3-Confirmed` | H form/submitting/confirmed; validation/server error returns to H form |
| `T2-PackOffer`, `T2-PackCheckout`, `T2-PackReady`, `T2-PackFailed`, `T2-ConsultOffer` | H catalogue-backed offer/checkout/ready/failure cards; unavailable offers use disabled future treatment |
| `bg-webhook` | No user screen; E delayed confirmation is the observable state |
| HTTP/auth/access/not-found/realtime errors | I corresponding recovery state, except inline task-specific errors above |
