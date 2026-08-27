import { expect, test } from "@playwright/test"

test.use({ baseURL: "http://localhost:3000", storageState: undefined })

test.describe("Harbor public shell", () => {
  test("renders approved navigation, packs, and sensory modes", async ({ page, context }) => {
    const consoleErrors: string[] = []
    await context.route("**/api/router/session", async (route) => {
      await route.fulfill({
        json: {
          session: {
            id: "00000000-0000-4000-8000-000000000001",
            session_token: "router_harbor_e2e",
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
        },
      })
    })
    await context.route("**/api/analytics/track", async (route) => {
      await route.fulfill({ json: { success: true } })
    })
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })

    await page.goto("/")
    await expect(page.getByRole("heading", { name: /Tell it once/i })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toContainText("Pricing")
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).not.toContainText("Analytics")
    await expect(page.getByText("SGD 18 FI Pack", { exact: true })).toBeVisible()

    await page.getByText("Steady", { exact: true }).click()
    await page.getByRole("radio", { name: "Everything feels too much" }).click()
    await expect(page.locator("html")).toHaveAttribute("data-sensory", "quiet")

    await page.getByText("Quiet", { exact: true }).click()
    await page.getByRole("radio", { name: "I need a moment" }).click()
    await expect(page.getByRole("dialog", { name: "Take the time you need." })).toBeVisible()
    await page.getByRole("button", { name: "Continue when ready" }).click()
    await expect(page.locator("html")).toHaveAttribute("data-sensory", "quiet")

    await page.close()
    const restoredPage = await context.newPage()
    restoredPage.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    await restoredPage.goto("/")
    await expect(restoredPage.locator("html")).toHaveAttribute("data-sensory", "quiet")
    expect(consoleErrors).toEqual([])
  })

  test("publishes Pricing and How It Works and redirects the legacy Product route", async ({ page }) => {
    await page.goto("/pricing")
    await expect(page.getByRole("heading", { name: /Start free/i })).toBeVisible()
    await expect(page.getByText("SGD 18", { exact: true })).toBeVisible()
    await expect(page.getByText("SGD 188", { exact: true })).toBeVisible()

    await page.goto("/how-it-works")
    await expect(page.getByRole("heading", { name: /Explain it once/i })).toBeVisible()

    await page.goto("/product")
    await expect(page).toHaveURL(/\/how-it-works$/)
  })

  test("keeps the public shell usable at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
    await expect(page.getByRole("heading", { name: /Tell it once/i })).toBeVisible()
    const bodyOverflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(bodyOverflows).toBe(false)
  })

  test("keeps analytics internal for signed-out visitors", async ({ page }) => {
    await page.goto("/analytics")
    await expect(page.getByText("This page could not be found.")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Acquisition & engagement" })).toHaveCount(0)
  })
})
