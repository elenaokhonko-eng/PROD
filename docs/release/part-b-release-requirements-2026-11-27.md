# Part B release (#121): findings, fixes and final requirements

Written 27 Nov 2026, 21:00 Singapore time, for Elena and the coding agent. Section 8 added at 22:15, section 9 at 23:45, section 10 at 01:00 on 28 Nov, section 11 later on 28 Nov. It consolidates the Part B register, CR-2 and the decisions of 25 to 27 Nov. Where this file and an older one differ, this file is the requirement.

No case data: IDs, counts and synthetic test names only.

## 1. Where the release stands

| Item | State |
|---|---|
| Branch and PR | `release/part-b-fixes`, draft PR #121 into `main`, head `b6be3f3`, no conflicts with main |
| Size | 60 commits and 105 files ahead of main |
| Staging | Web app, worker and three Edge functions on `b6be3f3` |
| Database | Two new migrations applied to staging only |
| Gate | Run 1 of 3 in progress on `b6be3f3` (run 45997584720): six jobs passed, signed-in job running |
| Production | Untouched. Still on main at `0994bc5`. FIDReC packs are not on sale there |

Gate history on this batch: nine manual runs since 25 Nov. Two passed in full (both on `9b8a813`). The others stopped on one machine fault, three test faults, two app faults in the FIDReC route question, one unexplained mobile Safari failure (KI-1, waived once), and one app fault in the FIDReC pack (section 3, G-3).

## 2. What is left before production

In order. Each step needs the one before it.

1. Three gate runs in a row pass on one commit.
2. Elena's re-test on the shorter sheet, starting with the long-document check (step 3.1). Check step D.8 by hand whatever the gate says.
3. Elena merges #121 into main. The 12 separate draft PRs are closed unmerged.
4. Before production, four open questions are answered (section 7).
5. Elena approves both migrations for production. They are applied before the production deploy.
6. Production deploy: web app, worker and the changed Edge functions.
7. The free evaluation test set is re-run, because its checks changed.

Production is a separate decision by Elena. Nothing in this file is that decision.

## 3. Findings and fixes

Status values: **In batch** means the fix is in #121. **Update** means it goes with `feat/fidrec-update`. "Reported" means the agent states it and it has not been re-checked by hand.

### 3.1 First walk-through, 25 Nov (staging `0994bc5`)

| ID | Finding | Fix | Status |
|---|---|---|---|
| PB-1 | A bank named on a statement did not count as shown | The issuing bank of a statement or letter counts as shown | In batch |
| PB-2 | Confirming facts before the last document left the paid step silent, then refused the first press | A document read after confirming returns the person to their facts | In batch. Re-test step A.3 failed on 26 Nov and is not yet explained; check again |
| PB-3 | The screen did not name what was missing | Wording approved by Elena | In batch |
| PB-4 | The bank pack offer named only the SRF | Wording approved by Elena | In batch |
| PB-5 | Two packs on one page looked like one report shown twice | Each pack is labelled | In batch. Step A.8 not yet tested |
| PB-6 | "Consultation unavailable" under a line saying how to book | Button removed | In batch |
| PB-7 | The FIDReC duties did not say whose rule each point is | Verified sources replace the old source store | Update |
| PB-8 | A bank letter about a different payment counted as proof | Demote only when it names a different payment | Update |
| PB-10 | Dates in machine format | Dates read "3 Oct 2026" | In batch |
| PB-11 | System values in the text ("sg_card") | Written in words ("Card payment") | In batch |
| PB-12 | Citations printed twice | Printed once | In batch |
| PB-13 | Whose date the FIDReC deadline is counted from | The line names the letter and its evidence number, and "(six months after the final reply)" | In batch |
| PB-14 | FIDReC PDF layout | Cosmetic | Not scheduled |
| PB-16 | Paid pack buttons on the pricing page were outlined | Filled | In batch |
| PB-17 | The FIDReC route question could not show its answer or be changed | Replaced by the timeline questionnaire (section 4.3) | In batch |
| PB-18, PB-19 | The pricing button led to the story page; two question sets on one screen | Replaced by CR-2 (section 4.1). PR #118 is not used | In batch |
| PB-20 | The same file could be uploaded twice | Refused: "You have already added this file to your case." | In batch |
| PB-21 | A document matching no item was silent | Wording approved by Elena | In batch |
| PB-22 | A document marked by hand as the police report was not used by the facts | Read as that kind and named "a document identified by the complainant as a police report" | In batch. Finding R-8 remains |
| PB-23 | The FIDReC duties ignored the scam type | Note before the duties, wording chosen by Elena | In batch |
| PB-24 | The "Filing with FIDReC" section ignored a confirmed final reply | Deadline from the confirmed final reply; a clash between an answer and a letter is put to the person | In batch |
| PB-25 | An unsigned acknowledgement was filed as a letter from the bank | A bank letter must come from a bank | In batch |
| PB-26 | Three card payments became one | A total is not a payment | In batch |

