# Stage 1 overnight run, 2026-11-05 to 06: decisions and evidence

Instruction (Elena, 2026-11-05 evening): build the complete stage 1 free-assessment path on staging by 09:00, no
check-ins; follow spec v3 and design revision 2; where they are silent choose the simpler option and record it here.
No production, ujila or `user-golden`; no test deleted or weakened; no new secrets or allow rules; no deploys after
08:30.

## Decisions made under the defaults

| # | Decision | Why |
|---|---|---|
| D1 | One server switch, `PAID_STAGES_ENABLED`, gates both paid products. Anything other than exactly `true` (including unset) means off: checkout returns 409 `product_not_available` with `availableFrom`, and the capabilities response turns both buy buttons off. | A missing setting can never take payments. One switch is simpler than one per product for a launch where both are off. The design's bank-pack emergency switch (`BANK_PACK_ENABLED`) stays a stage 2 item. |
| D2 | The "available from" date comes from `PAID_STAGES_AVAILABLE_FROM` (ISO date), defaulting to 2026-12-01, the stage 2 date in the costed plan. | Changing the date is a settings change, not a code change. |
| D3 | The SRF section of the free evaluation is written by the server from `rules/srf.ts`; the model's prompt and output schema no longer contain SRF signals, and any model sentence mentioning the SRF, IMDA or a telco fails the output check. | Elena: "server-only SRF verdict". Simpler than letting the model rephrase the server's wording, and nothing to validate. |
| D4 | Dependency rule implemented as an implied "reported to the bank: yes" candidate for every bank reply (acknowledged, interim or final), from the same source. A "No" elsewhere then becomes an ordinary conflict. If resolutions still combine "No" with a kept reply, freezing the facts is refused (`inconsistent_facts`). "A final reply needs a written complaint or report" is satisfied by the same implied report. | Reuses the existing conflict screen instead of a new kind of finding. |
| D5 | New output checks: a bank reply kept without a document must be attributed (and the "You told us that" fallback covers it); "the bank replied" with confirmed "not told" is a contradiction; text saying both fails; "the user"/"the claimant" fails in the free evaluation. | Elena's three validator items. |
