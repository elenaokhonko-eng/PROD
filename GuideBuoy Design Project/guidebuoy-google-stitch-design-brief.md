# GuideBuoy AI — Google Stitch master UI/UX design brief

## 1. Purpose of this document

Create a complete, coherent UI/UX design system and screen family for **GuideBuoy AI**, a Singapore-focused financial-dispute helper. This is not a static brochure website. It is a dynamic, state-driven product that changes what the user sees according to:

- whether the user is anonymous, signing up, authenticated, or returning;
- what kind of dispute the public complaint router identifies;
- whether the dispute is suitable for FIDReC, requires a waiting period, belongs with another authority, or is unsupported;
- whether intake information or evidence is incomplete;
- the live processing state of each uploaded document;
- whether a free Tier-0 draft is being prepared or is ready;
- whether the user is eligible to buy a full report;
- payment status and entitlement;
- background decision/report generation state;
- whether the paid report succeeded or failed;
- whether the user wants self-service, a FIDReC handoff, WhatsApp help, a specialist consultation, or a prepared case pack;
- authentication, network, processing, access, and recovery errors.

Google Stitch should produce a **single design language with reusable components**, plus all screen states and responsive variants needed to implement the entire journey. Do not design each state as an unrelated page.

## 2. Product in one sentence

GuideBuoy AI helps a person explain a financial dispute once, identify the right Singapore escalation path, organise evidence, close factual gaps, generate a reusable complaint report, and optionally obtain specialist help for a FIDReC submission.

## 3. The user and emotional context

Primary users are Singapore consumers dealing with scams, unauthorised transactions, bank disputes, telco-assisted fraud, rejected claims, cryptocurrency/platform disputes, or other financially stressful events.

They may be:

- distressed, embarrassed, angry, uncertain, or cognitively overloaded;
- using a phone while referring to emails, screenshots, bank statements, or SMS messages;
- unfamiliar with FIDReC, MAS, IMDA, police-reporting processes, formal complaints, or legal language;
- worried about money, deadlines, eligibility, privacy, and making a mistake;
- neurodivergent, older, visually impaired, low-confidence with technology, or using English as an additional language;
- returning after days or weeks when a bank responds or the FIDReC waiting period matures.

The experience must feel calm, safe, structured, non-judgmental, and transparent. It must never imply that the user caused the loss. Avoid alarmist visuals, casino/fintech aesthetics, dense legal portals, or chat interfaces that hide progress.

## 4. Product architecture: dynamic layers

### Pre-layer — public discovery and complaint routing

Anonymous users can learn about the product, type or voice-record their story, or take the complaint router assessment. Their narrative is temporarily held client-side until authentication; the design should explain that their case is not created until sign-in succeeds.

### Layer 1 / Tier 0 — free case preparation

After authentication, GuideBuoy creates the case, asks for at least one supporting document, processes it live, identifies missing facts, loops through targeted questions, and generates a free draft containing the story summary, evidence checklist, and preliminary pathway signal.

### Transition — eligibility and payment

The free draft includes either an upgrade CTA or a clear prerequisite card. Eligible users can buy a full report through Stripe. Payment return and processing are separate states.

### Layer 2 / Tier 1 — paid self-serve report

The user may add last-minute evidence or edit their narrative. Heavy work runs in the background. The UI visibly progresses from evidence refresh to case analysis to report drafting. The finished report is a structured, reusable workspace and document.

### Layer 3 / Tier 2 — FIDReC handoff and specialist commerce

After the paid report, users can request human help, contact a Scam and Fraud Specialist, book a 30-minute consultation, or purchase case-pack preparation. A FIDReC handoff form captures qualification signals and contact details while showing the case context that will be shared.

## 5. Canonical end-to-end workflow

```text
Public landing
  → type or record story
  → optional public complaint router
  → sign up / sign in
  → authenticated case bootstrap
  → first evidence upload
  → document processing
  → targeted gap-question loop
  → final freshness check
  → free Tier-0 draft
  → eligibility gate
      ↳ prerequisites missing → resolve missing item → re-check
      ↳ eligible → choose report → Stripe checkout
          ↳ cancelled → retry or return to draft
          ↳ successful → payment confirmation
              → optional last evidence/narrative update
              → analysing case
              → drafting report
                  ↳ generation failure → protected error/recovery
                  ↳ report ready → read/copy/print/download
                      → self-service completion, or
                      → FIDReC/specialist surface
                          ↳ contact request
                          ↳ WhatsApp Q&A
                          ↳ SGD 99 specialist consultation
                          ↳ SGD 800 FIDReC case-pack preparation
```

