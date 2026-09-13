import { expect, test } from "@playwright/test";
import { E2E_PAIRING_CODE } from "./helpers";

test("pairs once on iPhone and keeps the session after reload", async (
  { page },
  testInfo,
) => {
  test.skip(testInfo.project.name !== "iphone-webkit");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "cmux Remote" })).toBeVisible();
  await page.getByLabel("Pairing code").fill("000000");
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.getByText("Authentication failed")).toBeVisible();

  await page.getByLabel("Pairing code").fill(E2E_PAIRING_CODE);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.getByRole("button", { name: "API Agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New terminal" })).toBeVisible();
  await expect(page.locator(".terminal-row")).toHaveCount(9);

  await page.reload();
  await expect(page.getByRole("button", { name: "API Agent" })).toBeVisible();
});

test("does not offer pairing without the device capability", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  await context.setExtraHTTPHeaders({});
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByText("Device not authorized")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pair" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
