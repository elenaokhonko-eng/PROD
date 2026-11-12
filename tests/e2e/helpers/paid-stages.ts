// Whether the environment under test takes payments. Stage 1 launches the free evaluation only, so unset means off,
// matching the server (lib/billing/paid-stages.ts). CI sets HARBOR_PAID_STAGES_ENABLED from the environment's
// PAID_STAGES_ENABLED value.
export const paidStagesEnabled = process.env.HARBOR_PAID_STAGES_ENABLED?.trim().toLowerCase() === 'true'

export const PAID_STAGES_DEFERRED = 'Stage 2: paid stages are off on this environment (PAID_STAGES_ENABLED is not true).'