## 6. Brand and visual direction

| Element | Direction |
|---|---|
| Brand | GuideBuoy AI |
| Assistant | Lumi |
| Core promise | Explain it once. Organise it clearly. Know what to do next. |
| Primary | Deep trustworthy blue, approximately `#1E3A8A` |
| Accent | Warm amber, approximately `#F59E0B`; use for guidance, highlights, and progress—not long body text |
| Background | Soft blue-grey, approximately `#F0F4F8` |
| Foreground | Dark slate, approximately `#1F2937` |
| Success | Calm accessible green, reserved for completed/verified states |
| Warning | Amber, reserved for attention and waiting—not failure |
| Error | Accessible red with neutral, non-blaming language |
| Typography | Inter or equivalent highly legible sans-serif; tabular numerals for money, dates, case IDs, and progress |
| Shape | Soft cards; 12–16 px corner radius; avoid excessively pill-shaped content containers |
| Imagery | Real, respectful Singapore context: ordinary adults, documents, calm assistance, everyday environments; never show victims as helpless or use sensational scam imagery |
| Illustration | Optional abstract “buoy / guided route / organised papers” motifs; diagrams should communicate direction and safety |
| Motion | Gentle and purposeful. Progress motion must indicate ongoing work without fake precision |
| Voice | Warm, plainspoken, factual, reassuring, and never patronising |

Retain the existing calm blue/amber identity, but elevate it into a professional service product. The aesthetic should sit between a trusted public-service portal and a humane modern case workspace—not a bank, law firm, or generic SaaS dashboard.

## 7. Global UX rules

1. Design mobile first. Every core action must work comfortably at 320 px width and with one hand.
2. Each state has one visually dominant primary action.
3. Always show where the user is, what is happening, what is required next, and whether their work is saved.
4. Use progressive disclosure. Show plain-language summaries first, with technical/legal detail behind “Why?”, “How this was determined”, or expandable sections.
5. Never use colour alone for status. Pair colour with icon, label, and text.
6. Do not expose internal terms such as edge function, RPC, Supabase, job row, Tier 0, or state-machine node to end users.
7. Distinguish clearly between:
   - information GuideBuoy has extracted;
   - information the user confirmed;
   - preliminary guidance;
   - a final generated report;
   - human specialist advice.
8. Preserve user work through errors. Never silently erase the narrative, uploaded files, question answers, or pending handoff.
9. Do not redirect on failure without first showing an explanation and recovery choice.
10. Persistent global WhatsApp access may appear once in the root layout. Do not duplicate competing floating buttons.
11. Financial amounts use `SGD 12,400.00`; dates use unambiguous Singapore-friendly formats such as `29 Mar 2026`.
12. Use skeletons for content retrieval, determinate progress only when measured, and step-based progress for unknown-duration AI processing.
13. Every long operation needs a “You can safely leave this page” or “Keep this tab open” statement based on actual behavior.
14. Destructive or irreversible actions require confirmation. Routine retries do not.

## 8. Shared navigation and shells

### Public shell

Desktop navigation: Home, About, Product, Marketplace, Resources, FAQ, Sign in, and a primary “Start free” action. Analytics is an internal route and should not appear in the public consumer navigation.

Mobile: compact header, accessible menu, persistent but unobtrusive “Start free” CTA, and the single WhatsApp entry point.

Footer: GuideBuoy AI SG Pte Ltd, contact details, Singapore office, Terms, Privacy, security contact, social links, and WhatsApp.

### Authenticated case shell

Use a case-centred workspace rather than marketing navigation. Include:

- GuideBuoy logo/Home;
- case title and concise case reference;
- saved/sync indicator;
- current plan badge: Free, Full Report, or Specialist Support;
- journey stepper: Story → Evidence → Review gaps → Free draft → Full report → Get help;
- account/settings menu;
- privacy/help access;
- persistent Lumi help affordance, visually secondary to the current task;
- persistent global WhatsApp control.

On mobile, collapse the stepper into “Step X of Y” with a drawer for the full journey.

## 9. Screen-production matrix

Stitch must create every numbered screen and the listed variants. Screens sharing a shell should be produced as a family.

### Family A — public acquisition and trust

#### A1. Home / narrative capture

