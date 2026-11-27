import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const url = "http://127.0.0.1:3102";
for (const [width, height] of [
  [375, 812],
  [812, 375],
  [1440, 900],
]) {
  test(`receipt form is accessible at ${width}x${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url);
    await page
      .getByRole("button", { name: "Record receipt and view details" })
      .click();
    await expect(
      page.getByLabel("Portions received", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Portions received", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("checkbox", { name: "Report a delivery problem" }),
    ).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const button of await page.getByRole("button").all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: testInfo.outputPath("receipt.png"),
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
test("photo upload errors preserve quantities and the code still confirms", async ({
  page,
}) => {
  await page.route("**/delivery-photo", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Upload unavailable. Retry or request a code.",
      }),
    }),
  );
  await page.goto(url);
  await page
    .getByRole("button", { name: "Record receipt and view details" })
    .click();
  await page.getByLabel("Portions received", { exact: true }).fill("398");
  await page
    .getByLabel("Receipt photo", { exact: true })
    .setInputFiles({
      name: "food.png",
      mimeType: "image/png",
      buffer: Buffer.from("photo"),
    });
  await page.getByRole("button", { name: "Confirm with photo" }).click();
  await expect(page.getByRole("alert")).toContainText("Upload unavailable");
  await expect(
    page.getByLabel("Portions received", { exact: true }),
  ).toHaveValue("398");
  await page
    .getByRole("button", { name: "Record quantities and get receipt code" })
    .click();
  await expect(page.getByText("123456", { exact: true })).toBeVisible();
});
test("photo-only receipt confirms when the supplier cannot enter a code", async ({
  page,
}) => {
  await page.route("**/delivery-photo", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ evidenceId: "photo-test" }),
    }),
  );
  await page.goto(url);
  await page
    .getByRole("button", { name: "Record receipt and view details" })
    .click();
  await page.getByLabel("Portions received", { exact: true }).fill("400");
  await page
    .getByLabel("Receipt photo", { exact: true })
    .setInputFiles({
      name: "food.png",
      mimeType: "image/png",
      buffer: Buffer.from("photo"),
    });
  await page.getByRole("button", { name: "Confirm with photo" }).click();
  await expect(page.getByText("confirmed", { exact: true })).toBeVisible();
});
test("supplier dispatch sends required fields and a request reference", async ({
  page,
}) => {
  await page.goto(`${url}?mode=dispatch`);
  await page.getByRole("combobox", { name: "School", exact: true }).selectOption("school-test");
  await page.getByLabel("Portions dispatched", { exact: true }).fill("400");
  await page.getByLabel("Vehicle", { exact: true }).fill("KAA 100A");
  await page.getByLabel("Docket reference", { exact: true }).fill("DK-100");
  await page
    .getByRole("button", { name: "Dispatch delivery", exact: true })
    .click();
  await expect(
    page.getByText("Delivery reference", { exact: true }),
  ).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          deliveryFixture: { calls: { args: Record<string, unknown> }[] };
        }
      ).deliveryFixture.calls,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toMatchObject({
    portions: 400,
    vehicle: "KAA 100A",
    docketRef: "DK-100",
    requestId: expect.any(String),
  });
});
test("admin resolution requires a reason and forecasts preserve missing states", async ({
  page,
}) => {
  await page.goto(`${url}?mode=admin`);
  await page.getByRole("button", { name: "Open delivery details" }).click();
  await expect(
    page.getByRole("button", { name: "Record resolution" }),
  ).toBeDisabled();
  await page
    .getByLabel("Reason (required)")
    .fill("Confirmed with school contact");
  await expect(
    page.getByRole("button", { name: "Record resolution" }),
  ).toBeEnabled();
  await expect(page.getByText("0 portions", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Forecast unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Not a school day", { exact: true }),
  ).toBeVisible();
});
