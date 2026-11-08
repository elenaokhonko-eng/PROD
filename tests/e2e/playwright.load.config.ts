import { createHarborConfig } from './config'

// Cutover gate 5 (8 Nov): N fresh-account free journeys at once against staging. Not part of CI; run with
//   LOAD_JOURNEYS=5 pnpm exec playwright test --config=tests/e2e/playwright.load.config.ts
const base = createHarborConfig('authenticated')
const journeys = Number(process.env.LOAD_JOURNEYS ?? 5)

export default {
  ...base,
  testMatch: ['load/**/*.spec.ts'],
  workers: journeys,
  repeatEach: journeys,
  retries: 0,
  projects: (base.projects ?? []).filter((p) => p.name === 'chromium-1440'),
}