**Job:** let a distressed visitor begin immediately while establishing trust.

Above the fold:

- headline focused on turning one story into an organised, reusable report;
- concise “not legal advice” positioning without making the hero defensive;
- prominent “Create your unified report” card;
- mode switch: Type my story / Record my story;
- large narrative field with supportive example prompt;
- voice state with microphone, timer, waveform, pause, resume, stop, playback, discard, and editable transcript;
- privacy microcopy explaining temporary client-side storage before sign-in;
- primary CTA: “Start organising — free”;
- secondary route: “Not sure where to start? Check my complaint path.”

Below the fold: how Lumi guides the user, what the free stage includes, what the paid report adds, human-help options, trust/privacy, and Singapore-specific scope.

**Variants:** empty; typing; recording; paused; transcript ready; validation error; browser microphone denied; restored pending story; offline.

#### A2. Product overview

**Job:** explain the value ladder without requiring users to understand internal tiers.

Show: Tell your story → Organise proof → Answer focused questions → Receive a free draft → Generate a full report → Get specialist help. Include report-hub preview cards and transparent free/paid boundaries.

#### A3. About and trust

**Job:** establish legitimacy, Singapore focus, builder/team credibility, privacy posture, responsible-AI principles, and contact location.

#### A4. Marketplace overview

**Job:** explain optional human support. Separate public-good support from paid specialists. Include pro-bono clinics, social support, wellbeing, legal review, dispute coaching, cybersecurity/scam expertise, and volunteer help.

#### A5. Resources library

**Job:** make authoritative Singapore resources easy to scan. Design article cards, legal-framework cards, consumer guides, external-link treatment, filters, search, and “relevant to your case” badges for authenticated users.

#### A6. FAQ and contact

**Job:** answer high-anxiety questions and provide contact escalation. Use searchable categories, accordions, and a simple contact form with submitted/error states.

#### A7. Sign in / sign up

**Job:** authenticate without losing the pending story. Explain: “Your story is saved on this device and will become a case after sign-in.” Include email verification, social sign-in, returning-user, expired-link, and account-exists variants.

#### A8. Privacy, Terms, and consent surfaces

Design readable legal pages, consent notices, evidence-processing consent, data export/deletion entry points, and a short-form privacy explanation near uploads.

### Family B — public complaint router

#### B1. Router story intake

**Job:** capture the dispute in natural language by typing or voice, separate from the full case-building commitment.

Include restored-session card with Resume and Start fresh actions.

#### B2. Classification processing

**Job:** communicate that GuideBuoy is identifying the right path, not judging the case.

Use a short step animation: Understanding dispute → Identifying institution/platform → Checking pathway. Avoid fake percentage precision.

**Variants:** normal; slow processing; classification error with retry and preserved narrative.

#### B3. Dynamic follow-up questions

**Job:** collect only the facts needed for routing.

One question per mobile screen; compact card/stepper on desktop. Support yes/no, single choice, multiple choice, date, currency, short text, and “I’m not sure.” Show Back, save state, and question count.

#### B4. Router result — bank first response required

Explain that the user should first contact the financial institution. Primary CTA: start building the case/evidence record. Show steps, expected timing, and what to preserve.

#### B5. Router result — IMDA/telco route

Explain the telco/IMDA pathway with a step-by-step guide and the optional parallel FIDReC path where applicable.

#### B6. Router result — FIDReC eligible now

Use a positive but qualified “FIDReC pathway may be available” badge. Explain filing is free, show why this path appeared, show next steps, and provide “Build my FIDReC submission.”

#### B7. Router result — FIDReC waiting period

Explain the four-week requirement and offer “Set up my 4-week tracker.” Make waiting feel like productive preparation, not rejection.

#### B8. Router result — other/self-service options

Explain that FIDReC may not be the correct route while showing alternatives clearly.

#### B9. Router result — crypto/overseas/out-of-scope

Be honest without abandoning the user. Show police report, platform complaint, tracing/cybersecurity, legal-help, and reassessment routes. Avoid false promises.

#### B10. Four-week dispute tracker

Show:

- start date, target eligibility date, days remaining, and timeline;
- bank-contact log and reference numbers;
- evidence preparation checklist;
- reminder opt-in and confirmation;
- language tips for factual communication;
- “Ready to file” matured state with primary CTA;
- empty, active, overdue, matured, reminder-sent, and date-correction states.

### Family C — onboarding and case bootstrap

