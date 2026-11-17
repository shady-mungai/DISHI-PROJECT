import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm exec vite --config e2e/delivery-fixture/vite.config.mts",
      url: "http://127.0.0.1:3102",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm exec vite --config e2e/reader-fixture/vite.config.mts",
      url: "http://localhost:3101",
      reuseExistingServer: !process.env.CI,
    },
    ...(process.env.E2E_BASE_URL
      ? []
      : [
          {
            command: "pnpm start --port 3100",
            url: "http://localhost:3100",
            reuseExistingServer: !process.env.CI,
          },
        ]),
  ],
});
