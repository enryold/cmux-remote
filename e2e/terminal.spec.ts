import { expect, test } from "@playwright/test";
import { expandInactiveTabs, login } from "./helpers";

test("makes room for a three-line prompt by hiding shortcuts and the footer only while editing", async ({ page, browserName }) => {
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 34, left: 0 } });
  }
  const sent: Array<{ method: string; params: { text?: string; key?: string } }> = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    const message = JSON.parse(String(frame.payload));
    if (message.method === "surface.send_text" || message.method === "surface.send_key") sent.push(message);
  }));
  await page.setViewportSize({ width: 393, height: 600 });
  await login(page);
  await page.getByRole("button", { name: "API Agent", exact: true }).click();
  const terminal = page.getByRole("region", { name: "Terminal" });
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  const shortcuts = page.getByRole("navigation", { name: "Terminal shortcuts" });
  const footer = page.locator(".status-bar");
  await expect(shortcuts).toBeVisible(); await expect(footer).toBeVisible();
  const before = await terminal.boundingBox();
  const prompt = "First line\nSecond line\nThird line";
  await composer.fill(prompt);
  await expect(shortcuts).toBeHidden(); await expect(footer).toBeHidden();
  await expect(composer).toHaveAttribute("rows", "3");
  await expect(composer).toHaveAttribute("autocorrect", "on");
  await expect(composer).toHaveAttribute("spellcheck", "true");
  await expect(composer).toHaveValue(prompt);
  expect(await composer.evaluate((element) => element.clientHeight >= Number.parseFloat(getComputedStyle(element).lineHeight) * 3)).toBe(true);
  const after = await terminal.boundingBox();
  expect((after?.height ?? 0) - (before?.height ?? 0)).toBeGreaterThan(60);
  expect(sent).toHaveLength(0);
  await page.screenshot({ path: test.info().outputPath("focused-prompt-phone.png") });
  const picker = page.waitForEvent("filechooser");
  const attach = page.getByRole("button", { name: "Attach files or images", exact: true });
  if (test.info().project.name === "iphone-webkit") await attach.tap();
  else await attach.click();
  await (await picker).setFiles([]);
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(prompt);
  await composer.blur();
  await expect(shortcuts).toBeVisible(); await expect(footer).toBeVisible();
  await expect(composer).toHaveValue(prompt);
  await page.screenshot({ path: test.info().outputPath("idle-prompt-phone.png") });
  await composer.focus();
  for (const size of [{ width: 320, height: 480 }, { width: 852, height: 393 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await expect(shortcuts).toBeHidden(); await expect(footer).toBeHidden();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  if (test.info().project.name === "chromium") await page.screenshot({ path: test.info().outputPath("focused-prompt-desktop.png") });
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue(`${prompt}\n`);
  expect(sent).toHaveLength(0);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await composer.blur();
  await expect(shortcuts).toBeVisible(); await expect(footer).toBeVisible();
  expect(sent.map(({ method, params }) => ({ method, text: params.text, key: params.key }))).toEqual([
    { method: "surface.send_text", text: `${prompt}\n`, key: undefined },
    { method: "surface.send_key", text: undefined, key: "enter" },
  ]);
  await composer.fill("Send first line\nSend second line");
  const send = page.getByRole("button", { name: "Send", exact: true });
  if (test.info().project.name === "iphone-webkit") await send.tap();
  else await send.click();
  await expect(composer).toHaveValue("");
  expect(sent.slice(2).map(({ method, params }) => ({ method, text: params.text, key: params.key }))).toEqual([
    { method: "surface.send_text", text: "Send first line\nSend second line", key: undefined },
    { method: "surface.send_key", text: undefined, key: "enter" },
  ]);
});

test("keeps a local prompt focused during remote output and sends it only on Return", async ({ page, context }) => {
  const sent: Array<{ method: string; params: { text?: string; key?: string } }> = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    const message = JSON.parse(String(frame.payload));
    if (message.method === "surface.send_text" || message.method === "surface.send_key") sent.push(message);
  }));
  await login(page);
  await page.getByRole("button", { name: "API Agent", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.pressSequentially("write ");
  await expect(composer).toHaveValue("write ");
  expect(sent).toHaveLength(0);
  const other = await context.newPage();
  try {
    await login(other);
    await other.getByRole("button", { name: "API Agent", exact: true }).click();
    await other.getByRole("textbox", { name: "Prompt or command" }).fill("background output marker");
    await other.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".xterm-accessibility-tree")).toContainText("background output marker");
    await expect(composer).toBeFocused();
    await composer.pressSequentially("locally");
    await expect(composer).toHaveValue("write locally");
    expect(sent).toHaveLength(0);
    await composer.press("Enter");
    await expect.poll(() => sent.map(({ method, params }) => ({ method, text: params.text, key: params.key }))).toEqual([
      { method: "surface.send_text", text: "write locally", key: undefined },
      { method: "surface.send_key", text: undefined, key: "enter" },
    ]);
    await expect(composer).toHaveValue("");
  } finally { await other.close(); }
});

