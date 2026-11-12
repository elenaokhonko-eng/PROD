import { devices } from '@playwright/test'
import { createHarborConfig } from './config'

// Cutover gate 8 (8 Nov): the free journey on an emulated iPhone (WebKit) and Android phone (Chromium), and on desktop
// with the keyboard only, against staging. Not part of every CI run (each is a full fresh-account journey); run before
// cutover:  pnpm exec playwright test --config=tests/e2e/playwright.devices.config.ts
// Emulation is not a real device or a real screen reader: those passes stay manual (docs/release checklist).
const base = createHarborConfig('authenticated')

export default {
  ...base,
  testMatch: ['devices/**/*.spec.ts'],
  workers: 3,
  retries: 0,
  projects: [
    { name: 'iphone-13-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'pixel-7-android', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-keyboard', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
}
