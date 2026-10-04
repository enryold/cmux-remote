import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("reads, types, sends mobile keys, and switches exact surfaces", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "API Agent" }).click();
  const terminal = page.getByRole("region", { name: "Terminal" });
  const accessibleText = terminal.locator(".xterm-accessibility-tree");
  await expect(accessibleText).toContainText("api ready");

  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.fill("continue the task");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(accessibleText).toContainText("continue the task<enter>");

  await terminal.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("status");
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(accessibleText).toContainText("status<enter>");
  await page.getByRole("button", { name: "Shortcuts" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Ctrl-C", exact: true }).click();
  await expect(accessibleText).toContainText("<ctrl+c>");

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "UI Agent" }).click();
  const nextText = page
    .getByRole("region", { name: "Terminal" })
    .locator(".xterm-accessibility-tree");
  await expect(nextText).toContainText("ui ready");
  await expect(nextText).not.toContainText("status<enter>");
});

test("preserves the visible history during append and prompt replacement", async ({ page }) => {
  let received = "";
  page.on("websocket", (socket) => socket.on("framereceived", (frame) => {
    const message = JSON.parse(String(frame.payload));
    if (typeof message.result?.text === "string") received = message.result.text;
  }));
  await login(page);
  await page.getByRole("button", { name: "Shell", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.fill("fixture:scroll"); await composer.press("Enter");
  const text = page.locator(".xterm-accessibility-tree");
  await expect(text).toContainText("history 1999");
  const viewport = page.locator(".xterm-viewport");
  await viewport.evaluate((element) => { element.scrollTop = 4000; element.dispatchEvent(new Event("scroll")); });
  await expect(text).not.toContainText("history 1999");
  const anchor = (await text.innerText()).split("\n").find((line) => line.startsWith("history "));
  expect(anchor).toBeTruthy();
  const area = page.locator(".xterm-scroll-area");
  const height = await area.evaluate((element) => element.clientHeight);
  await composer.fill("fixture:append"); await composer.press("Enter");
  await expect.poll(() => received).toContain("latest append");
  await expect.poll(() => area.evaluate((element) => element.clientHeight)).toBeGreaterThan(height);
  await expect(text.locator("[role=listitem]").first()).toHaveText(anchor as string);
  await expect(text).not.toContainText("latest append");
  await composer.fill("fixture:replace"); await composer.press("Enter");
  await expect.poll(() => received).toContain("prompt replaced");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(text.locator("[role=listitem]").first()).toHaveText(anchor as string);
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(text).toContainText("prompt replaced");
});

test("keeps the final terminal row above the mobile controls", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 647 });
  await login(page);
  await page.getByRole("button", { name: "API Agent" }).click();

  const terminal = page.getByRole("region", { name: "Terminal" });
  await expect(terminal.locator(".xterm-accessibility-tree")).toContainText("api ready");

  await expect
    .poll(async () => {
      const container = await terminal.boundingBox();
      const screen = await terminal.locator(".xterm-screen").boundingBox();
      if (!container || !screen) return Number.POSITIVE_INFINITY;
      return screen.y + screen.height - (container.y + container.height);
    })
    .toBeLessThanOrEqual(0);
});