#### C1. Creating the authenticated case

Short transition after sign-up: “Setting up your case…” Explain that the saved story is being transferred securely.

**Variants:** checking authentication; importing; success; no saved story; expired pending story.

#### C2. Recoverable transition failure

This state is essential and must not silently return users home.

Suggested copy:

> **We’re sorry—something went wrong while starting your case.**
> Your information could not be transferred right now. Your saved story has not been deleted. Try again, or return to the home page to restart safely.

Actions: **Try again** (primary), Return home (secondary), Contact support (text). Optional visible countdown only if auto-redirect is required; offer “Stay on this page.”

**Variants:** session expired/sign in again; temporary server problem; no access; missing story; offline. Never show raw “Unauthorized.”

### Family D — Layer 1 free case workspace

#### D1. Case intake / edit story

Structured but conversational form: narrative, claim type, jurisdiction, institution, amount, incident date. Pre-fill extracted values where available and label them “From your story.” Allow uncertainty.

#### D2. First evidence upload

**Job:** obtain at least one supporting document before deeper extraction.

Show a prominent upload zone, camera/phone option, accepted formats (PDF, PNG, JPEG, DOCX), privacy reassurance, example documents, and “Why we need this.” Reject unsupported files inline before upload.

#### D3. Evidence upload in progress

Per-file cards with filename, type, size, cancel/retry, upload progress, and queued state. Support multiple files without turning the screen into a dense file manager.

#### D4. Evidence processing states

Create visual states for each document:

- Pending;
- Reading document;
- Checking/verification;
- Organising pages/content;
- Extracting facts;
- Ready;
- Failed;
- Unsupported/password-protected/corrupt;
- Potential duplicate.

Use live status chips and a clear explanation that processing can continue while the user answers questions.

#### D5. Gap-question and evidence workspace

Desktop: two-column workspace—questions left, evidence right. Mobile: segmented tabs or stacked task cards with a sticky “Next question” action.

Question components must support typed answer formats, “I don’t know,” evidence-linked hints, Save, saving, saved, validation error, and retry. Show why each question matters without exposing internal validation logic.

#### D6. Gap loop complete / final check

Show a completion summary: facts confirmed, documents ready, unresolved optional gaps, and “Generate my free draft.” During the freshness pass, keep the workspace visible with a non-blocking “Finalising the latest facts…” banner.

#### D7. Preparing free draft

Full-screen or full-workspace calm progress state: “Preparing your free draft—usually up to 15 seconds.” Show the steps being organised, with safe navigation guidance.

#### D8. Free draft ready

Render available panels independently:

1. Your story so far;
2. Evidence checklist: complete, recommended, missing;
3. Preliminary pathway signal—clearly informational, not a final eligibility decision.

Actions: edit story, add evidence, refresh draft, copy summary, continue. Do not leave blank gaps if a panel is unavailable; omit it and keep the rest usable.

### Family E — upgrade gate and checkout

#### E1. Eligible upgrade card

Placed after the free draft. Explain exactly what the paid report adds. Use transparent price and deliverables. The current documentation contains multiple evolving product/price references; design price as a token, not baked into imagery.

#### E2. Blocked prerequisite

Show one actionable missing item at a time, such as “Add at least one supporting document.” Primary CTA resolves the prerequisite; secondary action explains why it is required.

#### E3. Choose a plan

Support at least:

- Case Readiness Report;
- Report + Case Builder Bundle.

Compare inclusions clearly, show refund policy, secure-payment reassurance, total, and no hidden recurring charge. Avoid dark patterns or preselecting the more expensive option without justification.

#### E4. Redirecting to secure payment

Brief branded interstitial; explain the user is moving to Stripe and will return automatically.

#### E5. Stripe-hosted checkout handoff

Provide Stitch with a visual handoff frame only; do not redesign Stripe internals. Ensure surrounding copy and return expectations are documented.

#### E6. Payment successful

“Payment received. Setting up your report…” Provide receipt/help access and transition into report generation even if the backend job has not started yet.

#### E7. Payment cancelled

Neutral language: no charge was completed. Primary CTA Try again; secondary Return to free draft. Preserve case state.

#### E8. Payment pending or delayed entitlement

Payment may succeed before entitlement/job visibility updates. Show “Confirming payment” with receipt reference, automatic retry, and contact support—never ask the user to pay again prematurely.

### Family F — Layer 2 report generation

#### F1. Last chance to update

