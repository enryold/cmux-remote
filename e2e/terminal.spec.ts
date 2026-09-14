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
  await page.getByRole("button", { name: "Ctrl-C" }).click();
  await expect(accessibleText).toContainText("<ctrl+c>");

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "UI Agent" }).click();
  const nextText = page
    .getByRole("region", { name: "Terminal" })
    .locator(".xterm-accessibility-tree");
  await expect(nextText).toContainText("ui ready");
  await expect(nextText).not.toContainText("status<enter>");
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
