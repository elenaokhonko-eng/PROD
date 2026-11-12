# Free-evaluation hardening (8 November 2026)

Elena's hardening brief after her own case failed with "We couldn't produce an evaluation that matches your facts
exactly". Items 1, 2, 4 and 6 gate G3b; items 3, 5, 7 and 8 gate cutover. Data here is synthetic; counts only.

## 1. Repair ladder (done)

The summary is the only model-written section; every other section is built from the confirmed facts. It now comes
from a ladder (`supabase/functions/_shared/facts/summary-ladder.ts`):

1. generate; repair in code what can be repaired exactly (qualifiers on facts without a document or marked unsure);
2. any remaining violation: regenerate once with the violations fed back, repair again;
3. still failing, or the provider failed after its retry: the **summary version**, the confirmed facts in fixed
   wording with no model text, titled "Free evaluation summary (summary version)".

Hard checks (facts): amount, date, institution, reference, contradiction, unqualified, forbidden (SRF verdict).
Soft checks (style): second person, internal wording, length. "Failed" remains only for infrastructure errors
(database, auth). Each run writes an `analytics_events` row (`free_evaluation_summary` or
`free_evaluation_summary_version`) with case and snapshot IDs, check names, attempts, model, prompt version and release.

## 2. Corpus (done; target not fully met)

`scripts/tier0-corpus` runs 51 synthetic stories (SMS, email, call, malware, investment, job and e-commerce scams;
card-only, multi-account and e-wallet losses; several currencies; one-line and 1,500-word stories; Singlish, Malay and
Chinese; ambiguous and missing dates; "S$2.4k", amounts in words; "not sure" on every card; no documents, OCR noise,
an unrelated document; self-contradicting stories) through the production extraction, reconciliation, snapshot and
ladder, three times each, against the real models. A stronger model (gpt-4.1) judges every delivered summary.

| Run | Delivered from the model | Summary version | of which extraction missed the value | Judge flags (before adjudication) |
|---|---|---|---|---|
| 1 (baseline rules) | 87.6% | 19 | not measured | 113 of 134 |
| 2 | 90.8% | 14 | not measured | 48 of 139 |
| 3 | 92.8% | 11 | 9 | 37 of 142 |
| 4 (final rules) | 90.8% | 14 | 11 | 40 of 139 |

Run-to-run variation is about ±2 points. Excluding summary versions caused by a value the story states but extraction
missed (the check was right to refuse it; a real person would have added it on the confirm screen), runs 3 and 4
delivered 98.6% and 97.9% from the model. **The ≥98% target is met only in that reading; the remaining gap is in fact
extraction, not the summary.**

Rules the corpus showed were wrong, now fixed with tests: "not confirmed whether …" counted as a statement; a loss split
by account rejected; payees on confirmed payments treated as institution claims; "a loss from your bank account" read
as telling the bank. Hard-rule gaps it found, now closed: unconfirmed reference numbers; amounts without a document
stated as fact; the bank named rather than called "the bank"; bank replies and offers by a named institution; a police
report described as filing, a visit or contacting the police; a story-only police report number treated as a document.

Adjudicated judge flags on the final run: no delivered summary states an amount, date, institution or reference that is
not a confirmed fact. Three meaning-level slips remain (3 in 139). Checked against the confirmed facts, only one is
the summary's: "You have not received a reply from the bank" where the reply was marked "Not sure". The other two
match the confirmed facts, which extraction got wrong: a FIDReC filing confirmed as "a full written complaint", and
one of two payments missing, so "a total of S$3,200" was all that was confirmed.

Extraction gaps seen (for the extraction prompt, not this stage): "reported it to the bank and the police" missed; a
utility GIRO debit on a statement taken as a disputed payment; institution missed when only in the story.

The summary model is pinned to `gpt-4o-mini-2024-07-18`; re-run the corpus before changing the model or the prompt.

## 3. Provider failures (done; reaper existed)

429, 5xx, timeouts, malformed or empty output: one retry within a 90 s budget, then the summary version. A safety
refusal (`refusal` or `content_filter`) goes straight to the summary version. Tested with a fake provider. A facts check
left running over 5 minutes counts as abandoned (now tested); worker jobs are reclaimed after their 15-minute lease.

## 4. Flow edge cases (tests added; three product fixes)

`tests/e2e/authenticated/free-evaluation-edge-cases.spec.ts`: double-click, refresh mid-generation, two tabs, session
expiry during the fact check, an answer changed after confirmation, a document removed after confirmation, and
another user against 15 case routes. Fixed from what it found: a double-click started two generations; an evaluation
made from facts that changed was not marked out of date; deleting a document left its facts; a session revoked
mid-request showed "Something went wrong" instead of sign-in.

## 6. Privacy in failure paths (done)

Edge Functions, API routes, the worker and the mailer log and return IDs, codes and scrubbed messages only
(`supabase/functions/_shared/safe-error.ts`). Live staging Render logs (about 8,500 lines): no story or amount content.
Rows not linked to a case on deletion (review rows in `analytics_events`, `edge_request_nonces`) are covered by
`docs/runbooks/privacy-case-deletion.md`.

`anonymized_training_data` (Elena, 8 Nov: it contradicts the Privacy Policy, and regex masking is not anonymisation):
the router's writer is removed, a contract test (`no-training-data.test.ts`) fails if any app, worker or Edge Function
code references the table, and staging held 0 rows (checked and emptied 8 Nov). The table has row-level security with
no policies, so only the service role could write to it. Production starts with it empty and nothing writes to it.

"Report a problem" carries the person's own description, the page, case ID, time, error code and failed check names,
browser, account email and release; the route loads no case content. Limited to 5 per account and 20 per IP in 10
minutes. The panel asks for what the page did, not the details of the case.

## Stage 2 (after launch; need approval)

- **Drop `anonymized_training_data`** in a new migration (proposal, not written yet:
  `drop table if exists public.anonymized_training_data;` with the policy test updated). No schema change in stage 1.
- **Improve fact extraction.** Most summary versions in the corpus came from facts the story states but extraction
  missed ("reported it to the bank and the police", institution named only in the story), and a utility GIRO debit on a
  statement was taken as a disputed payment. Re-run the corpus to measure.
- **Weekly fallback-rate metric in production**: share of `free_evaluation_summary_version` among all
  `free_evaluation_summary*` rows in `analytics_events`, with the most frequent check names, reported weekly and
  alerting above 5%.

## Not started (gate cutover)

5 (load test), 7 (production canary), 8 (mobile browsers, keyboard and screen reader).
