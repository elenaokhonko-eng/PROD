import { defineConfig, devices } from '@playwright/test'

// Brief W1 §H: generates the public sample outputs once, on staging, from the fictional case in
// content/samples/fictional-case.md. Run by hand, never in CI (it creates a Clerk test user and calls the models):
//   HARBOR_SAMPLES_BASE_URL=https://guidebuoy-staging-web.onrender.com \
//   pnpm exec playwright test --config=tests/e2e/playwright.samples.config.ts
const baseURL = process.env.HARBOR_SAMPLES_BASE_URL ?? ''
if (!/^https:\/\/guidebuoy-staging-web\.onrender\.com\/?$/.test(baseURL)) {
  throw new Error('HARBOR_SAMPLES_BASE_URL must be the staging site: samples are never generated against production.')
}

export default defineConfig({
  testDir: './samples',
  timeout: 45 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
})