test("fits horizontal rules to the local grid across resizing and font changes", async ({ page, request }) => {
  await page.setViewportSize({ width: 393, height: 600 });
  await login(page); await expandInactiveTabs(page);
  await page.getByRole("button", { name: "Shell", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.fill("fixture:ruled-prompt"); await composer.press("Enter"); await composer.blur();
  const text = page.locator(".xterm-accessibility-tree");
  const rules = async () => (await text.locator("[role=listitem]").allTextContents()).map((line) => line.trim()).filter((line) => /^─+$/.test(line));
  await expect.poll(async () => (await rules()).length).toBe(2);
  const phoneWidth = (await rules())[0]?.length ?? 0;
  expect(phoneWidth).toBeGreaterThan(20);
  await expect(text).toContainText("› Write a prompt");
  await expect(text).toContainText("1. Continue    2. Cancel");
  await expect(page.locator(".xterm-rows span").filter({ hasText: /^─+$/ }).first()).toHaveCSS("color", "rgb(141, 179, 255)");
  await page.screenshot({ path: test.info().outputPath("rules-phone.png") });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(async () => (await rules())[0]?.length ?? 0).toBeGreaterThan(phoneWidth);
  await expect.poll(async () => (await rules()).length).toBe(2);
  await page.screenshot({ path: test.info().outputPath("rules-desktop.png") });
  await page.setViewportSize({ width: 320, height: 480 });
  await expect.poll(async () => (await rules()).length).toBe(2);
  await expect.poll(async () => (await rules())[0]?.length ?? 0).toBeLessThan(phoneWidth);
  const narrowWidth = (await rules())[0]?.length ?? 0;
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await page.getByRole("button", { name: "Increase font", exact: true }).click();
  await page.getByRole("button", { name: "Close shortcuts", exact: true }).click();
  await expect.poll(async () => (await rules())[0]?.length ?? 0).toBeLessThan(narrowWidth);
  await expect.poll(async () => (await rules()).length).toBe(2);
  await expect(text).toContainText("日本語 👋");
  await expect(text).toContainText("1. Continue    2. Cancel");
  await request.post("http://127.0.0.1:3458/features/unsupported");
  await expect(page.locator(".xterm-rows span").filter({ hasText: /^─+$/ }).first()).not.toHaveCSS("color", "rgb(141, 179, 255)");
  await expect.poll(async () => (await rules()).length).toBe(2);
  await expect(text).toContainText("› Write a prompt");
  await request.post("http://127.0.0.1:3458/features/reset");
});

test("keeps wide colored prompts compact while preserving output and menu choices", async ({ page, request }) => {
  await page.setViewportSize({ width: 393, height: 600 });
  await login(page); await expandInactiveTabs(page);
  await page.getByRole("button", { name: "Shell", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.fill("fixture:padded-prompt"); await composer.press("Enter"); await composer.blur();
  const text = page.locator(".xterm-accessibility-tree");
  await expect(text).toContainText("1. Continue    2. Cancel");
  for (const size of [{ width: 393, height: 600 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await expect(text).toContainText("› Write a prompt");
    await expect.poll(async () => {
      const rows = await text.locator("[role=listitem]").allTextContents();
      return rows.findIndex((row) => row.includes("Ready")) - rows.findIndex((row) => row.includes("› Write a prompt"));
    }).toBe(2);
    await expect(text).toContainText("+ added output 日本語 👋");
    await page.screenshot({ path: test.info().outputPath(`compact-prompt-${size.width}.png`) });
  }
  await request.post("http://127.0.0.1:3458/features/reset");
});

test("shows terminal foreground/background colors, emphasis and Unicode with safe plain-text fallback", async ({ page, request }) => {
  await login(page); await expandInactiveTabs(page);
  await page.getByRole("button", { name: "Shell", exact: true }).click();
  await page.getByRole("textbox", { name: "Prompt or command" }).fill("fixture:colors");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const removed = page.locator(".xterm-rows span").filter({ hasText: "- removed line" }).last();
  const added = page.locator(".xterm-rows span").filter({ hasText: "+ added line" }).last();
  await expect(removed).toHaveCSS("color", "rgb(255, 119, 119)");
  await expect(removed).toHaveCSS("background-color", "rgb(81, 37, 31)");
  await expect(removed).toHaveCSS("font-weight", "700");
  await expect(added).toHaveCSS("color", "rgb(164, 223, 141)");
  await expect(added).toHaveCSS("background-color", "rgb(31, 59, 41)");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("日本語 👋");
  await page.screenshot({ path: test.info().outputPath("terminal-colors.png") });
  await request.post("http://127.0.0.1:3458/features/unsupported");
  await expect(removed).not.toHaveCSS("color", "rgb(255, 119, 119)");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("- removed line");
  await request.post("http://127.0.0.1:3458/features/reset");
});

for (const profile of [
  { name: "API Agent", source: "codex", id: "11111111-1111-4111-8111-111111111111", labels: ["Shift+←", "Enter", "Esc"], keys: ["shift+left", "enter", "escape"], extraLabel: "↓", extraKey: "down" },
  { name: "UI Agent", source: "claude_code", id: "22222222-2222-4222-8222-222222222222", labels: ["↑", "↓", "Enter", "Esc"], keys: ["up", "down", "enter", "escape"], extraLabel: "Shift+←", extraKey: "shift+left" },
]) {
  test(`keeps ${profile.source} question controls visible without opening keyboard input`, async ({ page }) => {
    const inputs: Array<{ surface_id: string; key: string }> = [];
    page.on("websocket", (socket) => socket.on("framesent", (frame) => {
      const message = JSON.parse(String(frame.payload));
      if (message.method === "surface.send_key") inputs.push(message.params);
    }));
    await login(page);
    await page.getByRole("button", { name: profile.name, exact: true }).click();
    const group = page.getByRole("group", { name: "Question controls" });
    const toolbar = page.getByRole("navigation", { name: "Terminal shortcuts" });
    await expect(group.getByRole("button")).toHaveText(profile.labels);
    for (const width of [320, 393]) {
      await page.setViewportSize({ width, height: 852 });
      await page.locator(".toolbar-favorites").evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      for (const label of profile.labels) {
        await expect(toolbar.getByRole("button", { name: label, exact: true })).toHaveCount(1);
        const box = await group.getByRole("button", { name: label, exact: true }).boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.x).toBeGreaterThanOrEqual(12);
        expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(width - 12);
      }
      const terminal = await page.getByRole("region", { name: "Terminal" }).boundingBox();
      expect(terminal?.x).toBeGreaterThanOrEqual(12);
      expect((terminal?.x ?? 0) + (terminal?.width ?? Infinity)).toBeLessThanOrEqual(width - 12);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.evaluate(() => {
      document.documentElement.dataset.editableFocus = "0";
      document.addEventListener("focusin", (event) => {
        if (event.target instanceof HTMLElement && event.target.matches("input, textarea, [contenteditable=true]")) {
          document.documentElement.dataset.editableFocus = String(Number(document.documentElement.dataset.editableFocus) + 1);
        }
      });
    });
    for (const label of [...profile.labels, profile.extraLabel]) {
      const button = toolbar.getByRole("button", { name: label, exact: true });
      if (test.info().project.name === "iphone-webkit") await button.tap();
      else await button.click();
    }
    await expect.poll(() => inputs).toEqual([...profile.keys, profile.extraKey].map((key) => ({ surface_id: profile.id, key })));
    expect(await page.locator("html").getAttribute("data-editable-focus")).toBe("0");
    if (test.info().project.name === "chromium") await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: test.info().outputPath(`${profile.source}-terminal.png`) });
    await toolbar.getByRole("button", { name: "Shortcuts", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Shortcuts" });
    await expect(dialog.getByRole("button", { name: `Always visible ${profile.labels[0]}`, exact: true })).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath(`${profile.source}-shortcuts.png`) });
    const close = dialog.getByRole("button", { name: "Close shortcuts" });
    await expect(close).toBeFocused();
    await close.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Save command" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "Shortcuts", exact: true })).toBeFocused();
  });
}

test("keeps terminal controls compact and touchable while filling the viewport", async ({ page, browserName }) => {
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 34, left: 0 } });
  }
  await login(page);
  await expect(page.locator(".dashboard-heading")).toHaveText("Surfaces");
  await expect(page.locator(".status-bar")).toHaveCSS("justify-content", "center");
  await expect.poll(() => page.locator(".status-bar").evaluate((footer) => {
    const bar = footer.getBoundingClientRect();
    const label = footer.querySelector("span:last-child")?.getBoundingClientRect();
    return label ? Math.abs(label.y + label.height / 2 - bar.y - bar.height / 2) : Infinity;
  })).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "API Agent", exact: true }).click();
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "12px");
  await expect(page.getByRole("button", { name: "Shortcuts", exact: true })).toHaveCSS("font-size", "12px");
  await expect(page.getByRole("textbox", { name: "Prompt or command" })).toHaveCSS("font-size", "16px");
  for (const name of ["Attach files or images", "Send"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toHaveText("");
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBe(44);
    expect(bounds?.height).toBe(44);
  }
  const controls = await page.locator(".terminal-controls").boundingBox();
  expect(controls?.height).toBeLessThanOrEqual(148);
  await page.screenshot({ path: test.info().outputPath("compact-terminal.png") });
  for (const size of [{ width: 393, height: 852 }, { width: 393, height: 600 }, { width: 852, height: 393 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.locator(".status-bar").evaluate((footer) => Math.abs(footer.getBoundingClientRect().bottom - window.innerHeight))).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  }
});

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
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "13px");
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
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "13px");
  await expect.poll(() => reads).toBeGreaterThan(4);
  expect(viewports).toEqual([]);
});

