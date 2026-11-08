import { defineConfig, devices } from '@playwright/test'

// Production canary (cutover gate 7): one fresh-account free evaluation against CANARY_BASE_URL. Run by
// .github/workflows/production-canary.yml; never by the release lanes. No staging fixtures: this config targets
// production on purpose.
export default defineConfig({
  testDir: '.',
  testMatch: ['canary/**/*.spec.ts'],
  timeout: 20 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.CANARY_BASE_URL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
