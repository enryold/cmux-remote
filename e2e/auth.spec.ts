import { expect, test } from "@playwright/test";
import { E2E_TOKEN } from "./helpers";

test("requires login and discovers a new terminal without reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "cmux Remote" })).toBeVisible();
  await page.getByLabel("Access token").fill("wrong");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Authentication failed")).toBeVisible();

  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("button", { name: "API Agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New terminal" })).toBeVisible();
  await expect(page.locator(".terminal-row")).toHaveCount(9);
});