### 3.2 Rules review, 25 Nov (wording against the source text)

| ID | Finding | Fix | Status |
|---|---|---|---|
| Row 6 | The SMS line said the bank assesses the mobile operator's part | "Your bank is your point of contact and passes the claim to the operator, which investigates its own duties. If you disagree with the operator's assessment, you can write to IMDA." | In batch |
| Rows 8, 11 | "Not covered by a liability framework" for payments made knowingly | "Under the EUPG, the account holder is liable for payments an account user knew of and consented to, up to the agreed limits (paragraph 5.3). You can complain to your bank in writing." | In batch |
| Row 8 | The FIDReC sentence had no source | "MAS's workflow for the SRF states that FIDReC's assessment includes obligations outside the SRF, for example under statute, common law or the EUPG." | In batch |
| Row 18 | The SMS line did not say which operators | "The SRF applies to four mobile network operators only: Singtel, M1, StarHub and SIMBA. It does not apply to other mobile providers." | In batch |
| Row 19 | The court route was not mentioned | "MAS and IMDA's Response to Consultation also states that scam victims can pursue civil claims against the relevant entities through the courts (paragraph 6.11(d))." | In batch |
| Row 20 | The card line's last sentence was not from the ABS code | MAS's written reply of 7 January 2025 on 3DS, quoted, with what 3DS is | In batch |
| Row 21 | The pack did not know FIDReC's earlier route | Rule 13(1)(i) is part of the questionnaire's logic (section 4.3) | In batch |
| Row 22 | Nothing was said to a person whose final reply is over six months old | Two-dates sentence and the Rule 13(2) passage (section 5) | In batch |
| Row 27 | FIDReC Rule 5(iv), police investigation, was not mentioned | "Police investigation" section, CR-1 | Update (merged there as #123) |

### 3.3 Gate runs, 25 to 27 Nov

| ID | Finding | Fix | Status |
|---|---|---|---|
| G-1 | Route question: the form could show before the saved answer loaded, and a redraw lost the choice | Wait for the saved answer; keep the choice | In batch |
| G-2 | Route question: a finishing save closed an answer the person had started changing | "Change my answer" is disabled while saving; a save resets only what it submitted | In batch, then replaced by the questionnaire |
| G-3 | A paid FIDReC pack was delivered in a reduced form after two failed AI attempts | Never delivered or saved in reduced form (section 4.5) | In batch |
| G-4 | A changed route answer left the earlier answer's dates in the facts | A changed answer clears what the earlier one filled in | In batch |
| KI-1 | Story hand-over failed once on the mobile Safari profile (run 45691510299) | Not reproduced. Waived once by Elena after 4 of 4 clean tries on an iPhone. No retry added | Open, watched |

### 3.4 Re-test, 26 Nov (staging `9b8a813`): 37 passed, 5 failed, 1 skipped

| ID | Finding | Fix | Status |
|---|---|---|---|
| R-1 | S$188 paid, then the pack was refused, with no way to edit the facts | One shared check for the questionnaire and the generator; a final reply read from a letter counts | In batch |
| R-2 | "Generate my free evaluation" opened a hanging Stripe page | CR-2 removes the carried pack choice; a test checks the button never opens Stripe | In batch. Not reproduced by hand |
| R-3 | Pack buttons and "create your case" led a signed-in person to the public home page, in a loop for a new account | CR-2 (section 4.1) | In batch. Gate checks twelve buttons; step D.8 to be checked by hand |
| R-4 | The Rule 13(1)(i) and 13(2) text never appeared | They show whether paid stages are on or off | In batch |
| R-5 | The evaluation told a person to go to FIDReC after the six months had passed | That clause is dropped when the window has closed | In batch |
| R-6 | A date showed as "2026-12-12" | "12 Dec 2026" | In batch |
| R-7 | "They offered all of it back" as an answer option | Removed from the question; a letter saying so is still read | In batch |
| R-8 | The FIDReC pack used the police report as evidence and also listed it as missing | Not fixed | Update |
| R-9 | The bank pack said "I have not yet sent a written complaint" | The AI rewrites; no sentence is removed | In batch |
| R-10 | Two FIDReC pack sources are not in the verified documents; the "Sources" line omits the ABS code, the MAS reply and the Response to Consultation | Verified sources | Update |
| R-11 | A final reply showed "no supporting document" although a bank letter was uploaded | Not investigated | Open |
| R-12 | No progress line during a 20 to 30 second upload; the "You chose…" note not seen | The note is removed by CR-2. The progress line sits above the fold | Open, low |

### 3.5 Inventory under "a pack is never reduced", 27 Nov

Twenty-one places where an output dropped, shortened or swapped content. The agent reports all are built in `3083f1a`. The ones a customer would notice most:

| Item | Before | Now |
|---|---|---|
| 1 | Bank pack fell back to one line and a list of facts | Not delivered; the person can try again |
| 9 | Free evaluation fell back to a "summary version" | Not delivered. See section 7, question 2 |
| 12 | Only the first 5 payments shown on screen; document reading stopped at 15,000 characters | All payments shown; reading raised to 100,000 characters. See section 7, question 1 |
| 16 | FIDReC pack delivered without its duties when the rule lookup failed | Not delivered if the lookup fails; says so if no clause applies |
| 17, 18, 14 | Empty sections disappeared | Each section stays, with a plain sentence |
| 19 | An unreadable document was left out of the evidence index | Listed as a document that could not be read |

## 4. Final requirements

### 4.1 One flow inside "My cases" (CR-2)

After sign-in, everything happens inside the "My cases" dashboard. The public home page is for visitors who are not signed in.

**Free evaluation first.**
1. The visitor tells the story on the public home page and signs up.
2. Free evaluation: story, questions, documents, results, report.
3. Under the report: the Bank dispute pack, then the FIDReC pack.
4. Choosing a pack goes straight to Stripe. After payment the person returns to that case.

**Pack first.**
1. A pack card on the home page or a button on the pricing page. Both lead the same way.
2. Sign up.
3. Straight to Stripe, for both packs. The FIDReC pack shows one statement and the buy button first (section 5.1).
4. After payment: "My cases".
5. "Add a new case" opens the in-dashboard story page. For a FIDReC pack, the timeline questionnaire comes first.
6. "Submit the story" leads to the documents for the pack bought.

**Screens.**
- "My cases" always shows "Add a new case".
- The in-dashboard story page is the story box only (type or speak), inside the dashboard frame, with the button "Submit the story".
- A signed-in person is never sent to the public home page by a pack button, a "create your case" link or a return from Stripe.
- The FIDReC pack's report page offers no Bank dispute pack. The packs stay independent. A person who bought both sees both.

### 4.2 Pack buttons for a signed-in person

A person is never charged on an empty case when they already have a real one.

| The person has | A pack button leads to |
|---|---|
| No case with a story | The pack-first flow |
| Exactly one case with a story | That case, with the offer shown. Nothing is charged until they press it |
| Several cases with a story | "My cases", to choose a case or add one. Both lead to payment first (section 10.1) |
| One case that already has a FIDReC report, and they press the bank pack | "My cases", to add a new case |

A story told on the public home page fills a waiting empty case first. Backing out of Stripe reuses the same empty case.

### 4.3 The FIDReC pack is sold upfront

Purchase and generation are blocked as little as FIDReC's own rules allow. The worst case for a buyer is that the pack waits.

- No question before payment. One statement is shown (section 5.1).
- After payment the timeline questionnaire is the first step of the FIDReC case.
- The questionnaire, the "can generate" decision and the generator use one shared check.
- No screen offers a refund. The Terms apply to a customer who asks.
- A FIDReC buyer who has not complained to the bank yet pays S$18 for the Bank dispute pack.
- Nothing says or implies that a new letter from the bank restarts the six months.

**Questionnaire, titled "Your timeline with your bank".**

| Question | Answers |
|---|---|
| Have you complained to your bank in writing? | Yes / Not yet |
| Date of your written complaint | a date |
| Has your bank answered your complaint? | Yes, it gave its answer / It said it is still looking into it / No, not yet |
| Does the reply say it is your bank's final reply? | Yes / No |
| Date of the final reply, or date of the bank's answer | a date |

**What each situation leads to.**

| Situation | Rule | Result |
|---|---|---|
| The bank gave its answer and the matter is not resolved | 13(1)(i) | Generate |
| Four weeks have passed since the written complaint | 13(1)(i), 4(1)(v) | Generate |
| Complained; no answer, or "still looking into it"; under four weeks | 13(1)(i) | The pack waits and shows the date (section 5.2) |
| Not complained to the bank in writing | 4(2) | The pack waits; the Bank dispute pack is offered at S$18 (section 5.3) |
| A final reply more than six months old | 13(1)(ii), 5(vi), 13(2) | Generate. The pack states both dates and the rules (section 5.4) |

### 4.4 Paying before a case exists

An empty case is created before Stripe. The purchase attaches to it and "Add a new case" fills it. Only the server can create or mark such a case. Migrations `20261127120000_pack_first_cases` and `20261128120000_fidrec_sold_upfront`, both approved for staging only.

After Stripe, "My cases" shows "Confirming your payment" until the purchase is recorded.

### 4.5 A pack is never reduced

1. Every section of the confirmed schema is always present in the free evaluation, the Bank dispute pack and the FIDReC pack.
2. A conflict, a doubtful document or a detail a safety check will not print is described in neutral words, never dropped. The model is "a document identified by the complainant as a police report".
3. Safety checks stay. A blocked reference is described by its source. One with no source is rewritten by the AI.
4. No sentence is removed from what the AI wrote. The AI is asked to rewrite.
5. A pack that cannot be completed is not delivered and not saved. The person is told and can try again.
6. Every new sentence a customer reads needs Elena's approval before it merges.

### 4.6 Gate rules (unchanged)

- Three gate runs in a row pass on one commit before Elena's re-test.
- No test gets a retry.
- A dropped connection restarts the count once. Any other failure stops the series until the cause is known.
- Staging is on the exact commit the gate tests.
- Every deploy and every migration needs Elena's go in her own words. Production needs a separate one.

## 5. Approved wording

Approved by Elena on the dates shown. Use exactly as written.

**5.1 Before Stripe, FIDReC pack (27 Nov).**
"FIDReC takes a complaint after you have complained to your bank, and the bank has answered or four weeks have passed. If that is not yet your situation, your pack waits for you until it is."

**5.2 Complained, no answer yet, under four weeks (27 Nov).**
"FIDReC takes a complaint once your bank has answered and the matter is not resolved, or four weeks after your written complaint (Rule 13(1)(i)). Your written complaint is dated [date], so the four weeks end on [date]. You can wait for your bank's reply, or write to your bank now and ask for its answer. Your pack is ready to generate as soon as either happens."

**5.3 Not complained to the bank yet (27 Nov).**
"FIDReC sends back a dispute that was not first raised with the bank (Rule 4(2)). The Bank dispute pack prepares that written complaint from your facts. Send it to your bank, then come back here when your bank replies, or when its reply does not resolve the matter. Your FIDReC pack waits for you."

**5.4 A final reply more than six months old (26 and 27 Nov).**
"The final reply you told us about is dated [date]. Six months from that date ended on [date] (Rule 13(1)(ii); Rule 5(vi))."
Where a bank letter shows the date, the first sentence is: "The institution's letter dated [date] says it is its final reply (E#)."
Then, once: "FIDReC's Terms of Reference say a final reply is a letter that expressly states it is the institution's final reply, tells you that you can contact FIDReC within six months, and gives FIDReC's contact details (Rule 13(2)). If the reply you received did not state these, you can ask your bank in writing to confirm whether it was its final reply. Whether a document is a final reply is decided by FIDReC."

**5.5 Asking the bank again (27 Nov).**
"You can ask your bank to confirm in writing: (a) whether its reply was its final reply; (b) whether you can take the dispute to FIDReC, and by when; (c) what it offers: nothing, part of the amount, or all of it. Whether a later letter starts a new six-month period is decided by FIDReC (Rule 13(2)). When you have the bank's letter, add it to your case."

**5.6 FIDReC pack, deadline (25 Nov).**
"The institution's letter dated [date] says it is its final reply (E#). Counted from that date, FIDReC must receive the complaint by [date] (six months after the final reply)."
From the person's own answers: "You told us the final reply is dated [date]. Counted from that date, FIDReC must receive the complaint by [date] (six months after the final reply)."

**5.7 FIDReC pack, answered but not final (27 Nov).**
"The institution has answered the complaint and the matter is not resolved (Rule 13(1)(i))."

**5.8 FIDReC pack, before the duties (25 Nov).**
"This payment is likely not covered by the SRF (see 'How the rules may apply'). The duties below are listed because FIDReC can consider how the institution handled the case."

**5.9 Failure messages (27 Nov). No refund sentence.**
- FIDReC pack: "We couldn't complete your FIDReC pack this time. You can try again now. If it still doesn't work, email info@guidebuoyai.sg."
- Bank dispute pack: the same, naming the Bank dispute pack.
- Free evaluation: "We couldn't complete your free evaluation this time. You can try again now. If it still doesn't work, email info@guidebuoyai.sg."

**5.10 "My cases" messages (27 Nov).**
- "Payment received for your [Bank dispute pack / FIDReC pack]. Add a new case to tell your story."
- "Payment cancelled. You have not been charged."
- "Choose the case your [pack name] is for, or add a new case."
- Empty state: "Start with your story. GuideBuoy does not send anything to your bank or any other organisation."
- No saved draft: "We couldn't find a story saved in this browser tab, so no case was started. Add a new case to write your story."

**5.11 A reference a safety check will not print (27 Nov).**
- FIDReC pack, from a document: "the reference shown in [the institution's letter / the bank statement / the card statement / the police report / the scam message / an uploaded document] (E#)"
- FIDReC pack, from the story only: "a reference given in the complainant's account, with no supporting document"
- Bank pack, from a document: "the reference shown in [my bank's letter or email / my bank statement / my card statement / my police report / the scam message / my uploaded document]"
- Bank pack, from the story only: "a reference I gave in my account, with no supporting document"

**5.12 Other sentences approved on 27 Nov.**
- "No duty could be set out from the matched rule clauses and the documents."
- "This document was not read when this pack was written."
- "We couldn't read this file, so it is not part of your case. Please upload it again, or upload a different document."
- "My bank replied."
- Duplicate file: "You have already added this file to your case."

The rule wording of section 3.2 is also approved and is not repeated here.

## 6. Not in this release

With `feat/fidrec-update`:
- the "Police investigation" section (CR-1), with its optional police outcome document;
- verified sources in the FIDReC pack, and a complete "Sources" line (R-10, PB-7);
- the police report contradiction (R-8) and PB-8;
- the new citations added to the clause-key lists, after main is merged in;
- the standards confirmations (#115): 15 of 20 regulator documents are ready to verify; five wait for the rule wording of section 3.2 to reach that branch;
- raising the amount of each document read when the FIDReC pack is written.

Not scheduled: PB-14, R-11, R-12, an email alert to Elena when a paid pack fails, and the gate workflow follow-ups (a Windows fault skipping the staging jobs, stale version labels, cookie lines in test logs).

## 7. Open questions before production

1. **Long documents.** Answered in part on 27 Nov: the test showed documents of 5 pages or more lose almost all their text (section 9.1). The fix is section 9.2. Still open: where reading runs and its time limit, and the count of affected production documents.
2. **The free evaluation now fails outright** where it used to give a summary version, including when the daily spending cap is reached. How often was the summary version used in the last 30 days, on staging and production? Counts only.
3. **The upload box sentence** about how much of each document is read. Answered by Elena on 27 Nov: it comes out. Every document is read in full (section 8.1).
4. **The rejected reference** in gate run 45867707804. The staging log query will show whether it was a notice name from the rule text or a number the AI made up. That part of the check is not to be changed until the log says.

## 8. Three changes decided by Elena on 27 Nov, 21:05 (to build before the next gate series)

These change the build on staging (`b6be3f3`), so they make a new commit and the three gate runs start again after them.

### 8.1 Every document is read in full

**Rule.** Every document a person uploads is read in full, at every step that uses it. The product never reads only part of a document, and never tells a customer that it did.

**Remove:**
- the upload box sentence about how much of each document is read when a FIDReC pack is written;
- the sentence "Only part of this document was read when this pack was written." (inventory item 20), because the situation it describes must no longer occur.

**Consequence for the agent to report before building.** Today the step that writes the FIDReC pack reads about 4,000 characters of each document and 24,000 in total. Under this rule it must read all of each document, or be written from what was already read document by document. Report, with measurements on synthetic documents and counts only:
1. how many documents of 15 pages that step can read in full in one pack today;
2. how long it takes and what it costs per pack at that number;
3. where each reading step runs and its time limit (a staging function was cut off at about 150 seconds on 25 Nov).

A limit in 8.2 may not be higher than the number that can be read in full.

### 8.2 Limits on uploads

Limits are enforced at upload, before anything is stored or read. The same limits are checked on the server.

| | Documents | Pages per document |
|---|---|---|
| Free evaluation | 10 | 15 |
| Bank dispute pack | 10 (see 11.1) | 15 |
| FIDReC pack | 10 (see 11.1). Target 50 with a later update | 15 |

- The existing limits of 15 MB per file and the file types (PDF, PNG, JPEG) stay.
- The page limit replaces today's 30 pages.
- An image counts as one page.
- A document already in a case when the limit changes is kept. The limit applies to new uploads.
- Decided on 28 Nov: 10 documents for all three (section 11.1).

### 8.3 Failure messages name the fault

**Rule.** When something fails, the person is told what failed, in plain words, and what to do next. A technical fault asks them to try again now. The daily cap asks them to come back tomorrow. No message mentions cost or spending.

**Wording proposed by the reviewer on 27 Nov. Not yet approved by Elena. Do not merge until she approves.**

| Situation | Proposed wording |
|---|---|
| A file over the page limit, at upload | "This file has more than 15 pages. Please upload only the pages that matter, as a separate file." |
| Too many files | "You can add up to [number] documents for this [evaluation / pack]." |
| Reading did not finish in time | "Reading your documents took too long and did not finish. Please try again now." |
| The AI service failed or its checks failed twice | The approved failure message for that output (section 5.9) |
| The daily cap is reached (free evaluation) | "We've reached today's limit for free evaluations. Your answers are saved. Please come back tomorrow." |

Elena's own phrasing for the cap was "due to increased demand". The reviewer left it out because the cap can be reached on a quiet day, when that would be untrue. Elena decides.

- The daily cap message replaces the generic failure message in that case only. The person's answers and documents are kept.
- The log records which fault it was (too long, timed out, service failed, cap), with no case content, so the count in section 7, question 2 can be answered.

### 8.4 Tests

- Upload: a file of 16 pages is refused with the message; a file of 15 is accepted; the document count limit is enforced for each of the three outputs, on the screen and on the server.
- No output contains a sentence saying a document was read in part.
- Each failure in 8.3 shows its own message, and the cap case keeps the person's answers.
- A document at the page limit is read in full by every step that uses it, shown by a fact taken from its last page.

## 9. Reading documents in parts, payments shown as a table, and 150 payments (27 Nov, 23:45)

Found by Elena's upload test on staging `b6be3f3` with five synthetic statements, and by the agent's measurements. Build together with section 8, then one gate series.

### 9.1 The fault: long documents lose almost all their text and still say "ready"

| Synthetic file | Text kept | Expected, about | Result |
|---|---|---|---|
| 1 page | 2,468 characters | 2,600 | Complete |
| 3 pages | 7,300 | 7,600 | Complete |
| 5 pages | 213 | 12,700 | Under 2% kept |
| 10 pages | 272 | 25,400 | About 1% kept |
| 15 pages | 272 | 38,000 | Under 1% kept |

The AI abbreviated the text ("...") and the reading finished normally, so nothing flagged it. Later steps work only from the stored text. The agent reports that production runs the same instructions and the same answer cap, so real documents of 5 pages or more are probably affected there today. Not yet tested on production.

### 9.2 Requirement: every document is read in parts and joined

1. Each file is read in parts of up to 3 pages. Each part asks only for the text. The parts are joined in page order.
2. A part that comes back abbreviated, shortened or empty is a failed reading. The document is not marked ready. The person sees: "We couldn't read this file, so it is not part of your case. Please upload it again, or upload a different document." (approved 27 Nov).
3. A document is "ready" only when every page has been read. The stored record shows the number of pages read and the number in the file, and they must match.
4. Facts are read in parts too, so a long list of payments cannot make the "Confirm your facts" step fail.
5. The page limit per file in section 8.2 is the largest size that passes Elena's five-file test after this fix, and not above 15.
6. The time limit of the place where reading runs is stated, and reading in parts stays inside it.

**Before production, counts only:** the number of production documents whose stored text is far shorter than their page count suggests, and the number of cases they belong to. Elena decides what to do about those cases.

### 9.3 Requirement: up to 150 payments

A case with up to 150 payments goes through every step without failing: reading, confirming the facts, the free evaluation, the Bank dispute pack and the FIDReC pack. Every payment appears once in the payments table, with nothing dropped or merged, and the total equals the sum of the rows.

Above 150 payments the person is told plainly and nothing is cut silently. Wording for Elena's approval: "This case has more than 150 payments. Please email info@guidebuoyai.sg so we can help you with it."

### 9.4 Requirement: payments are shown as a table, never as a sentence

**In the Bank dispute pack and the FIDReC pack.** Payments appear once, as a table with the columns Date, Amount, Paid to and Method, on screen and in the PDF, followed by the total. The table continues across pages in the PDF with its header repeated.

**In the free evaluation** (summary, evidence checklist, facts confirmed) and on the "Confirm your facts" screen, payments are given as a count, a total and a date range. The full list is not printed in running text anywhere. Where the person needs to check individual payments, such as on the confirm screen, they are shown as a table.

**Where a document and the confirmed facts differ**, the difference is stated in numbers and the table marks the rows. The list is never repeated in a sentence. This replaces the form of inventory item 6 for payments.

**One output never contradicts itself about the total.** If a total is shown anywhere in an output, no sentence in that output says the total is not stated.

**Example wording, for Elena's approval. Not to merge until she approves.**

| Where | Example |
|---|---|
| Evidence checklist, payments shown by a document | "The payments you dispute: 120 payments, S$5,700 in total, 1 to 28 Oct 2026. Shown by your bank statement (uploaded)." |
| Facts confirmed | "The payments you dispute: 120 payments, S$5,700 in total, 1 to 28 Oct 2026." |
| A document shows fewer than were confirmed | "You confirmed 120 payments. Your bank statement (uploaded) shows 50 of them." |
| A document shows payments that were not confirmed | "Your bank statement (uploaded) shows 8 payments that are not in your confirmed facts." |
| FIDReC pack, the same two cases | "The complainant states 120 payments. The bank statement (E1) shows 50 of them." and "The bank statement (E1) shows 8 payments that are not in the confirmed facts." |
| Summary, when no total is confirmed | "The total amount lost is not confirmed." (approved 27 Nov, inventory item 14) |
| Table column for a marked row | "Not shown in a document" |

### 9.5 Tests

- Elena's five synthetic files (1, 3, 5, 10 and 15 pages) each keep their full text, checked by character count against the source and by a fact taken from the last page.
- A part forced to come back abbreviated makes the reading fail with the approved message.
- A synthetic statement with 150 payments: the count is 150 after reading, after confirming, and in each of the three outputs; the total equals the sum.
- No output contains a list of payments in running text. A test checks that a case with 20 payments prints them only in a table.
- An output that shows a total does not also say the total is not stated.

### 9.6 Also seen in the same evaluation, to check

- The scam type read "Phishing by SMS or messaging app" while the first contact read "Email". Confirm whether that came from the test answers or is a fault.

## 10. From Elena's test of staging `26ba685` (28 Nov, 01:00)

### 10.1 A pack button always leads to payment, then to that pack's path

**Found.** Signed in to an account with several cases, Elena pressed the FIDReC pack. She was sent to "My cases" (correct), added a new case, was never asked to pay, and ended with a free evaluation. Section 4.2 said "My cases, no payment, to choose a case or add one" and did not say what happens next. That was a gap in the requirement.

**Requirement, decided by Elena.** A person who reaches "My cases" from a pack button has two options, and both lead to payment first:

| The person chooses | Then |
|---|---|
| An existing case | The payment step for that pack on that case, then Stripe. After payment they return to that case, on that pack's path |
| "Add a new case" | An empty case is opened for the pack, then the payment step and Stripe. After payment they continue on that pack's path in the new case |

- The FIDReC pack's path starts with the timeline questionnaire ("Your timeline with your bank"), then the story if the case has none, then the documents.
- The Bank dispute pack's path starts with the story if the case has none, then the documents.
- The FIDReC payment step shows the approved statement (section 5.1) before Stripe.
- The pack chosen is carried in the address of "My cases" and of the step that follows, not in the browser's memory. Leaving "My cases" any other way drops it.
- If the chosen case already has that pack, the person goes to that case and is not asked to pay again.
- A case never reaches a free evaluation as the result of pressing a pack button without the person having been offered the payment step.

This replaces the "several cases" row of section 4.2. The "exactly one case" row stays: that case opens with the offer shown.

**Tests.** Signed in with several cases, for each pack: choosing an existing case reaches Stripe and returns to that case on the pack's path; "Add a new case" reaches Stripe and continues on the pack's path; in neither does the person reach a free evaluation without passing the payment step.

### 10.2 The bank field filled with scraps of the story

**Found.** In a free evaluation from a case whose story was the example text, "Banks or payment providers involved" printed fragments of the story, split at commas, in place of a bank's name.

**Requirement.** A fact that names a bank or payment provider holds names only. Text that is not a name is not stored there; the fact is then "not stated". A test covers a story that names no bank and a story that contains the example text.

### 10.3 "Shown by your bank statement" when several documents were uploaded

**Found.** One line said all 354 payments were "shown by your bank statement (uploaded)". The next said the statement shows 155.

**Requirement.** The first line names only what the documents together show, and the count it gives is the count the documents show. Where more than one document is involved it says "your bank statements (uploaded)". The two lines never give different counts for the same documents.

### 10.4 The date printed on an output

**Found.** A free evaluation generated after midnight in Singapore on 28 Nov printed "Generated: 27 Nov 2026".

**Requirement.** Every date the product prints or counts from uses Singapore time: the "Generated" date on all three outputs, FIDReC deadlines, the four-week date, and "today" in every check. A test generates an output just after midnight Singapore time.

### 10.5 A case above the payment limit

**Found.** The same case had 354 payments. Nothing said it was above 150. The approved message (section 9.3) is not built yet. Build it with this batch.

## 11. Elena's decisions of 28 Nov, after the overnight build

### 11.1 Upload limits: decided and closed

- 10 documents, 15 pages each, for the free evaluation, the Bank dispute pack and the FIDReC pack. This replaces the 15 for the packs in section 8.2.
- This change request is closed.
- With a later update: work out how to raise the number for the Bank dispute pack and the FIDReC pack. The target is 50. The FIDReC pack is expected to be the densest.
- Of section 8.1, only the number that fits by size has been reported. Time per pack is to be measured on staging (11.6). Elena will test costs further on production.

### 11.2 Wording variants: approved

The singular and plural forms of the section 9.4 sentences, the forms naming card statements, police reports, bank letters or documents, and the mark in the "Not shown in a document" column are approved. Every number in them is counted from the person's own confirmed payments and documents. No number is fixed in the text.

### 11.3 Choosing a case from "My cases" (adds to 10.1)

- A case with the Bank dispute pack can be chosen to add the FIDReC pack. The person is asked to pay for the FIDReC pack.
- A case with the FIDReC pack is not asked to pay.
- A case with only the free evaluation has no pack.

### 11.4 The same key questions in every path

A Bank dispute pack or FIDReC pack can be bought without a free evaluation. Where there is no free evaluation on the case, the pack asks the free evaluation's questions before the facts. Where there is one, they are not asked again.

### 11.5 Reading payments and the size of a FIDReC pack (reviewer's instructions, pasted by Elena)

1. Elena runs the two queries for the affected staging case. Until then the fact-reading code is not changed.
2. Whatever the cause, each part must carry the document's heading lines and say which part it is and what kind of document. **Not built.**
3. The "fewer than a quarter" guard is replaced: payments read are compared with the payment lines in the file's own text, both numbers show on the confirm screen, and a difference stops. **Not built.** The sentence on the confirm screen needs Elena's approval.
4. One real FIDReC pack is measured at about 90,000 characters and one at about 400,000: seconds, and whether it finishes inside the time limit. The release limit is whatever passes. **Not measured:** it needs a staging deploy.
5. A proposal for writing the pack from per-document notes, for the update branch: `proposal-pack-from-document-notes.md`.

Open point on item 3, raised by the agent: a line with a date and an amount is not always a payment (balances, deposits, fees), and a scanned file has no text of its own. An exact match would stop ordinary statements. What counts as a payment line has to be agreed before it is built.

### 11.6 To check on staging

- Time each step: reading each document, reading the facts, the free evaluation, each pack.
- A fact taken from the last page of a 15-page file reaches the confirm screen, the free evaluation, the Bank dispute pack and the FIDReC pack (section 8.4).

### 11.7 "Which of these are involved?"

Elena asked for this gap to be fixed before staging.

- **Mobile operator: built (1896875).** The choice reads "the scam SMS came through it", so it records that the scam came by SMS. A different answer elsewhere shows on the confirm screen as a conflict.
- **E-wallet: not built, waiting for Elena.** "Involved" does not say that money was taken from the e-wallet, and the rules and packs need that. Proposed wording for the choice, which she has not approved: "An e-wallet or payment app (money was taken from it)".
- The bank and "something else" choices state no fact on their own.