“Before we generate your report, add anything we missed.” Mirror evidence/narrative controls with a dominant “Generate my report” CTA and “No changes—continue” path.

#### F2. Reprocessing new information

Only shown when the user changed evidence or narrative. Explain that the latest material is being incorporated.

#### F3. Analysing the case

Copy: “Analysing your case against relevant Singapore guidance and prior decisions…” Use a calm staged progress illustration. Estimated range may be shown, never a fabricated exact percentage.

#### F4. Drafting the report

Copy: “Drafting your complaint report—usually up to 30 seconds.” Distinguish this visually from analysis so the user perceives forward movement.

#### F5. Slow/background processing

After the normal wait, explain the report is still being prepared, work is safe, and the user may leave and return. Offer refresh/status check and notification opt-in if supported.

#### F6. Report-generation failure

Suggested copy:

> **We hit a snag while preparing your report.**
> Your payment and case information are safe. We’ve kept your progress and you will not be charged again to retry.

Actions: Retry status check, Contact support, Return to case. Include an unobtrusive reference ID. Never expose stack traces.

#### F7. Realtime/network interruption

Persistent banner: “Connection interrupted. Reconnecting…” After prolonged interruption: “We’re checking the latest saved status.” Do not imply the report itself failed.

### Family G — report hub and completed case

#### G1. Full report viewer

Desktop: document navigation rail plus reading canvas and task/action rail. Mobile: section picker and sticky actions.

Required sections:

- report title and version/date;
- executive summary;
- chronology/timeline;
- parties and financial institution;
- disputed transactions, capped initial view with “Show all”;
- total reported loss;
- responsibility/issue points;
- requested resolution;
- evidence checklist and links;
- missing facts and limitations;
- disclaimers;
- sources/references where appropriate.

Actions: copy, print, download/export when available, share/invite, add evidence, update report, and get specialist help. Clearly label AI-organised content and user-editable fields.

#### G2. Report update available

When evidence/intake is newer than the report, show a non-destructive banner: “Your case has new information. Update the report to include it.” Explain that the current version remains accessible.

#### G3. Case dashboard / overview

Cards: case status, next recommended action, documents, completion, report access, collaborators, reminders, and recent activity. Prioritise one next action instead of showing equal-weight modules.

#### G4. Collaborators and invitation

Invite flow, role explanation, pending invitation, accepted, expired, invalid, unauthorised, and revoke states. Explain exactly what collaborators can see or change.

### Family H — Layer 3 / Tier 2 FIDReC and specialist support

#### H1. Post-report help chooser / hero

**Job:** help users who tried the bank and remain dissatisfied choose the right level of help.

Show three clearly differentiated paths:

1. **Request FIDReC handoff help**—human follow-up in 1–2 business days;
2. **Book a 30-minute Scam and Fraud Specialist consultation—SGD 99**;
3. **Prepare a FIDReC case pack—SGD 800**.

Keep the global WhatsApp route available for questions. Explain who each offer is for, what it includes, what it does not guarantee, and whether payment is one-off.

#### H2. FIDReC contact form

Context card:

- financial institution;
- reported loss;
- masked/short case ID;
- report date/status.

Editable pre-filled identity:

- first name;
- last name;
- email;
- phone.

Required user input:

- age, 13–120;
- employment status: Professional, Retiree, Student, Other;
- “Has it been 30 days or more since you last heard back from your financial institution?”;
- “Has the financial institution issued its final response?”;
- optional additional context, maximum 500 characters.

Use explicit Yes/No segmented controls or radio groups rather than ambiguous checkboxes for required booleans. Explain why the timing questions matter. Do not let the user edit the institution or amount in this form; link back to case details if incorrect.

#### H3. Submitting contact request

Disable duplicate submission, keep data visible, show spinner inside the submit action, and state that the case is being securely linked to the request.

#### H4. Contact request confirmed

Copy: “Thanks—we’ll be in touch within 1–2 business days to help you prepare your FIDReC submission.” Show what happens next, expected contact channel, ability to update answers, return to report, and WhatsApp for urgent clarification.

#### H5. Contact request validation/server failure

Keep all entered data. Highlight fields needing attention. For server failure, show retry and support; do not redirect or clear the form.

#### H6. Specialist consultation checkout

Offer summary, specialist role, 30-minute duration, SGD 99, preparation checklist, scheduling expectation, cancellation/refund policy, secure payment, success/pending/cancelled states.

