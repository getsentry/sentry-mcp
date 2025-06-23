import { test as setup } from "@playwright/test";

setup("collect coverage", async ({ page }) => {
  // Enable coverage collection
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
  });

  // Enable CSS coverage as well
  await page.coverage.startCSSCoverage({
    resetOnNavigation: false,
  });
});
