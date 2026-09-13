import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("recovers after offline and foreground transitions", async ({ page, context }) => {
  await login(page);
  await page.getByRole("button", { name: "API Agent" }).click();
  await context.setOffline(true);
  await expect(page.getByText("Disconnected")).toBeVisible({ timeout: 10_000 });

  await context.setOffline(false);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("api ready")).toBeVisible();
});

test("never stores auth or terminal data in Cache Storage", async ({ page }) => {
  await login(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await fetch("/manifest.json");
    await fetch("/auth/status");
  });

  const cached = await page.evaluate(async () => {
    const entries = await Promise.all(
      (await caches.keys()).map(async (name) =>
        (await caches.open(name)).keys(),
      ),
    );
    return entries.flat().map((request) => new URL(request.url).pathname);
  });
  expect(cached).toContain("/manifest.json");
  expect(cached.some((item) => item.startsWith("/auth/"))).toBe(false);
  expect(cached).not.toContain("/ws");
  expect(cached).not.toContain("/health");
});