#### H7. FIDReC case-pack checkout

Explain SGD 800 deliverables: evidence organisation, chronology, issue framing, case-pack preparation, review process, expected timeline, exclusions, and no-outcome-guarantee disclaimer. Include success/pending/cancelled states.

### Family I — cross-product system states

#### I1. Authentication expired during work

Modal/page preserving the current task: “Your session expired. Sign in again to continue. Your saved work is still here.”

#### I2. Access denied

“You don’t have access to this case.” Actions: open own cases, accept invitation, contact owner/support. Do not expose whether another user’s case exists.

#### I3. Case not found

Auto-check once, then provide case dashboard/home and support. Preserve route reference for diagnostics.

#### I4. Generic internal error

Plain apology, preserved-work reassurance, retry, safe exit, support, reference ID.

#### I5. Offline

Persistent offline banner, disable network-dependent actions, retain unsent form content locally, and announce reconnection.

#### I6. Empty states

No cases, no documents, no report, no collaborators, no resources matching filters, and no activity. Each empty state must teach and offer one next action.

#### I7. Loading and skeleton system

Define consistent skeletons for cards, documents, report sections, and dashboards; spinners only for short action-bound waits.

## 10. Dynamic rules Stitch must understand

| Condition | UI consequence |
|---|---|
| Anonymous + no pending narrative | Empty public story capture |
| Anonymous + pending narrative | Resume-story card |
| Signed out after starting | Sign-in gate that promises to preserve story |
| Authentication succeeds | Brief case-bootstrap transition |
| Bootstrap fails | Recoverable apology screen; never silent home redirect |
| No ready evidence | First-upload screen; no gap questions yet |
| Document processing | Live per-file state; questions may continue in parallel |
| Document failed | Retry/remove on that file; do not fail the whole case |
| Validation gaps exist | Ordered question loop |
| Validation system error | Error card blocks draft generation but preserves evidence/answers |
| No blocking gaps + at least one ready document | Enable/auto-offer free draft generation |
| Some free-draft panels missing | Render available panels only |
| Paid-report prerequisite missing | Actionable prerequisite card instead of purchase CTA |
| Eligible and still on free plan | Show report purchase CTA |
| Checkout cancelled | Return to purchase choice; case unchanged |
| Payment confirmed but job not visible | Confirming-payment state; do not offer repurchase |
| New material added before report | Reprocessing stage appears |
| No new material | Skip reprocessing and go directly to analysis |
| Decision completed | Move from analysing to drafting |
| Report completed | Open latest report |
| Background job failed | Payment-safe failure state |
| New evidence after report | Update-available banner; keep old report accessible |
| Completed report exists | Unlock FIDReC/specialist surface |
| Existing contact request | Show current submission and allow update/upsert |
| FIDReC waiting period not met | Explain wait and tracking/preparation options |
| Final response received or waiting period met | Emphasise ready-to-escalate path without guaranteeing acceptance/outcome |

## 11. Reusable component library Stitch should generate

- Public and authenticated headers;
- mobile navigation drawer;
- journey stepper and compact step indicator;
- case summary header;
- plan/entitlement badge;
- saved/sync/offline indicator;
- primary, secondary, tertiary, destructive, loading, and disabled buttons;
- story textarea and voice recorder;
- question cards for every answer type;
- money, institution, date, and uncertainty inputs;
- upload drop zone and mobile camera/file chooser;
- document card with all processing states;
- evidence checklist item;
- progress stage list;
- skeletons and loading cards;
- result/pathway card and badge;
- four-week timeline/tracker;
- free-draft narrative panel;
- eligibility/prerequisite card;
- plan comparison/pricing card;
- payment-state card;
- report table of contents;
- report section card and chronology timeline;
- transaction table responsive pattern;
- source/evidence citation chip;
- update-available banner;
- human-support offer card;
- FIDReC context card and contact form;
- confirmation card;
- toast, inline alert, persistent banner, modal, and full-page error;
- retry/reference-ID pattern;
- collaborator row and invitation card;
- WhatsApp affordance;
- Lumi help widget;
- legal/disclaimer callout;
- footer.

Every component should include default, hover, focus-visible, active, disabled, loading, success, warning, error, and high-contrast examples where relevant.

## 12. Accessibility and inclusive-design requirements

