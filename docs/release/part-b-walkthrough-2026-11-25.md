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

Cause: the checklist marks a fact as shown when the confirmed value has a document among its sources. In all four
extraction runs on the case, the statement gave the transactions, account type and loss but never an institution. The
extraction prompt (`fact-extract-v3` on main, and `fact-extract-v4` on `feat/fidrec-update`) has no rule that the bank
or provider that issued a statement or letter is an institution involved, so the model leaves the header out.

Fix:
- Add the rule to both prompts: the bank or provider that issued a statement, alert or letter is an institution, quoting
  its name as printed. Bump the prompt version so earlier runs are re-extracted (as E7 of 7 Nov).
- Backstop without the model: for a bank statement, card statement or bank letter that returns no institution, take the
  known bank and e-wallet names printed in it (`institutionsMentioned`). Unknown names are not guessed.
- Synthetic contract tests: a statement headed by a known bank and one headed "Synthetic Bank".

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

Proposed rule (needs Elena's decision): a bank letter whose payments match none of the confirmed disputed payments
counts only as context, never as proof, and the checklist says the letter is about a different payment.

### PB-9 (walk-through): steps 2.4–2.6 assumed the upload came before confirming

Journey 5 (try to continue without the police report) leads to confirming first, so 2.4–2.6 had nothing to show. After
PB-2 both orders behave the same; the walk-through gets the confirm-first order as its own steps.

## Order of work

1. PB-1, PB-2, PB-5: code fixes with tests, on main, through the gates.
2. PB-3, PB-4, PB-6, PB-7 names: once Elena approves the wording.
3. PB-7 prompt and PB-8: on `feat/fidrec-update`, before Elena's switch-on review.
4. PB-9: walk-through updated, then 2.4–2.6 re-run on staging.
