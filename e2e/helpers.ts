import type { Page } from "@playwright/test";

export const E2E_TOKEN = "e2e-token-with-at-least-32-bytes";

export async function login(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Terminals" }).waitFor();
}