- Target WCAG 2.2 AA.
- Minimum 44×44 px touch targets; comfortable spacing for tremor and motor variability.
- Visible keyboard focus; logical tab and reading order.
- Semantic headings, landmarks, labels, descriptions, and error associations.
- Screen-reader live regions for upload status, saving, connection status, and progress-stage changes; avoid overly frequent announcements.
- Never auto-advance from a question while the user is reading or using assistive technology.
- Respect reduced motion; replace looping motion with static step indicators.
- Support browser zoom to 200% and text reflow without horizontal scrolling, except truly tabular report data with an accessible alternative.
- Do not rely on placeholder text as a label.
- Use plain language and explain abbreviations such as FIDReC, FI, MAS, IMDA, and SRF on first use.
- Provide “I’m not sure” and save-for-later options where uncertainty is legitimate.
- Use segmented Yes/No controls for required binary answers; never make unchecked mean an unexplained No.
- Avoid countdown pressure around payments or case decisions.
- Keep error summaries at the top of forms and move focus to them after failed submission.
- Charts or progress visuals require text equivalents.

## 13. Content and tone examples

### Preferred

- “Tell us what happened in your own words.”
- “You can change this later.”
- “We found a few details that would make your report clearer.”
- “Your document is still being read. You can continue with the questions.”
- “This is a preliminary pathway signal, not a final eligibility decision.”
- “Your payment and case information are safe.”
- “We could not complete that transition right now. Your saved story has not been deleted.”

### Avoid

- “You failed validation.”
- “Invalid case.”
- “Your claim is rejected.”
- “AI has decided…”
- “Success probability” presented as certainty.
- Raw `401`, `403`, `500`, JSON, database, or infrastructure language.
- “Just upload…” or language that minimises effort.

## 14. Responsive behavior

### Mobile

- Single task focus;
- sticky bottom primary action, above safe-area inset;
- one question at a time;
- report sections through a sheet/drawer;
- evidence and questions switch through accessible tabs;
- cards use full width without nested card clutter;
- transaction tables become labelled record cards or controlled horizontal scroll with frozen identifiers;
- persistent WhatsApp/Lumi controls must not cover primary actions.

### Tablet

- Adaptive one/two-column layouts;
- evidence rail can remain visible while questions change;
- report outline may collapse.

### Desktop

- Maximum readable text width;
- two-column gap workspace;
- three-region report workspace where useful;
- persistent journey context without excessive dashboard chrome.

## 15. Required design assets

Stitch should generate or specify:

1. GuideBuoy wordmark treatment and compact buoy mark if no approved asset is supplied;
2. public hero illustration/photo direction;
3. voice-recording states and waveform style;
4. pathway illustrations for bank, FIDReC, IMDA/telco, police, crypto/platform, and specialist support;
5. evidence/document thumbnails and file-type icons;
6. secure-processing/progress illustration set;
7. empty-state illustrations for cases, evidence, report, and collaborators;
8. success, waiting, warning, offline, access, and internal-error illustrations;
9. four-week tracker/timeline graphics;
10. report-preview mockups;
11. specialist consultation and case-pack visuals;
12. reusable icons for story, evidence, question, draft, payment, report, handoff, privacy, and support;
13. light and dark mode component previews, if dark mode remains supported;
14. desktop, tablet, and mobile mockups for every screen family;
15. a clickable prototype covering the primary happy path and the major error branches.

Avoid images containing text that should be live HTML. Avoid decorative imagery that competes with evidence, form, payment, or report content.

## 16. Prototype flows Stitch must connect

### Prototype 1 — primary happy path

Home story → sign up → case bootstrap → first document → processing → gap question → free draft → eligible upgrade → plan choice → payment success → analysis → drafting → report ready.

### Prototype 2 — FIDReC router path

Router intake → classification → questions → FIDReC waiting-period result → tracker active → tracker matured → build case.

### Prototype 3 — onboarding authentication failure

Signed-in client → case transition request fails → apology/recovery screen → retry succeeds → evidence upload. Demonstrate that the user is not silently returned home and no story is lost.

### Prototype 4 — document failure and recovery

Upload → document processing → corrupt/password-protected failure → retry/replace → ready → gap questions update.

### Prototype 5 — payment/report failure

Free draft → checkout → success → delayed payment confirmation → analysis → report failure → payment-safe recovery/support.

### Prototype 6 — Layer 3 / Tier 2

Report ready → help chooser → FIDReC form → validation error → corrected submit → confirmation → edit submission; plus specialist-consult and case-pack checkout branches.

