import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("fits the phone locally without resizing the Mac terminal", async ({ page }) => {
  const viewports: unknown[] = [];
  let reads = 0;
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    const message = JSON.parse(String(frame.payload));
    if (message.method === "terminal.viewport") viewports.push(message.params);
    if (message.method === "surface.read_text") reads++;
  }));
  await page.setViewportSize({ width: 393, height: 852 });
  await login(page);
  await page.getByRole("button", { name: "API Agent" }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("api ready");
  await page.getByRole("button", { name: "Shortcuts" }).click();
  await page.getByRole("button", { name: "Increase font" }).click();
  await page.getByRole("button", { name: "Close shortcuts" }).click();
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "14px");
  await page.setViewportSize({ width: 393, height: 647 });
  await expect.poll(async () => {
    const container = await page.getByRole("region", { name: "Terminal" }).boundingBox();
    const screen = await page.locator(".xterm-screen").boundingBox();
    if (!container || !screen) return Infinity;
    return screen.y + screen.height - (container.y + container.height);
  }).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "API Agent" }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("api ready");
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "14px");
  await expect.poll(() => reads).toBeGreaterThan(4);
  expect(viewports).toEqual([]);
});

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

test("saves launcher favorites, operates a question menu, and persists font", async ({ page }) => {
  const inputs: Array<{ method: string; params: { text?: string; key?: string } }> = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    const message = JSON.parse(String(frame.payload));
    if (message.method === "surface.send_key" || message.method === "surface.send_text") inputs.push(message);
  }));
  await login(page);
  await page.getByRole("button", { name: "Tests", exact: true }).click();
  await page.getByRole("button", { name: "Shortcuts" }).click();
  const dialog = page.getByRole("dialog", { name: "Shortcuts" });
  await dialog.getByLabel("Shortcut name").fill("Launch Codex");
  await dialog.getByLabel("Command", { exact: true }).fill("codex-dsp");
  await dialog.getByRole("button", { name: "Save command" }).click();
  await dialog.getByRole("button", { name: "Pin Launch Codex" }).click();
  await dialog.getByRole("button", { name: "Increase font" }).click();
  await expect(dialog.getByText("14 px", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close shortcuts" }).click();
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "14px");
  expect(inputs).toHaveLength(0);
  await page.getByRole("button", { name: "Launch Codex", exact: true }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("codex-dsp<enter>");
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.fill("fixture:question"); await composer.press("Enter");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("Open choices with Shift+Left");
  await page.getByRole("button", { name: "Shift+←", exact: true }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("Choice 1");
  await page.getByRole("button", { name: "↓", exact: true }).click();
  await composer.press("Enter");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("Confirmed choice 2");
  expect(inputs.filter((item) => item.params.text === "codex-dsp")).toHaveLength(1);
  const prior = inputs.length;
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Tests", exact: true }).click();
  await expect(page.getByRole("button", { name: "Launch Codex", exact: true })).toBeVisible();
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "14px");
  expect(inputs).toHaveLength(prior);
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

test("keeps touch scrolling in the terminal when reversing at its bottom edge", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 393, height: 647 });
  await login(page);
  await page.getByRole("button", { name: "Shell", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.fill("fixture:scroll");
  await composer.press("Enter");
  await composer.blur();
  const terminal = page.getByRole("region", { name: "Terminal" });
  const text = terminal.locator(".xterm-accessibility-tree");
  await expect(text).toContainText("history 1999");
  const viewport = terminal.locator(".xterm-viewport");
  const bottom = await viewport.evaluate((element) => element.scrollTop);
  expect(bottom).toBeGreaterThan(1_000);
  const bars = page.locator(".app-header, .terminal-controls, .status-bar");
  const positions = await bars.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
  const screen = await terminal.locator(".xterm-screen").boundingBox();
  if (!screen) throw new Error("Missing terminal screen");
  const x = screen.x + 30;
  const y = screen.y + screen.height / 2;
  // Push past the newest output, then reverse without lifting the finger.
  const offsets = [-20, -50, -100, -120, -80, -40, 0, 50, 100];
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const offset of offsets) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + offset }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    // Playwright WebKit exposes taps only; exercise xterm's touch handlers with DOM events.
    await page.evaluate(async ({ x, y, offsets }) => {
      // Touch events keep their original hit target even after terminal rows are repainted.
      const element = document.elementFromPoint(x, y);
      if (!element) throw new Error("Missing terminal touch target");
      const touch = (type: string, pageY: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ pageX: x, pageY }] });
        element.dispatchEvent(event);
      };
      touch("touchstart", y);
      for (const offset of offsets) {
        touch("touchmove", y + offset);
        await new Promise(requestAnimationFrame);
      }
      touch("touchend", y + offsets[offsets.length - 1]);
    }, { x, y, offsets });
  }
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeLessThan(bottom - 60);
  await expect(text).not.toContainText("history 1999");
  expect(await bars.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y))).toEqual(positions);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(text).toContainText("history 1999");
  await page.mouse.move(screen.x + 10, screen.y + 8);
  await page.mouse.down();
  await page.mouse.move(screen.x + 100, screen.y + 8, { steps: 5 });
  await page.mouse.up();
  await expect(terminal.locator(".xterm-selection > div").first()).toBeVisible();
});
