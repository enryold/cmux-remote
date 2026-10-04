import { expect, test } from "@playwright/test";
import { login } from "./helpers";
const control = "http://127.0.0.1:3458";
test.beforeEach(async ({ request }) => { await request.post(`${control}/reset`); });

test("views browser captures, zooms locally, refreshes and isolates terminal input", async ({ page, request }) => {
  await login(page);
  await expect(page.getByText("Browser · https://preview.example", { exact: true })).toBeVisible();
  await expect(page.getByText(/password|private\?token|fragment/)).toHaveCount(0);
  await page.getByRole("button", { name: "Browser preview", exact: true }).click();
  const image = page.getByRole("img", { name: "Surface capture" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(256);
  await expect(page.getByText(/Captured/)).toBeVisible();
  expect(await page.getByRole("textbox", { name: "Prompt or command" }).count()).toBe(0);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
  await page.getByRole("region", { name: "Surface preview" }).evaluate((element) => { element.scrollTop = 100; element.scrollLeft = 100; });
  let calls = await (await request.get(`${control}/calls`)).json();
  expect(calls.filter((item: { method: string }) => item.method === "browser.screenshot")).toHaveLength(1);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Capturing preview…")).toHaveCount(0);
  calls = await (await request.get(`${control}/calls`)).json();
  expect(calls.filter((item: { method: string }) => item.method === "browser.screenshot")).toHaveLength(2);
  expect(calls.some((item: { method: string; surfaceId: string }) => item.method.startsWith("browser.") && item.method !== "browser.screenshot")).toBe(false);
  expect(calls.some((item: { method: string; surfaceId: string }) => item.surfaceId === "dddddddd-dddd-4ddd-8ddd-dddddddddddd" && /^(surface\.|terminal\.)/.test(item.method))).toBe(false);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "API Agent" }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("api ready");
});
test("marks failed refresh stale and returns on panel closure", async ({ page, request }) => {
  await login(page); await page.getByRole("button", { name: "Browser preview" }).click();
  await expect(page.getByRole("img")).toBeVisible();
  await request.post(`${control}/fail`);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText(/Capture may be stale/)).toBeVisible();
  await expect(page.getByRole("img")).toBeVisible();
  await request.post(`${control}/close`);
  await expect(page.getByRole("heading", { name: "Surfaces" })).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(0);
});
test("clears capture on disconnect, reconnects, and expires auth", async ({ page, context }) => {
  await login(page); await page.getByRole("button", { name: "Browser preview" }).click();
  await expect(page.getByRole("img")).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(0);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.getByRole("img")).toBeVisible();
  await context.clearCookies();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("textbox", { name: "Pairing code" })).toBeVisible();
  await expect(page.getByText("Session expired", { exact: true })).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(0);
});
test("shows native and unknown panels as unavailable without terminal controls", async ({ page }) => {
  await login(page);
  for (const title of ["Plan.md", "Image.png", "Other panel"]) {
    await page.getByRole("button", { name: title, exact: true }).click();
    await expect(page.getByText(/Preview unavailable/)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Prompt or command" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back" }).click();
  }
});
