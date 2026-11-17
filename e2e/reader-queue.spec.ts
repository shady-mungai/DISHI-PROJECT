import { test, expect } from "@playwright/test";

test("real reader hooks retain signed taps across failed sync and refresh, then distinguish server verdicts", async ({
  page,
}) => {
  let online = false;
  let verdict: "accepted" | "duplicate" = "accepted";
  await page.route("**/ingest", async (route) => {
    if (!online) return route.abort("internetdisconnected");
    expect(route.request().headers()["x-device-ref"]).toBe("test-reader");
    expect(route.request().headers()["x-signature"]).toMatch(/^[0-9a-f]{64}$/);
    const body = route.request().postDataJSON() as {
      events: { eventId: string }[];
    };
    await route.fulfill({
      json: {
        results: body.events.map((event) => ({
          eventId: event.eventId,
          status: verdict,
        })),
      },
    });
  });
  await page.goto("http://localhost:3101");
  await page.getByRole("button", { name: "Register test device" }).click();
  await page.getByRole("button", { name: "Queue a tap" }).click();
  await expect(page.getByRole("status")).toHaveText("Queued: 1");
  await expect(page.getByRole("listitem")).toHaveCount(0);
  const queued = await page.evaluate(() =>
    localStorage.getItem("dishi.reader.queue"),
  );
  await page.reload();
  await expect(
    page.getByText("Device: test-reader", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Queued: 1");
  expect(
    await page.evaluate(() => localStorage.getItem("dishi.reader.queue")),
  ).toBe(queued);
  online = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("listitem")).toHaveText("accepted", {
    timeout: 15000,
  });
  await expect(page.getByRole("status")).toHaveText("Queued: 0");
  verdict = "duplicate";
  await page.getByRole("button", { name: "Queue a tap" }).click();
  await expect(page.getByRole("listitem").last()).toHaveText("duplicate", {
    timeout: 15000,
  });
  expect(
    await page.evaluate(() => localStorage.getItem("dishi.reader.queue")),
  ).toBe("[]");
});
