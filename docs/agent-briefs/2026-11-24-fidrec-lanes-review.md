# FIDReC pack update — review of the lane pull requests (#39–#51)

24 November 2026. Reviewed against brief v5 (`docs/agent-briefs/2026-11-20-agent-brief-fidrec-technical-records-and-standards-corpus.md`) and the lanes plan (`docs/agent-briefs/2026-11-23-agent-lanes-fidrec-update.md`).

Revised four times the same day with Elena's decisions. The decisions are in "Decisions" (items 1–12); what is still open is in "Still open". Brief v5 has not been changed yet: these decisions are to be folded into brief v6.

Reviewed at: `feat/fidrec-update` @ 7a791c5; `lane/corpus` f4ed1db; `lane/corpus-seeds` c96992b; `lane/sequence-fault` 96f9d3b; `lane/comparisons` 609a643; `lane/terms-schemes` d10ff74; `lane/evidence` af52288.

## How this was checked

- Read each lane's code and pull request description against the brief.
- Compared every changed file with the lane's ownership list.
- Merged all 13 branches into a scratch copy of `feat/fidrec-update` and ran the type check and the contract and release tests there.
- Cross-checked every clause key and statement key the rule code cites against the manifests and statement seeds.
- Ran all seven section builders together on the four synthetic cases.
- Scanned the changes for verdict wording and for real personal data.

Not checked, because the material is not reachable from the review session:

- Clause text against the source PDFs. The sources and verification sheets are in private storage on Elena's machine. This is Elena's verification step.
- The SQL tests and the "load twice changes nothing" test. They need a local database; the one database test was skipped in this run.
- The Visa and Mastercard draft statements against the rules' text.

## Summary

The agents followed the brief closely and stayed in their lanes. What exists now is a set of tested building blocks. It is not yet a pack: nothing is wired into the FIDReC pack (Lane 6 has not started), no document version is verified and no statement is approved.

| Check | Result |
|---|---|
| Files changed outside a lane's ownership | 0 |
| Files changed by two lanes | 0 |
| Merge conflicts when all 13 branches are merged | 0 |
| Type check on the merged result | Passes |
| Tests on the merged result | 757 run: 753 pass, **3 fail**, 1 skipped (needs a database) |
| CI on each pull request alone | Green, except one browser check on #48 (the PR adds one JSON file; re-run it) |
| Verdict wording in rule files and seeds | None found |
| Real personal data | None. IP addresses are documentation ranges; names are placeholders |
| Versions verified or statements approved by an agent | None. All drafts |

## Per lane

| Lane | PRs | Closeness to the brief | Main gaps |
|---|---|---|---|
| 1 Corpus | #40, #44–#51 | Very close | Remaining Phase 2 documents; EUPG card scope (decided: re-read every clause); embeddings; change detection; statements other lanes need |
| 2 Evidence | #42 (draft) | Close | Storage tables requested from Lane 1; dashboard panel; log scrubbing; new facts for the Section 8 check |
| 3 Comparisons | #41 | Close on logic and boundaries | Two of its three sections print nothing until keys are wired; EUPG 4.21 start date; three decided additions |
| 4 Sequence and fault | #39 | Close | Conduct comparison (decided: change it); two keys that do not match Lanes 1 and 5; "she/hers" (decided: neutral) |
| 5 Terms and card networks | #43 | Close on Visa; partial on the rest | Manifest format differs from Lane 1's loader; Mastercard 2026 and OCBC blocked; nothing loaded |
| 6 Assembly | #37 (Step 0 only) | Step 0 done well | Everything after Step 0 |

### Lane 1 — Corpus

Built as asked:

- The approval bug is fixed with an explicit `exclusion_clause_keys` column (migration `20261203120000`). A flagged clause must leave out the statement's payment types, so the flag cannot hide a clause that does apply.
- The loader checks the source file's hash and every clause hash before writing, writes drafts only, refuses a hosted database, and produces a verification sheet. Manifests hold keys, hashes and markers, no clause text.
- 11 documents, 336 clauses, all drafts: EUPG (138), SRF Guidelines (89), SRF workflow infographic (8), SRF consultation (1) and response (16), FSM-N05 (22), FSM-N06 (25), ABS card code (11), MAS reply of 7 Jan 2025 (11), ABS release of 17 Feb 2025 (9), FIDReC Terms of Reference v2.2 (6 selected rules).
- EUPG Section 4 card scope is set per clause as paragraph 4.1 says: only 4.2–4.6, 4.10–4.12 and 4.14–4.16 cover cards.
- 26 institutions; 49 rule citations by clause key (the free-text cites are kept as labels, which is a sound reading); 24 draft statements, each checked against the loaded text with a note where the wording changed.

Findings it made that the brief left open:

- FSM-N05's customer-information paragraph is paragraph 9 (`mas.fsm-n05/9`).
- EUPG 4.21, 6.4, 6.5 and Section 8 start on 16 June 2025, not 16 December 2024.
- EUPG 2.1's list of high-risk activities is non-exhaustive; the SRF's is closed.
- EUPG 4.9 sets no new-device alert for any account.

Issue:

- **EUPG Section 8 is scoped as not covering cards. Decided: re-read every EUPG clause for scope** (Decisions, item 3). The cause is the brief, not the lane.

Not done yet:

- From the Phase 2 table: FSM-N07 and FSM-N08; the Technology Risk Management Guidelines; the MAS–ABS releases of 19 Jan 2022, 2 Jun 2022, 9 Jul 2024 and 18 Sep 2024; the MAS replies of 13 Jan 2026 and 3 Feb 2026. The 13 January 2026 reply is now needed first (Decisions, item 5).
- Embeddings (needed only for the retrieval section, Phase 5).
- The monthly change check (3.2 rule 5).
- Statement seeds for the proposed keys (Decisions, item 9).
- Lane 5's manifests through the loader.