## 17. Stitch delivery checklist

Deliver:

- design foundations/tokens;
- public shell and authenticated shell;
- complete component library with state variants;
- all screen families A–I;
- mobile 320/390 px, tablet 768 px, and desktop 1440 px key frames;
- happy-path prototype plus five recovery/branch prototypes;
- annotated dynamic rules and component conditions;
- copy deck for headings, instructions, validation, progress, success, and errors;
- asset export inventory and naming convention;
- accessibility annotations;
- implementation notes identifying shared components versus route-specific compositions.

## 18. Master prompt to paste into Google Stitch

Design a complete responsive web application for **GuideBuoy AI**, a Singapore-focused financial-dispute helper. The product helps a distressed consumer tell their story by typing or voice, identify the correct complaint route, upload and process evidence, answer targeted missing-fact questions, generate a free organised draft, optionally buy a full self-serve report, watch that report progress through background analysis and drafting, then read/export it or obtain FIDReC and specialist help.

Use a calm, trustworthy public-service visual language: deep blue `#1E3A8A`, warm amber `#F59E0B`, soft blue-grey `#F0F4F8`, dark slate `#1F2937`, highly legible Inter-style typography, rounded 12–16 px cards, generous spacing, clear focus states, and restrained motion. The experience must be trauma-aware, non-blaming, neuroinclusive, mobile-first, and WCAG 2.2 AA. It should feel like a humane case workspace, not a bank, law firm, chatbot, or generic SaaS dashboard.

Create one reusable design system and all dynamic screen variants. Include: public landing with type/voice story capture; product/about/marketplace/resources/FAQ/trust pages; sign-in/up preserving pending work; complaint router intake, classification, dynamic questions, bank-first result, IMDA/telco result, FIDReC-ready result, four-week-wait result, other-options result, crypto/overseas result, and a four-week tracker; authenticated case bootstrap success and recoverable failure; evidence-first upload with PDF/PNG/JPEG/DOCX validation; per-document pending/reading/verifying/organising/extracting/ready/failed states; two-column desktop and tabbed mobile gap-question/evidence workspace; free-draft generation and ready view; eligibility gate and missing-prerequisite state; plan comparison, secure-payment redirect, success, cancelled, and delayed-confirmation states; last-chance evidence update; reprocessing, analysing, drafting, slow, offline, and failed report states; full report hub with summary, timeline, transactions, totals, responsibility points, requested resolution, evidence, missing facts, disclaimers, version/update banner, copy/print/download/share actions; case dashboard and collaborators; post-report FIDReC/specialist help chooser; FIDReC contact form with read-only institution/loss context and editable contact, age, employment, 30-day, final-response, and optional-message fields; confirmed/failed contact states; SGD 99 specialist consultation and SGD 800 case-pack offers and checkout states; authentication expiry, access denied, case not found, internal error, offline, empty, loading, and reconnecting states.

Never silently redirect after an error or delete user work. A failed case transition must show an apology, reassure that the story is preserved, and offer Try again, Return home, and support. A failed paid report must reassure that payment and case data are safe. Use one primary action per state, plain Singapore-relevant language, explicit status labels, screen-reader-friendly progress, and responsive variants at 390 px, 768 px, and 1440 px. Produce design tokens, component variants, annotated screens, assets, and connected prototypes for the happy path, FIDReC waiting path, onboarding-auth failure, document recovery, payment/report failure, and specialist handoff.

## 19. Source-of-truth notes and open product decisions

This brief reconciles the canonical state-machine and integration documents with the currently visible website routes. Before final production design sign-off, product must lock:

- final Tier-1 report and bundle prices—the documentation contains evolving amounts;
- whether DOCX is fully supported in the production evidence processor;
- final naming: “Case Readiness Report,” “Full report,” and “Self-serve report” should become one consistent customer-facing term;
- whether the free draft auto-generates or always waits for an explicit confirmation CTA when guard conditions are met;
- notification behavior when background report generation continues after the user leaves;
- final PDF/export capabilities;
- exact specialist fulfilment, scheduling, refund, and service-level terms;
- legal-approved wording for FIDReC eligibility, adjudication, SRF, AI limitations, and outcome disclaimers;
- whether dark mode remains a supported public feature;
- whether Analytics and Coming Soon remain internal/legacy routes and should be excluded from consumer navigation.

Design these areas using replaceable tokens and modular content blocks so decisions can change without reworking the whole system.
