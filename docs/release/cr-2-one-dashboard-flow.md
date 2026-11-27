# CR-2: one flow inside "My cases" (replaces PB-18 and PB-19, PR #118)

> **Read this first (27 Nov, 21:00):** the final, detailed requirements for the Part B release are in
> [part-b-release-requirements-2026-11-27.md](part-b-release-requirements-2026-11-27.md). It includes everything
> below plus later decisions: three answers to "Has your bank answered?", failure messages without a refund sentence,
> the full "a pack is never reduced" rule, and all approved wording. Where the two differ, that file is the requirement.

Decided by Elena on 26 Nov 2026, after the Part B re-test on staging `9b8a813`. **Amended 27 Nov 2026** (section "FIDReC pack: sold upfront, questionnaire after payment"). For the coding agent. Goes on main with the Part B batch; #118 is removed from the batch.

## Why

The re-test showed the product losing its way when it tries to carry "this person wanted a pack" across sign-up, the story and the free evaluation: a home-page loop for a new account, pack buttons in the dashboard leading to the public home page, and a Stripe page opening from the free evaluation button. CR-2 removes that carried state.

## The rule

After sign-in, everything happens inside the "My cases" dashboard. The public home page is for visitors who are not signed in.

## Two ways in, one path after

**A. Free evaluation first (unchanged for the visitor).**
1. Visitor tells the story on the public home page and signs up.
2. Free evaluation: story, questions, documents, results, report.
3. Under the report: the Bank dispute pack, then the FIDReC pack.
4. Choosing a pack goes straight to Stripe. After payment the person returns to that case.

**B. Pack first (kept).**
1. Visitor presses a pack card on the home page or a button on the pricing page. Both lead the same way.
2. Sign up.
3. Straight to Stripe, for both packs (amended 27 Nov: no FIDReC question before payment).
4. After payment: "My cases".
5. "Add a new case" opens the in-dashboard story page. For a FIDReC pack, the timeline questionnaire comes first (below).
6. "Submit the story" leads to the list of documents for the pack that was bought (bank or FIDReC).

## Pack buttons for a signed-in person (27 Nov)

A person is never charged on an empty case when they already have a real one.
- No case with a story: the pack-first flow.
- Exactly one case with a story: that case, with the offer shown; nothing is charged until they press it.
- Several: "My cases", no payment, to choose a case or add a new one.
- Only case already has a FIDReC report and they press the bank pack: "My cases", to add a new case.
- A story told on the public home page fills a waiting empty case first.

## FIDReC pack: sold upfront, questionnaire after payment (amended 27 Nov)

**Intent.** The FIDReC pack's purchase and generation are blocked as little as FIDReC's own rules allow. The worst case for a buyer is that the pack waits: until the bank replies, or until they have sent the bank a complaint and come back.

**Before Stripe: a plain statement, not a gate.** Shown on the payment step for the FIDReC pack. Wording approved by Elena on 27 Nov 2026:

> "FIDReC takes a complaint after you have complained to your bank, and the bank has answered or four weeks have passed. If that is not yet your situation, your pack waits for you until it is."

**After payment: the timeline questionnaire is the first step** of the FIDReC case (My cases, add a new FIDReC case, questionnaire, then the story). It asks: whether and when the person complained to the bank in writing; whether the bank has answered and when; whether a reply says it is final, and its date.

**What each answer leads to.** No refund is offered in these screens. Wording approved by Elena on 27 Nov 2026, to be used exactly as written.

| Situation | Rule | What happens | Approved wording |
|---|---|---|---|
| Bank has answered and the matter is not resolved | 13(1)(i) | Generate | none needed |
| Four weeks have passed since the written complaint | 13(1)(i), 4(1)(v) | Generate | none needed |
| Complained in writing, no answer yet, under four weeks | 13(1)(i) | Pack waits; the date is shown | "FIDReC takes a complaint once your bank has answered and the matter is not resolved, or four weeks after your written complaint (Rule 13(1)(i)). Your written complaint is dated [date], so the four weeks end on [date]. You can wait for your bank's reply, or write to your bank now and ask for its answer. Your pack is ready to generate as soon as either happens." |
| Not complained to the bank in writing yet | 4(2) | Pack waits; the bank pack is offered | "FIDReC sends back a dispute that was not first raised with the bank (Rule 4(2)). The Bank dispute pack prepares that written complaint from your facts. Send it to your bank, then come back here when your bank replies, or when its reply does not resolve the matter. Your FIDReC pack waits for you." |
| A final reply more than six months old | 13(1)(ii), 5(vi), 13(2) | Generate. The pack states both dates and Rule 5(vi) | The two-dates sentence and the Rule 13(2) passage approved on 26 and 27 Nov, shown once |

**Not built on a reset.** Nothing says or implies that a new letter from the bank restarts the six months. The approved wording stands: whether a document is a final reply is decided by FIDReC (Rule 13(2)).

**One check.** The questionnaire, the "can generate" decision and the generator use one shared check, so a pack is never refused after the screen said it could be generated.

**Replaces:** the route question before Stripe; the block on a final reply older than six months (built 26–27 Nov).

**Settled by Elena on 27 Nov 2026:**
- A FIDReC buyer who has not complained to the bank yet pays S$18 for the Bank dispute pack. It is not included with the FIDReC pack.
- No screen offers a refund. The Terms still apply: a customer who comes back and asks for a refund is handled under them.

## Screens

- **My cases** always shows "Add a new case", whether or not the person has a case.
- **In-dashboard story page**: a copy of the home page's story box only (type or speak), inside the dashboard frame, with the button "Submit the story". It is not the public home page and has no marketing content.
- **A signed-in person is never sent to the public home page** by any pack button, "create your case" link or post-payment return.
- **FIDReC pack report page**: no Bank dispute pack offer. The packs stay independent (either can be bought on its own); a person who bought both still sees both of their packs.
- **After Stripe**: "Confirming your payment" until the purchase is recorded, then "Payment received for your [pack]. Add a new case to tell your story." After backing out: "Payment cancelled. You have not been charged."

## Paying before a case exists

Option A (approved): an empty case is created before Stripe; the purchase attaches to it; "Add a new case" fills that case first. Migration `20261127120000_pack_first_cases`, approved for staging on 27 Nov.

## Standing rule: a pack is never reduced (27 Nov)

Every section of the confirmed schema is always present. A conflict, a doubtful document or a blocked detail is described in neutral words approved by Elena, never dropped. A pack that cannot be completed is not delivered; the person can try again.

## Tests required

- A brand-new account starting at the pricing page, for each pack, through to the documents list.
- The same from a home-page pack card.
- A signed-in person with no case, one case and several: each pack button lands where the rules above say, and never on the public home page.
- Free evaluation button never opens Stripe.
- After Stripe from inside a case: returns to that case.
- FIDReC questionnaire: each of the five situations leads to the outcome in the table, and the generator agrees.

## Not in CR-2

- Police section, verified sources and the "Sources" line: with `feat/fidrec-update`.
