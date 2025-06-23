import { test, expect } from "@playwright/test";

test.describe("Simple Application Tests", () => {
  test("should load without errors", async ({ page }) => {
    await page.goto("/");

    // Just check that the page loads without throwing errors
    await page.waitForLoadState("networkidle");

    // Verify we're on the right page by checking URL
    expect(page.url()).toContain("/");
  });

  test("should have correct title", async ({ page }) => {
    await page.goto("/");

    // Check page title contains expected text
    await expect(page).toHaveTitle(/Sentry MCP/);
  });

  test("should have basic HTML structure", async ({ page }) => {
    await page.goto("/");

    // Check basic HTML elements exist (using first() to avoid duplicates)
    await expect(page.locator("html")).toBeVisible();
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("#root")).toBeVisible();
  });

  test("should be responsive", async ({ page }) => {
    // Test mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Just verify page loads on mobile
    await expect(page.locator("body")).toBeVisible();

    // Test desktop size
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Just verify page loads on desktop
    await expect(page.locator("body")).toBeVisible();
  });

  test("should have proper meta tags", async ({ page }) => {
    await page.goto("/");

    // Check viewport meta tag exists
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveCount(1);

    // Check charset meta tag exists
    const charset = page.locator("meta[charset]");
    await expect(charset).toHaveCount(1);
  });
});
