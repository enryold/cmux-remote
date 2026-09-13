import { defineConfig, devices } from "@playwright/test";
import { E2E_CAPABILITY_HEADERS } from "./e2e/helpers";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3457",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun e2e/start.ts",
    url: "http://127.0.0.1:3457/health",
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        extraHTTPHeaders: E2E_CAPABILITY_HEADERS,
      },
    },
    {
      name: "iphone-webkit",
      use: {
        ...devices["iPhone 15"],
        extraHTTPHeaders: E2E_CAPABILITY_HEADERS,
      },
    },
  ],
});
