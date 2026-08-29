import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config()

const baseURL = process.env.SLICE5_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const authStatePath = resolve(process.env.SLICE5_AUTH_STORAGE_STATE ?? 'tests/e2e/.auth/slice5.json')
const hasAuthState = existsSync(authStatePath)
const shouldStartLocalServer =
  process.env.SLICE5_SKIP_WEB_SERVER !== '1' &&
  (baseURL.startsWith('http://localhost') || baseURL.startsWith('http://127.0.0.1'))

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    storageState: hasAuthState ? authStatePath : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: shouldStartLocalServer
    ? {
        command: 'pnpm.cmd dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
})