test("reads output, drafts locally, sends mobile keys, and switches exact surfaces", async ({ page }) => {
  const inputs: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    const message = JSON.parse(String(frame.payload));
    if (message.method === "surface.send_text" || message.method === "surface.send_key") inputs.push(message.method);
  }));
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

  const helper = terminal.locator(".xterm-helper-textarea");
  await expect(helper).toHaveAttribute("readonly", "");
  await expect(helper).toHaveAttribute("inputmode", "none");
  if (test.info().project.name === "iphone-webkit") await terminal.locator(".xterm-screen").tap();
  else await terminal.locator(".xterm-screen").click();
  await page.keyboard.type("ignored raw input");
  expect(inputs).toHaveLength(2);
  await composer.fill("status");
  expect(inputs).toHaveLength(2);
  await composer.press("Enter");
  await expect(accessibleText).toContainText("status<enter>");
  await composer.blur();
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
  await expandInactiveTabs(page);
  await page.getByRole("button", { name: "Tests", exact: true }).click();
  await page.getByRole("button", { name: "Shortcuts" }).click();
  const dialog = page.getByRole("dialog", { name: "Shortcuts" });
  await dialog.getByLabel("Shortcut name").fill("Launch Codex");
  await dialog.getByLabel("Command", { exact: true }).fill("codex-dsp");
  await dialog.getByRole("button", { name: "Save command" }).click();
  await dialog.getByRole("button", { name: "Pin Launch Codex" }).click();
  await dialog.getByRole("button", { name: "Increase font" }).click();
  await expect(dialog.getByText("13 px", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close shortcuts" }).click();
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "13px");
  expect(inputs).toHaveLength(0);
  await page.getByRole("button", { name: "Launch Codex", exact: true }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("codex-dsp<enter>");
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.fill("fixture:question"); await composer.press("Enter");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("Open choices with Shift+Left");
  await composer.blur();
  await page.getByRole("button", { name: "Shift+←", exact: true }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("Choice 1");
  await page.getByRole("button", { name: "↓", exact: true }).click();
  await composer.press("Enter");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("Confirmed choice 2");
  await composer.blur();
  expect(inputs.filter((item) => item.params.text === "codex-dsp")).toHaveLength(1);
  const prior = inputs.length;
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.reload();
  await expandInactiveTabs(page);
  await page.getByRole("button", { name: "Tests", exact: true }).click();
  await expect(page.getByRole("button", { name: "Launch Codex", exact: true })).toBeVisible();
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "13px");
  expect(inputs).toHaveLength(prior);
});

test("preserves the visible history during append and prompt replacement", async ({ page }) => {
  let received = "";
  page.on("websocket", (socket) => socket.on("framereceived", (frame) => {
    const message = JSON.parse(String(frame.payload));
    if (typeof message.result?.text === "string") received = message.result.text;
  }));
  await login(page);
  await expandInactiveTabs(page);
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
  await composer.blur();
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
  await expandInactiveTabs(page);
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
