import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const [width, height] of [
  [375, 812],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [812, 375],
]) {
  test(`sign in is accessible at ${width}×${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/school?date=2026-10-20");
    await expect(
      page.getByRole("heading", { name: "Sign in", exact: true }),
    ).toBeVisible({ timeout: 25000 });
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByLabel("Email", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page
      .getByRole("button", { name: "Need an account? Sign up" })
      .click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await page.screenshot({
      path: testInfo.outputPath("sign-in.png"),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("legacy service-day redirects and retains its date", async ({ page }) => {
  await page.goto("/service-day?date=2026-10-20");
  await expect(page).toHaveURL(/\/school\?date=2026-10-20$/);
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

// Provide a test account's saved Playwright state; these checks do not mutate records.
test.describe("authenticated school navigation", () => {
  test.skip(
    !process.env.E2E_SCHOOL_STATE,
    "Requires a school test account storage state",
  );
  test.use({ storageState: process.env.E2E_SCHOOL_STATE });
  test("focused pages preserve dates, refresh and browser history", async ({
    page,
  }) => {
    await page.goto("/school?date=2026-10-20");
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Simulate taps" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Roster corrections" }),
    ).toHaveCount(0);
    const nav = page.getByRole("navigation", {
      name: "Workspace navigation",
      exact: true,
    });
    await nav.getByRole("link", { name: "Meal service", exact: true }).click();
    await expect(page).toHaveURL(/\/school\/service\?date=2026-10-20$/);
    await expect(
      page.getByText("Staff overrides always record", { exact: false }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Service day", { exact: true })).toHaveValue(
      "2026-10-20",
    );
    await nav.getByRole("link", { name: "Pupils", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Active pupils" }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Meal service", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await nav.getByRole("link", { name: "Operations tools" }).click();
    await expect(
      page.getByRole("button", { name: "Simulate taps" }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});

test.describe("authenticated dashboard performance", () => {
  test.skip(
    !process.env.E2E_SCHOOL_STATE,
    "Requires a school test account storage state",
  );
  test.use({ storageState: process.env.E2E_SCHOOL_STATE });
  test("school overview renders within two seconds on 3G", async ({
    page,
    context,
  }, testInfo) => {
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 100,
      downloadThroughput: 750000 / 8,
      uploadThroughput: 250000 / 8,
    });
    const start = Date.now();
    await page.goto("/school");
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Loading service counts…")).toHaveCount(0);
    const duration = Date.now() - start;
    await testInfo.attach("3g-render-ms", {
      body: String(duration),
      contentType: "text/plain",
    });
    expect(duration).toBeLessThan(2000);
  });
});
