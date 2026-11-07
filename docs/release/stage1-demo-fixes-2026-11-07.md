# Stage 1 demo fixes, 2026-11-07: decisions and evidence

Source: Elena's stage 1 demo review of `5c9ca1c` (40 findings, specified as sections A–F). Elena confirmed the D3
notice wording and email booking for consultation (D2). Still with Elena: the B1 story example, the E1 marketing
paragraph and the F legal text. Rules unchanged: no secrets, no real data, no weakened tests, staging only.

The demo case on staging held documents from a real case. Nothing from it is copied anywhere; every fixture and test
value below is synthetic.

## Decisions made under the defaults

| # | Decision | Why |
|---|---|---|
| E1 | The "merged" institution card was one fact with two wrong values: the police force (from a police report) and a reference number typed into a follow-up answer. Fixed at the source: the police, regulators, dispute bodies, government services and strings without letters are never institutions. | Finding 9; spec A2 asks to fix grouping, not display. |
| E2 | "Told the bank" and "police report" compare yes/no and date only; their references are separate facts (`bank_case_reference`, `police_report_number`), shown as their own cards only when sources disagree. | A2, finding 14. |
| E3 | Multi-select facts: institutions, accounts affected, payments, amount lost. All others are single-select; the server refuses several values for them. "Something else" on a multi-select fact adds to the ticked values. | A1. |
| E4 | Fixed-list facts (scam type, first contact, accounts, credentials) always show the whole list as boxes, marking where each value was found; accounts start ticked from the sources. "Something else" appears only where "other" is a valid answer; credentials has none (its list is exhaustive). | A1, A3, A5, A6. |
| E5 | SMS and messaging apps stay separate choices for first contact, although the spec lists "SMS/messaging app" as one: the SRF's mobile-operator duties apply to SMS only, so merging them would lose the telco assessment. Scam type keeps them together. | A5 vs SRF accuracy. |
| E6 | Amount lost: each amount from each source is a box with the account it left from when stated; ticking several gives their sum, with the portions kept. There is no separate "accounts" total card. | A4; the total always equals the ticked amounts by construction. |
| E7 | Document relevance (A7): extraction now returns a document type and a 0–1 confidence per value. A document value counts only if that type of document can state that fact and confidence ≥ 0.7; otherwise it is stored as context and never compared. A value with no confidence is context. Runs from the previous extraction prompt are re-extracted, not reused. | A7, finding 10. |
| E8 | The counter is one sticky element: a bar at the top on small screens, a right-aligned panel on wide ones, rather than two copies. | A8; two copies would also confuse screen readers. |
| E9 | "Report it now" names no bank phone numbers: it points to the number on the back of the card and the bank's official site, plus SPF e-services and the ScamShield Helpline (1799). | C4; a listed number can go out of date. |
| E10 | The evidence checklist shown is the server's two lists; the model's checklist is no longer shown or checked. | C2. |
| E11 | C3 wording (P1): per portion. SRF for bank/e-wallet phishing; for cards, the EUPG and a chargeback through the card issuer; for other unauthorised losses, the EUPG; for payments made knowingly, no liability framework. No liability amounts or ABS document titles are quoted until the P2 rule table sources them clause by clause. Glossary as a "Terms used" footnote. | C3 asks to stop if unclear; nothing is stated that is not certain. |
| E12 | **For Elena:** the spec's FIDReC copy says filing is "free for you". The ToR (Annex 1, 6.4–6.6) has a S$250 complainant fee if the case goes to adjudication. The cards say "it costs nothing to start; a S$250 case fee applies only if your case goes to adjudication". | Your instruction to follow the ToR. |
| E13 | The resources page says the directory is under development and offers no retry; the test that checked the retry now checks there is no retry and no substitute data. | D5. |
| E14 | The home avatar was hidden by quiet mode (the sliders icon), not by dark mode. It now shows in quiet mode, still; elsewhere it floats gently unless reduced motion is on. | E3. |
| E15 | Saved cases are titled "Scam and fraud case" with the institution beneath. `workflow_type` and grouping by workflow wait for stage 2's migration, so brief B stage 1 stays at 38 migrations. | E4 (P1 label, P2 structure). |
| E16 | Paid-path screens (Tier 2 purchase, payment landing) still use "Tier 2" and "server-recorded"; they are unreachable while paid stages are off and are fixed with stage 2. | C1 scope. |
| E17 | The PDF uses the existing case-pack PDF builder and the standard fonts; characters they cannot draw print as "?". | C5 within the 4-hour limit. |
| E18 | Terms and Privacy v2.0 (Elena's final text) are published word for word from `docs/legal/*.md`. The page heading is each file's own title; a contract test checks that every word of each file reaches the page in order, that the header and the version line in the text agree, and that no `privacy@` address remains. Effective 7 November 2026 (Elena, 7 Nov). Elena confirmed: production Supabase and Render run in Singapore, and Google sign-in is enabled on the production Clerk instance. | F. |
| E19 | The automated-output notice (Terms 2.2) is one shared constant and is also in the FIDReC pack's PDF and Markdown downloads, which lacked it; a contract test lists every output screen and download. The bank report has no download yet; its screen shows the notice. | D3, Elena 7 Nov. |
| E20 | Home journey: "Review your draft" (it can be any of the three outputs). Elena's wording. | Elena 7 Nov. |
| E21 | Grouping cases by workflow and the paid-path "Tier 2" copy are postponed: no migrations or schema changes in stage 1. | Elena 7 Nov. |
| E22 | Elena's demo case on staging, which held a real case's documents, was deleted on her instruction: 5 stored files, the case and every row referencing it (18 case tables by cascade, 3 analytics events, 8 request nonces). A scan of every text, JSON and id column in `public` and `storage` finds no remaining mention. Staging backups age out on the provider's retention schedule. | Elena 7 Nov. |
| E23 | B1: the full worked example (synthetic: every name, amount and date invented) is the story box placeholder; the box is taller and the placeholder smaller so most of it shows (on a phone the start shows). The "What should I include?" panel keeps its checklist. E1: the about page uses option 2, "Tell us once." The resources heading says "free evaluation", not "Free Case Pack". | Elena 7 Nov. |
