# Part B walk-through, 2026-11-25: defects and change requests

Source: Elena's Part B walk-through on staging at `0994bc5`, case A (staging case `5f83b505`), plus a FIDReC pack she
generated on the same case afterwards (outside the walk-through). Every document used was synthetic ("Synthetic
Bank", `TEST-` references). Nothing from the case is copied here beyond the synthetic values needed to describe a defect.

Result recorded by Elena: 1.1–1.6, 8.1–8.3, 2.1–2.3 and 2.7 pass; 2.4–2.6 skipped (see PB-2 and PB-9).

What happened on the case (UTC, from staging):

| Time | Event |
|---|---|
| 05:23:41 | Bank statement read |
| 05:26:25 | Free snapshot |
| 05:43:57 | Bank pack paid |
| 05:46:51 | Bank facts confirmed (snapshot 1); police report not yet added, so no pack started |
| 05:50:01 | Police report read |
| — | "Generate" pressed: refused, "Your facts changed since you confirmed them" |
| 06:00:30 | Facts confirmed again (snapshot 2); no new question |
| 06:00:41 | Bank pack completed from snapshot 2 |
| 06:16:37 | A bank letter read (a final reply about a different payment) |
| 06:17:52 | FIDReC facts confirmed; FIDReC pack generated |

## Defects

### PB-1 (bug): the bank named on a statement does not count as shown

Seen in the free evaluation and the bank pack: "Banks or payment providers involved: Synthetic Bank. No document yet",
although the uploaded bank statement is headed "Synthetic Bank - Statement of account". The FIDReC pack shows it only
because the later bank letter named the bank.

Cause: the checklist marks a fact as shown when the confirmed value has a document among its sources. The statement
was read once (the later runs on the case reuse that reading) and gave the transactions, account type and loss but no
institution. The
extraction prompt (`fact-extract-v3` on main, and `fact-extract-v4` on `feat/fidrec-update`) has no rule that the bank
or provider that issued a statement or letter is an institution involved. On the statement's exact text, staging's
model (gpt-6-luna, production output cap) named the bank in 3 of 10 calls with the current prompt and 9 of 10 with
the rule added (#106).

Fix:
- Add the rule to both prompts: the bank or provider that issued a statement, alert or letter is an institution, quoting
  its name as printed.
- The prompt version is not bumped yet (review, 25 Nov), so the rule reaches new sources only: sources already read keep
  their saved results. Whether existing cases are re-read is Elena's separate decision. A bump today would re-read, on
  production, 4 cases with 23 sources in their latest runs (3 of them documents) and 5 snapshots.
- Backstop without the model: for a bank statement, card statement or bank letter that returns no institution, take the
  issuer from the document's heading only. Payee banks and e-wallets in transaction lines are never added, and unknown
  names are not guessed.
- Synthetic contract tests: a statement from bank X with a transfer to bank Y and a GrabPay top-up gives X only; a
  statement headed "Synthetic Bank" with the model's institution returned.

### PB-2 (bug): confirming before the last document leaves the paid step silent, then refuses the first press

Steps: on the bank step, confirm the facts before the police report is added, then upload it from the checklist.

Seen:
- Nothing shows while the report uploads and is read; the item flips straight to "Added".
- No "still being read" line and no "Checking your facts…" line.
- "Generate" is offered and refused with "Your facts changed since you confirmed them"; "Check my facts again" shows
  everything confirmed with no new question; a second press works.

Cause: once facts are confirmed, the "Thank you, your facts are confirmed" card replaces the confirm panel, and the
progress lines live in that panel (and in the upload panel further down the page). The card keeps the first snapshot;
the new document changes the facts' input, so the server correctly refuses that snapshot (`facts_unconfirmed`).

Fix:
- When a new document becomes ready after confirming, the step returns to the confirm panel by itself. The panel
  reloads the facts ("Checking your facts…"), shows any new question, and one press confirms and starts the pack.
- While a document uploads or is read, the checklist shows the upload panel's existing line ("Uploading and processing
  1 file… Reading a long document can take about a minute.") and "Generate" is disabled.
- A signed-in end-to-end test for this order (confirm, then upload the police report, then one press). The current
  S$18 test uploads first.

### PB-3 (change, wording): name what is missing

Seen: "When the documents listed above are added, you can generate your Bank dispute pack." It does not say the police
report is what is missing.

Proposed (needs Elena's approval): "Add your police report to generate your Bank dispute pack.", built from the missing
items, for example "Add your payment proof and your police report to generate your FIDReC pack."

### PB-4 (change, wording): the bank pack offer names only the SRF

Seen: "A structured complaint report organised against Singapore's Shared Responsibility Framework, ready for you to
review before sending." The pack also sets the payments against the EUPG.

Proposed (needs Elena's approval): "A structured complaint report organised against Singapore's Shared Responsibility
Framework (SRF) and the MAS E-Payments User Protection Guidelines (EUPG), ready for you to review before sending."
The ABS safeguards are cited in the FIDReC pack, not the bank pack, today; they join this line only if the bank pack
starts citing them.

### PB-5 (bug): two packs on one page look like one report shown twice

Seen: with both packs bought, the case page shows the FIDReC pack and then the bank pack with no label between them.
Their titles are written from the case ("Disputed S$2,400 bank transfer", "Complaint about S$2,400 scam payment"), so
the page reads as the same report twice.

Fix: a heading above each with its existing name ("FIDReC pack", "Bank dispute pack") and a divider between them.

### PB-6 (bug): "Consultation unavailable" under a line saying how to book

Seen: "Human consultation: S$99 for 30 minutes. Email info@guidebuoyai.sg to book." followed by a greyed "Consultation
unavailable" button. The button dates from before email booking (7 Nov, D2).

Fix: remove the disabled button on the case page and in the two other consultation cards; the line stays. The
`slice7` end-to-end test that expects the disabled button changes with it (Elena's approval: it is a deliberate change,
not a weakened test).

### PB-7 (change): the FIDReC duties section does not say whose rule each point is

Seen: points open with "The enhanced-surveillance material describes…"; the source is named only as "R1" at the end and
in a list keyed in capitals, with a stray bracket: "ABS MEDIA RELEASE ENHANCED SAFEGUARDS (2025)), MR-1".

Fix:
- The stray bracket is already corrected on `feat/fidrec-update` (migration `20261201120000`), applied with the update.
- The reference list shows a readable name for each source (for example "ABS media release on enhanced safeguards
  (2025)"). The names need Elena's approval.
- The FIDReC prompt opens each duty with its source in words ("Under the SRF Guidelines…", "The ABS safeguards of
  2025 say…"). Made on `feat/fidrec-update`, where the FIDReC sections are rewritten, and checked in Elena's switch-on
  review.

### PB-8 (question): a bank letter about a different payment still counts as proof

Seen in the FIDReC pack: the uploaded final reply is about S$5,000 on 5 Sep 2026, not the disputed S$2,400. The pack
says so correctly, but its checklist still lists that letter as showing "told your bank", the case reference and
"amount recovered S$0".

Proposed rule (needs Elena's decision): a bank letter that names a payment (an amount or a date) matching none of the
confirmed disputed payments counts only as context, never as proof, and the checklist says the letter is about a
different payment. Many real letters name no payment at all; a letter naming none keeps its current treatment
(review, 25 Nov). Made with the update, which rewrites the document checks.

Addition (case B review): "Shown by" must not vouch for a value the document does not state. The case B checklist says
"written complaint: Yes, 4 Oct 2026. Shown by a letter from your bank", but the letter states no date; the date is
the person's own answer, merged with the letter's undated "yes".

### PB-9 (walk-through): steps 2.4–2.6 assumed the upload came before confirming

Journey 5 (try to continue without the police report) leads to confirming first, so 2.4–2.6 had nothing to show. After
PB-2 both orders behave the same; the walk-through gets the confirm-first order as its own steps.

## Added after review (25 Nov), from the three PDFs

### PB-10 (bug): ISO dates

The bank pack's Timeline, the FIDReC Chronology and the FIDReC deadline ("by 2027-04-04") print dates as YYYY-MM-DD;
everywhere else they read "3 Oct 2026".

### PB-11 (bug): system values in the text

"method: account_transfer" and lower-case field names ("date", "amount", "paid to") under Disputed transactions in both
packs; "SGD 2,400" in the case reference block beside "S$2,400" everywhere else.

### PB-12 (bug): citations printed twice

FIDReC points end "(E1). (E1)": the model's own citation and the one added after it.

### PB-13 (change, wording): whose date the FIDReC deadline is counted from

The deadline is stated as fact, counted from a final-reply date that the same pack lists as having no document.
Proposed (needs Elena's approval): "You told us the final reply is dated 4 Oct 2026. Counted from that date, FIDReC
must receive the complaint by 4 April 2027." When a document shows the date, the line names the document instead.

### PB-14 (cosmetic): FIDReC PDF layout

The R1–R12 list has no heading, and headings sit tight under the bullet list above them.

### PB-15 (answered, with one question): where "Final reply, rejected" came from

It was Elena's own choice on the confirm sheet. The sheet offered "acknowledged, 4 Oct 2026" (from her journey answers)
and "final reply, rejected", read from the story's "The bank refused to refund me, saying I authorised the payment."
and two answers repeating it. The open question is whether a refusal in a story should be read as a *final* reply at
all, or only as a reply whose status the user confirms.

## Case B (staging case `fd0c0961`), 25 Nov

Elena's result: 3.1, 3.5, 3.6, 4.1 and 4.3–4.7 pass. Recorded as: 3.2 failed (PB-17); 3.3–3.4 blocked by PB-17;
4.2 skipped (PB-20, PB-21). Documents: the
synthetic B1, B3 and B4 (B4 uploaded twice). PB-6 ("Consultation unavailable") was seen again.

### PB-16 (change, Elena): the paid pack buttons on /pricing are outlined

The free evaluation's button is filled; the two pack buttons use the outline style (`pack-comparison.tsx`,
`variant={card.paid ? 'outline' : 'default'}`). Elena: when the packs are live, all three buttons are filled, to show
they work.

### PB-17 (bug): the FIDReC route question cannot show its answer or be changed

Seen: "I haven't complained to my bank in writing yet" and Save: nothing seemed to happen, and "FIDReC needs your bank
to have had the chance to answer first…" never showed. After an answer that opens the pack, the question disappeared
and could not be changed, so 3.3 and 3.4 could not be run.

Cause (`fidrec-offer.tsx`): the question shows while the readiness reason is `complaint_not_raised`, which is also the
reason after the answer "not complained yet", so the question stays and the message under it is hidden. "Change my
answer" is shown only beside a blocking message, so once the pack can be bought there is no way back. Staging shows one
saved answer on the case (complained in writing, 4 Oct 2026), never changed.

Fix: the step knows whether a route answer is saved. Once saved, it shows the answer's message (or the buy button) with
"Change my answer" in every state. Existing wording only.

### PB-18 (change): the pricing FIDReC button leads to the free evaluation's story page

Seen: pricing, "Prepare my FIDReC case", sign up, then the same button again: each time the story page, titled as the
free evaluation. The pack is offered only after the story.

Cause: the button goes to `/sign-in?intent=fidrec`, which remembers the pack and moves a signed-in person on; a case
starts with the story whatever the pack. The design (stage 2 plan) keeps the story first, so the order is right, but
the page does not say the pack comes next, and a signed-in person with a case is not taken to that case.

Proposed: with a pack intent, the story page says the pack follows the story (wording for Elena), and a signed-in
person with a case goes to the case's dashboard.

### PB-19 (change): two sets of "where are you with your bank" questions on one screen

Seen: with the FIDReC intent, the dashboard shows the FIDReC route question and, under it, the free evaluation's six
journey questions ("Where are you with your bank?"); after paying, the journey questions showed briefly before the
FIDReC step.

Proposed (Elena's decision): with the FIDReC intent, the route question comes first and the journey questions wait
until it is answered. The flash after payment is the dashboard rendering before the purchase is visible; cause not yet
traced.

Case C: the same on the bank path. The free evaluation's journey questions sit under the bank pack offer, and the
same flash after paying for the bank pack. The fix covers both packs.

### PB-20 (bug): the same file can be uploaded twice

Seen: B4 uploaded twice, both kept, both listed and both offered in "Choose one of your documents".

Cause: `/api/evidence/upload` never fills `case_documents.sha256` (empty on every document of the case), so nothing
can see a repeat.

Fix: hash each upload and refuse a file already in the case, with a message naming it (wording for Elena).

### PB-21 (change): a document that matches no item is silent

Seen: B4 was read as "other"; the police report row stayed "Missing" with no message, and the file only appeared in
the dropdown.

Proposed (wording for Elena): after a document is read and matches no item, the checklist says so and points to
"Choose one of your documents" if it is one of them.

### PB-22 (bug, decision): a document marked by hand as the police report is not used by the facts

Seen: B4 marked "This is my police report" turned the item "Added", but the fact "Whether you reported this to the
police" still said "We couldn't find a document that shows this".

Cause: the evidence checklist reads the mark (`complainant_item`); the fact reading ignores it and uses the type the
model gave the document. For both copies of B4 that type was "bank letter" (see PB-25), and a bank letter cannot
state police facts. B4 states "Received 06 Sep 2026" and a reference, which would match the story's 6 September.

Proposed (Elena's decision): a document marked by hand is read as that kind of document (police report, bank letter,
payment proof), and marking it re-reads it, so its date and number are compared like any other police report's.
Review condition (25 Nov): wherever such a document is named it stays "a document identified by the complainant as a
police report", never "your police report (uploaded)", because nothing has verified what it is.

Alternative from the first review: keep the facts as they are and change the fact card's wording for a marked
document, for example "You marked a document as your police report. We could not read a report date from it. Keep
your own account of the date, or correct it." Elena chooses.

### PB-23 (with the update): the FIDReC duties ignore the scam type

Seen: an investment scam (payments made knowingly) gets the SRF's phishing duties (surveillance, cooling period,
alerts) as if they applied, while "How the rules may apply" correctly says the SRF does not cover it.

Proposed: with the update's rewrite of the FIDReC sections, duties under a framework the case is outside are left out
or labelled as not applying. Elena (25 Nov): such cases may still buy and generate packs, as long as the pack says
plainly what is not covered, which it does.

Addition (case B review): one server-written sentence at the top of the duties section when the case is outside the
SRF, so a reader does not meet the SRF duties before being told the case is outside it. Wording for Elena; in the
batch. The rest with the update.

### PB-24 (bug): the FIDReC "Filing" section ignores a confirmed final reply

Seen in the case B pack: "The complainant complained in writing more than four weeks ago and the complaint is not
resolved", with no deadline, while its own chronology shows the bank's final reply of 10 Nov 2026.

Cause, two parts:
- The deadline is counted only from a final reply that "qualifies" (ToR Rule 13(2): the letter says it is final and
  mentions FIDReC within six months). Only the typed answers set that marker; a final reply read from a letter always
  has it empty. The confirmed reply on the case (final reply, 10 Nov 2026, from B3) had it empty, so the section fell
  back to the four-weeks route and printed no deadline.
- The route answer "complained in writing, no final reply" (4 Oct 2026) is saved only as a written complaint, never as
  "no final reply", so it did not conflict with the final-reply letter and the confirm step asked nothing.

Proposed:
- When the confirmed bank reply is a final reply with a date, the section counts the deadline from it. If the letter's
  wording was not checked (the marker is empty), the line says so rather than dropping the deadline. Wording for
  Elena, with PB-13. Whether a letter that says "final reply" and names FIDReC sets the marker by itself is Elena's
  decision (it is a reading of ToR Rule 13(2)).
- The route answer "no final reply" also counts as a bank reply that is not final, so a final-reply letter conflicts
  with it and the confirm step asks. Test: route "no reply", then a final-reply letter.

### PB-25 (bug): an acknowledgement naming no sender was filed as a letter from the bank

Seen in the case B pack: E3 and E4 are the same file (B4, uploaded twice). One is listed as "a letter or email from
your bank" and cited as "the institution's acknowledgement records receipt on 6 Sep 2026"; the checklist counts it as
showing that the person told the bank.

Cause: the model typed both copies of B4 as a bank letter, though B4 names no institution. Nothing checks that a "bank
letter" names a bank.

Fix (with PB-1, #106): the prompt says a bank letter is only a letter, email or message from a bank or payment
provider; an acknowledgement that does not show one is "other". On gpt-6-luna, B4 was a bank letter 5 of 5 times
before and "other" 5 of 5 after, while a genuine bank email that prints no bank name stays a bank letter 5 of 5. A
rule on the text alone (no institution named → "other") was tried and dropped: it also demoted that genuine email,
which an existing test (A7) protects.

### PB-26 (bug): three card payments became one (case C, staging case `fe204ab1`)

Seen: the story and the card statement list three payments (S$1,200, S$850 and S$499); the bank pack has one "Payment
of S$2,549", paid to "Not known", says the individual amounts are not confirmed, and credits the police report.

How it was resolved on staging: the police report says "three card payments totalling S$2,549.00 on 12 Oct 2026",
which was read as one payment of S$2,549. That made the payments a conflict between three payments (story and card
statement) and one (police report), and the answer saved on the confirm sheet chose the police report's. The total
also agrees with the three payments, so the conflict was false from the start.

Fix: a stated total of several payments is the amount lost, never a payment. The extraction prompt says so, and a
payment whose words state a total ("totalling", "in total", "a total of", or several payments) is dropped. The card
statement's merchants ("ONLINE MERCHANT ONE" and so on) were not read as payees either; the same change asks for the
payee as printed. Test with C2's and C1's synthetic text.

Re-run after the fix: 6.2–6.3.

## Results (25 Nov)

Elena: 31 pass, 8 skipped. None of the skipped steps is neutral: 2.4–2.6 (PB-2), 3.2 failed and 3.3–3.4 blocked
(PB-17), 4.2 (PB-20, PB-21). Re-run after the batch: 2.4–2.6, 3.2–3.4, 4.2 and 6.2–6.3.

PB-2 on case C: the checklist line from #107 sits at the top of the checklist and counts every file uploading or being
read, so it covers both rows (payment proof and police report) on a card case.

## Order of work (review, 25 Nov)

1. On branches now, nothing merged into main: PB-1, PB-25 and PB-26 (#106), PB-2 (#107), PB-5 (#108), PB-17 (#109), all drafts.
2. Before selling, also on main: PB-10, PB-11, PB-12, PB-16, PB-20, PB-24, and the wording items once
   approved (PB-3, PB-4, PB-6, PB-13, PB-21, PB-23's sentence).
3. Elena's decisions: PB-18, PB-19 (both packs), PB-22, the re-read of existing cases (PB-1).
4. One batch after Elena's own three cases, then three gate runs on that commit, then the re-runs above.
5. With the update (`feat/fidrec-update`): PB-7, PB-8 (with its addition) and the rest of PB-23.
6. Any time: PB-14. PB-9: walk-through updated with the batch.
