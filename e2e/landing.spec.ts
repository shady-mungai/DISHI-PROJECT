import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const [width, height] of [
  [375, 812],
  [812, 375],
  [1440, 900],
]) {
  test(`public landing works at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "A little care.A fuller future.",
    );
    await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.getByRole("link", { name: "How it works", exact: true }).click();
    await expect(page).toHaveURL(/#how-it-works$/);
    await page.getByRole("link", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Sign in", exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("link", { name: "Back to Mlo", exact: false }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "A little care.",
    );
  });
}
test("landing content is available without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "A little care.",
  );
  await expect(
    page.getByRole("link", { name: "Log in", exact: true }),
  ).toHaveAttribute("href", "/login");
  await context.close();
});
