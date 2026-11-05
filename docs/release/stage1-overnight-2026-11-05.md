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