### Lane 2 — Evidence (#42, draft)

Built as asked: the two document types; all Phase 3b facts typed by the contract; a device reference, token reference or IP address is kept only when it appears in that line's own quoted words; the device screen; record lines linked to payments only where exactly one payment fits; IP lookup against a local database with no network call; export; draft privacy wording. The new facts are kept out of the free stage.

Open, all reported by the lane itself:

- Tables for IP ranges and per-case IP locations, requested from Lane 1.
- The dashboard's embedded confirm panel would show "1 fact left" with no card for the device question. This must be fixed before #42 reaches `main`.
- `scrubErrorText` leaves IPv6 addresses and device references partly visible in logs.
- The fact-reading version moves to v4, so every case is read again once (model cost).

Decided: the IP database and Singapore time (Decisions, item 10).

### Lane 3 — Comparisons (#41)

Built as asked: routing by instrument and by SRF scope; all nine 4a rows; both footnote 8 figures with a sliding 24-hour window; the 16 June 2025 gate; logins from further devices with `srf.newdevice.bank`; link statements once per section after a `differs` line on account payments and never for cards; every Phase 4 boundary test. `expected` is the clause text from the provider, never wording in code.

Issues:

1. **4b prints only its opening line for every bank.** The bank route has no clause key (`customerInformationClause: null`). Lane 1 has since loaded it: `mas.fsm-n05/9`.
2. **4c prints nothing.** All four clause keys are null. Two now exist: `abs.media_2025_02_card_provisioning/para4.verification` and `…/para4.removal`. The two token-activation checks have no source until the 2022 MAS–ABS releases are loaded. The 12-hour figure for token activation delay is written in code and must come from the release text once loaded.
3. **EUPG 4.21 before 16 June 2025.** The EUPG row prints for any date. For a payment before 16 June 2025 the clause is not in force, so the line prints with an empty Expected and a `clause_not_held` flag. It should print the date line the SRF row prints, or nothing.
4. **Business days.** The count is Monday to Friday with no public holidays. Decided: use a Singapore list (Decisions, item 11).
5. **The wallet statement never prints in a card-only case.** Decided: the 12-hour block and the wallet check (Decisions, items 4 and 5).
6. Each row prints twice when the case is in SRF scope (an SRF line and an EUPG line with the same record). Correct, but long: 31 lines for a three-payment case. Lane 6 can render one record with two clause references.

### Lane 4 — Sequence and customer fault (#39)

Built as asked: steps 1–9 with "The records provided do not show …" for a missing step; the `linked` / `not_shown` line; scheme lines by statement key only; definitions per framework and per payment date; the ABS / MAS-reply closing line; term requests resolved only through the as-of reads.

Issues:

1. **Conduct comparison (4g) can read as a verdict. Decided: change it** (Decisions, item 1). The lane maps `named → matches` and `not_named → differs`. Two lines from the synthetic cases:
   - "The complainant reported to the institution … 1 calendar day after the first alert" is `matches` against EUPG footnote 20 (the footnote's item is ignoring alerts).
   - "3 card payments authenticated by 3-D Secure with the digital token on the device labelled '…'. The complainant states that the device … is not hers" is `matches` against the MAS reply (a cardholder who unwittingly authenticates a 3DS transaction).
   No forbidden word appears, so the wording test passes, but the pairing implies a finding.
2. **The table of which conduct each document names is written in code** (`CONDUCT_FRAMEWORKS`): for example that entering credentials on a website is not named by EUPG footnote 20. It is marked for Elena's review, but it is not linked to the clause wording, so it does not follow decision 13.
3. **Two keys do not match what the other lanes created.**
   - `mas.reply_20250107/3ds` → Lane 1's key is `mas.reply.20250107/3(a).3ds`.
   - `mastercard.chargeback_guide/no_cardholder_authorization` → Lane 5's keys are `mastercard.chargeback_guide/dms.4837.issuer-chargeback` and `…/dms.4837.ineligible`.
   Until changed, those rows print "not held" even after the documents are loaded.
4. **Pronouns. Decided: one neutral form** (Decisions, item 2). Lane 4 prints "she" and "hers" (following the brief's examples); Lane 3 prints "they" and "theirs".
5. Step 8 links by device only; the brief's second route (the record states the payment was approved with that token) needs `tokenRef` on `AccessEvent`.
6. Facts labelled `not_sure` are used by Lane 4's sections and ignored by Lane 3's. One rule is needed.

### Lane 5 — Bank terms and card networks (#43)

Built as asked: the card dispute comparison per payment, Visa first, with the 120/121-day boundary; 33 Visa sections selected by the brief's six tests; 14 Mastercard sections from the 13 May 2025 edition; 14 draft statements that use the schemes' own short terms and no "cannot"; term-request rows for DBS, OCBC and UOB with selectors left as tags and outcomes left for a person.

Findings it made that the brief left open:

- Visa's all-region fraud reporting rule is section 1.9.4.3 (60 calendar days from the transaction date, or 30 days after the cardholder's notification).
- Who Visa's rules bind is section 1.1.1.5 in this edition.
- No Visa Secure section states who carries an authenticated payment; that is expressed through the "Invalid Disputes" list in 11.8.5.
- Mastercard's general wording is "may chargeback the transaction".

Issues:

1. **Manifest format.** Lane 5's manifests use its own format (one file per document, with `versions` and `sections`). Lane 1's loader expects one file per version with `markers` and `clauses`. Each lane's test asserts that every file in `supabase/standards/manifests/` is in its own format. Merged together, 3 tests fail:
   - `standards-loader.test.ts`: "every committed manifest is valid"
   - `standards-seeds.test.ts`
   - `card-dispute-checks.test.ts`: "manifests: documents and versions are drafts …"
   #40 and #43 alone are enough to fail the first.
2. **Nothing is loaded.** The loader was not on the integration branch when Lane 5 worked.
3. **Blocked sources:** the Mastercard 19 May 2026 Chargeback Guide, Mastercard Rules, and all three OCBC documents (the sites refuse automated downloads). Elena will download what she can in a browser.
4. **Term-request seed files** are `{ rows: [...] }`; Lane 4's parser expects a bare array. The rows themselves parse (22, 16, 22).
5. **Visa edition date.** Only the 24 October 2026 edition is held. Decided: fetch the earlier editions (Decisions, item 12).

The roll-up message says #43 can be merged "at any time". #43's own description says "Do not merge until Elena has reviewed", and it breaks the tests when merged beside Lane 1. Hold it.

## Cross-lane findings

These could not be seen by any single lane.

1. **3 failing tests when merged** (Lane 1 and Lane 5 manifest formats, above).
2. **Keys used in code that no lane has created:**

   | Key | Used by | State |
   |---|---|---|
   | `mas.reply_20250107/3ds` | Lane 4 | Wrong name; use `mas.reply.20250107/3(a).3ds` |
   | `mastercard.chargeback_guide/no_cardholder_authorization` | Lane 4 | Wrong name; use Lane 5's `dms.4837.*` |
   | `mas.fsm-n07/9` | contract | FSM-N07 not loaded |
   | `srf.highrisk.wallet`, `eupg.highrisk.wallet` | Lane 3 | Replaced (Decisions, item 9) |
   | `bridge.mas_requirement.cards` | Lane 3 | Agreed; statement to draft |
   | `bridge.card_loss_sharing` | Lane 4 | Agreed; statement to draft |

   Every other clause key and statement key cited in code resolves to a manifest or a seed.
3. **Three copies of the same helper** (Lanes 3, 4 and 5 each wrote a section writer). One pack would print dates three ways ("3 Jul 2025", "3 July 2025", "2025-09-12"), money two ways ("S$7,550.00", "SGD 7,550.00"), and "hers" beside "theirs". The standing sentence for card scheme rules is defined twice and prints in two sections.
4. **Sections that print nothing until wired:** 4b for banks, 4c entirely, the institution's own terms (no term requests passed in), and the scheme lines for any payment before the edition date.

## Not built yet (Lane 6 and later)

- The section registry in `fidrec-pack.ts`, the database-backed clause provider, rendering in the pack and the PDF.
- The comparison endings ("The document expects …") and the conduct section's own lines (Decisions, item 1).
- The verdict guard for model output and the prompt change (4h).
- Pinned citations per report (3.2 rule 4).
- The "Standards" section by retrieval (Phase 5).
- The bank pack's request line for missing technical records, and its Section 8 lines (Decisions, item 8).
- The "nearest version held" read (3.2 rule 6).
- End-to-end runs of the four synthetic cases.

## Decisions (Elena, 24 November)

### 1. Conduct comparison (4g): no `matches`, no `differs`

The section stops using the comparison outcomes. It prints, for each kind of conduct and each document, two separate things: what the record shows, and whether the document refers to that kind of conduct. Nothing joins the two.

**Lines, chosen by code:**

- "[Document] refers to [topic] in [clause reference] (R#)."
- "[Document] does not refer to [topic]."
- "[Document] has no test of the account user's conduct." (the SRF Guidelines)
- "The records provided do not show [X]." (unchanged)

**The topic is a neutral name for the kind of conduct, not a description of what this complainant did:**

| Marker | Topic printed |
|---|---|
| `credentials_entered` | entering credentials, card details or a code on a website or app |
| `credentials_given` | giving credentials, card details or a code to another person |
| `app_installed` | apps installed on the device |
| `card_payment_approved` | authenticating a card payment |
| `alerts_and_report` | notifications and alerts from the institution |
| `block_used` | blocking access |
| `police_report` | reporting to the police |

So the alerts line reads, for example: "The record shows 3 alerts, the first sent at [time]. The complainant reported to the institution on [date], 1 calendar day after the first alert. The E-Payments User Protection Guidelines refer to notifications and alerts from the institution in footnote 20 (R#)." It does not say the conduct is, or is not, the conduct the footnote describes.

**Card payments approved on a device the complainant does not recognise.** Where `device_recognition` for the approving device is `not_mine` or `not_sure`, or the record names no device, the section prints the record line and then: "The records do not show who approved these payments." It prints no "refers to" line for that marker. The MAS reply of 7 January 2025 is still set out in the definitions section (4d), as a document, without being paired with these payments.

Where the answer is `mine`, the "refers to" line prints as for any other marker.

**Rules for the build:**

- The conduct section does not emit `ComparisonLine`s with `matches` or `differs`, and never passes through the generic endings ("as the document expects" / "The document expects …").
- The contract's four outcomes stay as they are for the other comparison sections.
- Tests: the two synthetic lines quoted under Lane 4, issue 1, must come out in the new form; no conduct line contains "matches", "as the document expects" or "differs".

### 2. Pronouns: one neutral form

Every server-written line uses "the complainant", "they", "their" and "theirs". No "she", "her" or "hers". This applies to all sections and to the fixed wording in `CREDENTIALS_STATED`. Screens that speak to the user keep "you" and "your".

### 3. EUPG card scope: every clause is re-read

Elena checked paragraphs 8.3 and 8.4. They apply "where the disputed transaction is made using credit cards or other unsecured credit facilities". So Section 8 covers credit cards.

**The brief was wrong on this point.** Its list of EUPG paragraphs that cover cards (4.2–4.6, 4.10–4.12, 4.14–4.16) comes from paragraph 4.1, which is about Section 4 only. The brief wrote it as if it were the whole EUPG. Lane 1 followed the brief.

Elena's decision: the agent reads every clause of the loaded EUPG and sorts each by what it covers. The assignment is under "Assignment for Lane 1" below.

Until that is done and confirmed, the EUPG version is not marked verified. The acceptance line "a card-only case receives no EUPG paragraph outside 4.2–4.6, 4.10–4.12 and 4.14–4.16" is replaced by: no Section 4 paragraph outside those, no Section 5 paragraph, and no SRF loss-sharing clause.

### 4. The 12 hours after a digital token is activated: printed in every case

Wherever the record shows a digital token activated, the pack prints what the record shows in the following 12 hours, in card-only cases too, whether or not each activity is named in the SRF Guidelines or the EUPG. This replaces the single wallet statement.

**Where:** at the top of `duty_time_checks`, one block per token activation (and per new-device login for an account issued by a payment service provider). Heading: "The 12 hours after the digital token was activated".

**What it lists:** every activity the records show from the activation up to 12 hours after it, each with its time, the gap from the activation, the device as recorded and the evidence ID.

- Listed as activities: logins, device registrations, payees added, limits changed, notifications disabled, contact details changed, a card added to a mobile wallet, card payments, payments from the account, and any other dated line in the record.
- Not listed as activities: the institution's own messages (alerts and one-time codes sent). They stay in the sequence and alert rows.

**Two groups, with these headings:**

1. "Activities the definitions name": adding payees, increasing transaction limits, disabling transaction notifications, changing contact details.
2. "Other activities the record shows in the 12 hours".

**Then the documents, as reviewed statements.** Both definitions print in every case, including card-only cases and account cases outside SRF scope:

- The SRF definition (closed) and paragraph 4.2.1.
- The EUPG definition ("include, but are not limited to") and paragraph 4.7.
- For card payments: the sentence that paragraph 4.7 is in Section 4, which under paragraph 4.1 does not apply in respect of cards except the listed paragraphs.
- Where the record shows a card added to a wallet: a pointer to the wallet check (item 5).

**Rules for the build:**

- The block carries no comparison outcome and no link statement. It says nothing about whether any activity should have been possible.
- For account payments the existing cooling-off comparison rows stay as they are (a named activity inside the 12 hours is `differs`, with the link statement).
- The pack does not call any activity "high-risk" or "potentially high-risk" in its own words. Those words appear only inside a document's own wording.
- The Phase 4 gate "a card payment never gets an EUPG 4.7 line" becomes: a card payment never gets a *comparison* against EUPG 4.7. The block cites 4.7 and the definitions as statements, with the card sentence beside them.
- Tests: the synthetic card-only case prints the block with the wallet line (22 minutes) and the three card payments in group 2; the account case prints the payee in group 1; a case with no token activation prints no block.

### 5. Wallet check: a fixed rule, beside the SRF, EUPG and ABS checks

Wherever the record shows a card added to a mobile wallet, the pack prints a fixed group, "Card added to a mobile wallet", in card-only cases and mixed cases alike. Built in `rules/industry-practice-checks.ts`, which already holds the wallet rows.

**Record line (once, above the group):** "The record shows the card ending [last four] added to a mobile wallet at [T2] on a device labelled '[label]', authorised by [method] (E6). The record shows a digital token activated at [T1] on a device labelled '[label]' (E4), [gap] before." Where the record shows no token activation, the second sentence is left out.

**Part A — the institution's own published practice (comparison, with an outcome).**

- Source: that institution's own page on adding its cards to mobile wallets, loaded as a versioned institution document (item 7), in the version for the date the card was added. Quoted, attributed, with the capture date.
- Read through a new term request, purpose `wallet_provisioning`. A person records on the request row what the page states: the waiting period after the digital token is set up (hours, or none stated), the authentication it says is required to add a card, and the date from which it applies.
- Outcome, chosen by code:
  - the page states a waiting period and the card was added sooner than that after the token activation → `differs`;
  - added after it → `matches`;
  - the page states the authentication required from a date, and the record shows another method on or after that date → `differs`; the same method → `matches`;
  - the record does not show the time or method → `not_shown`;
  - the card was added before the page's stated start date → `not_applicable`, printing both dates;
  - no page held for that institution → "[Institution]'s published practice on adding cards to mobile wallets is not held."
- **One institution's page is never set against another institution.** UOB's page prints only in a case against UOB.
- No link statement follows. The page is not a requirement imposed by MAS.

  UOB's page, as read on 24 November 2026 (the pack quotes from the loaded copy, not from this note):
  - "From 1 July 2025, authentication through SMS One-Time-Password (OTP) when you add your UOB Mastercard or Visa Card(s) to your mobile wallets (for payments using Apple Pay, Google Pay and Samsung Pay) will be progressively changed to Digital Token Authentication via the UOB TMRW app to protect you against potential scams."
  - "You will need to set up your digital token prior to adding your UOB Cards into your mobile wallet. For security purposes, you will only be able to activate and use your digital token for transaction verification after 12 hours."
  - "To protect customers against unauthorised tokenisation, you must: Set up the TMRW Digital Token and complete the 12-hour cooling-off period; and Verify the card within 5 days of adding it to the mobile wallet."
  The page shows no date of its own.

**Part B — the MAS written reply of 13 January 2026 (quoted, no outcome).**

- Printed in every case where a card was added to a wallet, whatever the bank and whatever the date (item 6).
- Form: "In a written reply to Parliament on 13 January 2026, MAS stated:" followed by the two sentences printed word for word from the loaded reply, with its clause reference and link. As read on 24 November 2026:
  - "We are progressively discontinuing SMS OTPs in higher-risk banking activities and transactions, including for the provisioning of credit cards to mobile wallets, because SMS OTPs are more readily obtained and abused by scammers."
  - "Banks will also introduce additional safeguards this year, such as additional cooling periods for higher-risk activities and in-app notifications to help customers verify that an incoming call is indeed from the bank."
- It carries no outcome: the reply sets no duty and no date to compare the record with.

**Part C — the ABS media statement of 17 February 2025 (comparison, existing 4c rows).** Verification beyond the SMS one-time code, with "completion expected by July 2025"; removal of the provisioned card. Unchanged from the brief.

**Part D — pointers.** "The definitions of high-risk activities in the SRF Guidelines and the E-Payments User Protection Guidelines are set out under 'The 12 hours after the digital token was activated'." For card payments: "How a loss on a card is shared is in the ABS Code of Practice for Banks – Credit Cards and the issuer's own terms" (the `bridge.card_loss_sharing` statement).

**Tests:** a synthetic UOB-coded case with a card added 22 minutes after token activation prints Part A as `differs` with both times; the same record for an institution with no page held prints "not held" and still prints Parts B and C; a 2025 event prints Part B with the "after the events" line of item 6.

### 6. Which documents follow the payment date, and which do not

Elena's decision: the rule "only a document in force on the date of the event" applies to regulatory text, not to replies and clarifications.

| Kind of document | Rule |
|---|---|
| Guidelines, notices, circulars, industry codes, the institution's terms and published pages, card scheme rules, FIDReC's rules | The version in force on the date of the event. Unchanged |
| Announced measures with a start date (ABS and MAS–ABS releases) | Printed with the start date; a measure that starts after the event prints as `not_applicable` with both dates. Unchanged |
| MAS written replies and other official clarifications | Printed whatever the date of the event, always with the reply's own date |

For a reply dated after the events, the line adds: "This reply is dated [date], after the events in this case." This is a fact about the document and was added in this review; Elena confirms it with the agents.

Build: a marker on the document (for example `as_of_rule = 'any_date'` on `standard_documents`, set only for replies and clarifications). Statements that rest only on such documents are read as of the day the pack is generated. This applies to `mas.reply.20250107.*` as well as the 13 January 2026 reply. Tests: a 2025 payment prints the January 2026 reply with the "after the events" line; an EUPG clause that starts on 16 June 2025 still never prints for an earlier event.

### 7. Banks' own pages on adding cards to mobile wallets: versioned documents

**What these are.** Pages on a bank's website (help, FAQ or announcement pages) that say how adding that bank's card to Apple Pay, Google Pay or Samsung Pay works: which approval is needed, from what date, and any waiting period. They are separate from the account terms and the card agreement. They are the bank's published description of its own process, not contract terms, and the pack labels them that way: "[Institution]'s published page '[title]', as captured on [date]".

**Decision.** Load them as versioned institution documents, like the banks' terms. Order: **DBS first, then OCBC, then UOB.** Other institutions follow as cases need them.

**How a web page is versioned:**

- One document per page, with its own key (for example `dbs.wallet_provisioning`, `ocbc.wallet_provisioning`, `uob.wallet_provisioning`), `binding_level` for a published page (a new value, so it is never printed as a contract), and the institution's code.
- Each capture whose text differs from the one before is a version: capture date, URL, file hash, and `provenance` of `publisher_site` (captured by us) or `web_archive` (with the archive's capture date).
- Captures are collected back to **1 October 2025** (item 12), plus the last one before that date.
- For an event, the pack uses the latest version captured on or before the event. Where none is held that early, it says so and shows the nearest version with its date (3.2 rule 6).
- Where the page itself states a start date ("From 1 July 2025"), that date is recorded on the `wallet_provisioning` request row, not as the version's date.
- Clause per question or paragraph; quoted (`quote_mode = quote`); the monthly change check covers these pages.
- The source files stay in private storage; the repo holds keys, hashes and links only.

**What was read on 24 November** (today's pages only):

| Institution | Page | What it says about adding a card to a wallet |
|---|---|---|
| DBS | Cooling period for selected digibank transactions | 12 hours for new payees, limit increases and contact changes. Wallets not mentioned. A press report (23 Feb 2026) describes a separate in-app switch that must be turned on before adding a card to a wallet. The agent finds DBS's own page for that switch |
| OCBC | Cooling-off periods; "Adding card to mobile wallet" help page | The cooling-off page is general. The help page was not read; OCBC's site refuses automated requests, so it may need a browser capture |
| UOB | Mobile wallet digital token authentication | The three passages quoted under item 5, Part A |

### 8. New check: EUPG Section 8, charges and credit records while a transaction is disputed

Elena's decision: add it to the FIDReC pack, and print what Section 8 says in the bank pack too. Section 8 took effect on 16 June 2025 (paragraph 1.5).

What Section 8 says, as read on 24 November (the rule reads each paragraph from the loaded text):

| Paragraph | The institution should | During |
|---|---|---|
| 8.1 | withhold or waive the requirement to settle the disputed amount and the charges directly relating to it | until it completes its investigation |
| 8.2 | the same, where it has assessed the transaction as authorised or the account holder as liable and the account holder does not agree | (a) from completing the investigation to 30 calendar days after informing the account holder; (b) from when it is aware that dispute resolution with FIDReC has started until FIDReC completes or closes the case |
| 8.3 | for credit cards and other unsecured credit facilities, ensure credit bureau records are not adversely affected | until it completes its investigation; and, where non-payment was already reported, after the account holder is found not liable |
| 8.4 | the same, where the account holder does not agree with the assessment | the periods in the text. Lane 1 confirms the wording of 8.4(b) from the loaded text before it is coded |
| 8.5 | may resume reporting unpaid amounts | after those periods, if not repaid 7 calendar days from its request |
| Footnotes 26, 27 | is not obligated to do so | where the transaction is outside the scope of unauthorised transactions in footnote 4 |

**New document type (Lane 2): `credit_bureau_report`.** Optional. It is never required to buy or to generate a pack, and it is not part of the evidence check. The checklist lists it as a suggestion for credit card cases. Without it the credit-record rows read from the institution's letters or the complainant's own statement, or print `not_shown`.

**New facts (Lane 2):**

- `disputed_amount_payment_requests`: each request by the institution to pay the disputed amount, with its date (statements, reminders, letters).
- `charges_on_disputed_amount`: each late fee, interest or other charge directly relating to the disputed transaction, with date and amount (statements).
- `credit_bureau_reports`: each report of non-payment of the disputed amount to a licensed credit bureau, with date. Sources: a credit bureau report, the institution's letters, or the complainant's own statement, labelled as such.
- `fidrec_dispute_dates`: when dispute resolution with FIDReC started, when the institution was told, and when it was completed or closed.

**FIDReC pack — new rule file (Lane 3):** `rules/dispute-charges-checks.ts`, section `disputed_amount_charges`, printed after `duty_time_checks`. One row per paragraph, in the usual form: Record, Expected, and `differs` / `matches` / `not_shown` / `not_applicable`. Each charge, request or report is placed in its period by date.

- An event before 16 June 2025 → `not_applicable`, printing the date.
- 8.3 and 8.4 print only for credit cards and other unsecured credit facilities.
- Footnotes 26 and 27 print as a statement wherever the institution's reply says the transaction was authorised. The pack does not say whether the footnote applies.
- No link statement follows: Section 8 is not a Section 4 duty.

**Bank pack (Lane 6).** For a dispute reported on or after 16 June 2025, the bank pack prints what Section 8 says, as reviewed statements with the paragraph references and link:

- `eupg.section8.charges` in every such case;
- `eupg.section8.credit_records` where a disputed payment was made with a credit card or other unsecured credit facility;
- `eupg.section8.outofscope` after either.

The lines state what the Guidelines say. They do not say what the institution has or has not done, and they make no demand in the pack's own words. Wording is in item 9.

**Privacy:** a credit bureau report is a new category of personal data. It goes into the draft privacy wording and into export and deletion before release. Fixtures are synthetic.

### 9. Statement keys

Agreed keys. Elena confirms the wording with the agents; Lane 1 checks each against the loaded text and records where it differs; Elena approves after the versions are verified.

| Key | Prints | Draft wording |
|---|---|---|
| `srf.highrisk.definition` (replaces `srf.highrisk.wallet`) | 12-hour block | "Paragraph 2.1 of the SRF Guidelines says 'high-risk activities' means adding payees, increasing transaction limits, disabling transaction notifications and changing contact information. Paragraph 4.2.1 sets a cooling-off period of at least 12 hours, when a digital security token is activated on a device, in which high-risk activities cannot be performed." |
| `eupg.highrisk.definition` (replaces `eupg.highrisk.wallet`) | 12-hour block | "Paragraph 2.1 of the E-Payments User Protection Guidelines says 'high-risk activities' 'include, but are not limited to' adding payees, increasing transaction limits, disabling transaction notifications and changing the account holder's contact information. Paragraph 4.7 sets a cooling off period of at least 12 hours, when a digital security token is activated on a device, in which high-risk activities cannot be performed. The Guidelines do not name any other activity." |
| `eupg.section4.cards` (new) | 12-hour block, card payments | "Paragraph 4.7 is in Section 4 of the Guidelines. Under paragraph 4.1, Section 4 does not apply in respect of credit, charge or debit cards, except paragraphs 4.2 to 4.6, 4.10 to 4.12 and 4.14 to 4.16." |
| `mas.reply.20260113.wallet` (new) | Wallet check, Part B | "In a written reply to Parliament on 13 January 2026, MAS stated:" followed by the two sentences from the loaded reply |
| `eupg.section8.charges` (new) | Bank pack | "Section 8 of the E-Payments User Protection Guidelines has applied since 16 June 2025. Paragraph 8.1 says that where an account holder reports a suspected unauthorised transaction, the institution should withhold or waive the requirement to settle the disputed amount and the charges directly relating to it until it completes its investigation. Paragraph 8.2 says the same, where the account holder does not agree with the institution's assessment, for 30 calendar days after the institution informs the account holder of the outcome, and while dispute resolution with FIDReC is under way." |
| `eupg.section8.credit_records` (new) | Bank pack, credit cards and other unsecured credit | "For a disputed transaction made using a credit card or other unsecured credit facility, paragraphs 8.3 and 8.4 say the institution should ensure that the account holder's credit records with licensed credit bureaus are not adversely affected because of the disputed transaction, during the periods those paragraphs set out." |
| `eupg.section8.outofscope` (new) | Bank pack; Section 8 check | "Footnotes 26 and 27 say the institution is not obligated to do so where the disputed transactions do not fall within the scope of unauthorised transactions set out in footnote 4." |
| `bridge.mas_requirement.cards` | Opening of the MAS notice section, card payments | "Section 5 of the E-Payments User Protection Guidelines does not apply to credit, charge or debit card transactions (paragraph 5.1). The responsibility sharing in the Shared Responsibility Framework Guidelines does not apply to transactions on credit, charge and debit cards issued in Singapore (footnote 1)." |
| `bridge.card_loss_sharing` | After the card scheme lines; wallet check, Part D | "For card payments, how a loss is shared between the card issuer and the cardholder is set out in the ABS Code of Practice for Banks – Credit Cards (paragraphs 5 and 6) and in the issuer's own terms." |

### 10. IP location database (#42)

- Provider: **DB-IP Lite** to start (city and network owner; no accuracy radius and no VPN or hosting flag). Before any download the agent reads the provider's current licence page and reports the terms; the terms in the shortlist came from the lane's notes.
- The attribution the licence requires is printed with the lookups in the pack and named in the privacy policy.
- The copy is refreshed monthly. A pack keeps the lookup result and the database date it was generated with.
- Record times given without a time zone are read as Singapore time.
- The privacy wording in `docs/legal/drafts/privacy-technical-records.md` is approved in principle, with the provider's name filled in and the credit bureau report added (item 8).

### 11. Public holidays for the business-day count

- Source: the Ministry of Manpower's published list of Singapore public holidays, including the following Monday when a holiday falls on a Sunday.
- Years held: from 2024 to the current year plus one; added each year when the list is published.
- A business day is Monday to Friday, less those holidays. The line keeps saying how the days were counted.
- Elena approves the list the lane commits (dates and source link).

### 12. Earlier versions: collect back to payments from 1 October 2025

Elena's working assumption: the real cases have payments from 1 October 2025 onward.

- **Visa.** Fetch from a web archive every edition of the Visa Core Rules in force between 1 October 2025 and 24 October 2026. Visa publishes about every April and October, so this is expected to be the April 2025, October 2025 and April 2026 editions. The agent confirms each edition's date from the copy itself and reports any edition the archive does not hold. Each is loaded with `provenance = web_archive` and the archive's capture date, with the same selected sections as the 24 October 2026 edition.
- **Mastercard.** The 13 May 2025 Chargeback Guide is held. The agent lists every edition published after it up to the 19 May 2026 edition and fetches what the archive holds; the 2026 edition and the Mastercard Rules wait for Elena's browser download.
- **Bank terms and wallet pages.** The versions in force from 1 October 2025, plus the last version before that date.
- **Scheme statements** are checked against each edition they are approved for; a statement approved for one edition does not print for another until reviewed for it (3.2 rule 8).
- A payment before the earliest edition held still gets the fallback of 3.2 rule 6. Elena confirms the fallback wording with the agents.

## Assignment for Lane 1: sort every EUPG clause by what it covers

Paste-ready.

> Read every clause of the loaded E-Payments User Protection Guidelines (16 December 2024 version, 138 clauses) and decide, from the text alone, what each covers. Do not use the list in brief v5; it is about Section 4 only.
>
> Sort each clause into one of these:
> 1. Protected accounts only: bank accounts and e-wallets. Cards are left out by the text.
> 2. Protected accounts and cards.
> 3. Credit cards and other unsecured credit facilities specifically (for example 8.3, 8.4, footnote 27).
> 4. Definitions and general paragraphs that apply wherever their term is used.
>
> For every clause in group 1, name the paragraph that leaves cards out (4.1, 5.1, 7.8, or another you find). A clause is in group 1 only if the text says so.
>
> Deliver:
> - A table outside the repo, in the standards review folder: clause key, proposed group, the words of the text that decide it, and the deciding paragraph. Elena confirms it against the verification sheet.
> - After she confirms: `instrument_scope` and a short note per clause in the manifest, with no clause text.
> - A list of every rule citation and statement whose scope changes as a result.
>
> Report separately: the data model has no payment type for "other unsecured credit facilities" (a credit line that is not a card). Say which clauses name them and propose whether a type is needed. Elena decides.
>
> Do the same read for the SRF Guidelines' footnote 1 and confirm it is the only place that leaves cards out.

## What the documents say about adding a card to a mobile wallet

Read on 24 November 2026. Quoted phrases are the documents' own.

| Document | What it says | Waiting period for adding a card? |
|---|---|---|
| EUPG (16 Dec 2024), 2.1 | "high-risk activities" "include, but are not limited to" adding payees, increasing transaction limits, disabling transaction notifications, changing contact information | Not named. The list is open |
| EUPG 4.7 | A cooling off period "of at least 12 hours where high-risk activities cannot be performed … when a digital security token is activated on a device" | Only for "high-risk activities" |
| EUPG 4.1 | Section 4 does not apply in respect of credit, charge or debit cards, except 4.2–4.6, 4.10–4.12, 4.14–4.16 | 4.7 is not in the list |
| SRF Guidelines, 2.1 and 4.2.1 | A closed definition with the same four activities (as read for the brief) | Not named. The list is closed |
| ABS Code of Practice for Banks – Credit Cards (rev. 2 Jul 2020) | Nothing on mobile wallets, on Lane 1's reading of all 11 paragraphs. Not re-read for this review | No |
| ABS media statement, 17 Feb 2025 | Banks "will require additional verification such as in-app controls or digital token authentication for provisioning cards onto mobile wallets", "with completion expected by July 2025"; banks will remove provisioned cards "if there are indicators of fraudulent activity" | No. No statement on liability |
| MAS written reply, 13 Jan 2026 | The two sentences quoted under Decisions, item 5, Part B | Not specific. No duration given |
| ABS release on safeguards from 15 Oct 2025 | Fraud surveillance on digital banking transactions (S$50,000 balance, more than 50% out in 24 hours). Cards and wallets not mentioned, on the press report read | No |
| The banks' own pages | See Decisions, item 7 | UOB: yes, 12 hours after the digital token is set up. DBS, OCBC: not stated on the pages read |

## Still open

Elena confirms these with the agents directly:

1. The fallback wording for card scheme rules where the edition in force on the payment date is not held: "This pack does not hold [scheme]'s rules as in force on [payment date]. The nearest edition held is dated [date]. The lines below are from that edition."
2. The wording of the statements in Decisions, item 9.
3. The "after the events" line on later-dated replies (item 6).
4. The EUPG scope table, and whether a payment type is needed for "other unsecured credit facilities", when Lane 1 reports.

With Elena:

5. Browser downloads: the Mastercard Chargeback Guide dated 19 May 2026, the Mastercard Rules, the three OCBC documents, and OCBC's page on adding a card to a mobile wallet if the agent cannot capture it.

## Merge recommendation (all into `feat/fidrec-update`)

1. #40, with "Create a merge commit".
2. #44–#50 in any order, merge commits. Re-run the failed browser check on #48 first.
3. #51.
4. #39 and #41: safe to merge; they add new files only and the merged tests pass with them. The decided changes follow as fixes; nothing prints from these files until Lane 6 wires them in.
5. **Hold #43** until its manifests are converted to the loader's format, or moved out of `supabase/standards/manifests/` until they are.
6. **Hold #42** (draft) until the dashboard panel is fixed and the Section 8 facts are added or split into a follow-up.

Merging does not approve any statement or verify any version. None of this touches `main`, staging or production, so Gate B can go on separately.

## Fix list for the agents

The lanes plan needs two additions before this work starts: `rules/dispute-charges-checks.ts` under Lane 3, and the section `disputed_amount_charges` in the contract's section order (Lane 6).

- **Lane 1:** the EUPG scope assignment above; a marker for replies and clarifications (item 6); a document level for a bank's published page and the `wallet_provisioning` purpose on term requests (items 5 and 7); load the MAS reply of 13 January 2026 first, then the 2022 MAS–ABS releases, FSM-N07/N08 and the rest of the Phase 2 table; draft the statements in item 9; add the IP tables Lane 2 asked for; run Lane 5's converted manifests.
- **Lane 2:** the four Section 8 facts and the optional `credit_bureau_report` document type (item 8); the DB-IP adapter after the licence check (item 10); the credit bureau report in the privacy draft, export and deletion.
- **Lane 3:** the 12-hour block (item 4); the wallet check (item 5); `rules/dispute-charges-checks.ts` (item 8); the public-holiday list (item 11); wire `mas.fsm-n05/9` and the two ABS release keys (through Lane 6's contract update); fix the EUPG 4.21 row before 16 June 2025; remove the single wallet statement.
- **Lane 4:** rebuild the conduct comparison (item 1); neutral pronouns throughout (item 2); replace the two keys.
- **Lane 5:** convert the manifests to Lane 1's format (one file per version, `document`, `version`, `extraction`, `markers`, `clauses`); change the term-request seeds to a bare array or agree the wrapper with Lane 4; run the loads on a local database. Then, in this order: the banks' wallet pages as versioned documents, DBS, OCBC, UOB (item 7), each with a `wallet_provisioning` request row left for a person to confirm; the earlier Visa editions and the Mastercard editions (item 12); bank terms back to 1 October 2025.
- **Lane 6:** one shared writer and one format for dates, money and pronouns (item 2); a line kind that carries no outcome, for the conduct section, the 12-hour block and quoted replies (items 1, 4, 5); reads that follow item 6; one rule for which fact labels a section may use; update `contract.ts` with the agreed keys, the new facts and section, `tokenRef` on `AccessEvent` and `amount` on `CardAuthEvent`; the nearest-version read; the Section 8 lines in the bank pack (item 8); reword the Phase 4 gate and the acceptance line (items 3 and 4); then assembly.
- **Release agent (`main`, after the update merges):** list the credit bureau report on the documents checklist as a suggestion for credit card cases. It never blocks buying or generating.

## Sources read for the revisions

- [E-Payments User Protection Guidelines, with effect from 16 December 2024 (MAS)](https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidelines/pso/e-payments-user-protection-guidelines-with-effect-from-16-dec-2024/e-payments-user-protection-guidelines-with-effect-from-16-december-2024.pdf)
- [MAS written reply, 13 January 2026, on requirements imposed on banks to protect consumers from scams](https://www.mas.gov.sg/news/parliamentary-replies/2026/written-reply-on-effectiveness-of-requirements-imposed-by-mas-on-banks-to-protect-against-scams)
- [ABS media statement, 17 February 2025, on card provisioning scams](https://www.abs.org.sg/docs/library/major-card-issuing-banks-to-step-up-measures-to-combat-card-provisioning-scams.pdf)
- [MAS Annual Report 2025/2026, MAS' anti-scam measures](https://www.mas.gov.sg/publications/annual-report/2026/annual-report-2025-2026/responsible-and-trusted-financial-centre/mas-anti-scam-measures)
- [UOB: mobile wallet digital token authentication](https://www.uob.com.sg/personal/cards/services/mobile-wallet-digital-token-authentication.page)
- [DBS: cooling period for selected digibank transactions](https://www.dbs.com.sg/personal/support/general-digibank-security-cooling-period.html)
- [Standard Chartered Singapore: cooling period](https://www.sc.com/sg/important-information/cooling-period/)
- [OCBC: cooling-off periods](https://www.ocbc.com/personal-banking/security/secure-banking-ways/cooling-off-periods.page)
- [Fintech News Singapore, 23 February 2026, on DBS's 12-hour cooling period](https://fintechnews.sg/126691/security/dbs-cooling-period/)
- [Malay Mail, 3 October 2025, on the banks' safeguards from 15 October 2025](https://www.malaymail.com/news/singapore/2025/10/03/singapore-banks-tighten-scam-defences-with-24-hour-cooling-off-period-on-risky-transactions-from-oct-15/193301)
