import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { PREVIEW_IMAGE } from "./preview-image";
const control = "http://127.0.0.1:3458";
test.beforeEach(async ({ request }) => { await request.post(control + "/uploads/reset"); });

test("uploads a document and image, reviews references, then sends to the exact terminal", async ({ page }) => {
  const inputs: Array<{ method: string; params: { surface_id: string; text?: string; key?: string } }> = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    const message = JSON.parse(String(frame.payload));
    if (message.method === "surface.send_text" || message.method === "surface.send_key") inputs.push(message);
  }));
  await page.setViewportSize({ width: 393, height: 852 });
  await login(page);
  await page.getByRole("button", { name: "API Agent" }).click();
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.fill("Review these");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files or images" }).click();
  await (await chooser).setFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("A disposable document") },
    { name: "screen 'one'.png", mimeType: "image/png", buffer: Buffer.from(PREVIEW_IMAGE, "base64") },
  ]);
  await expect(page.locator(".attachment-notice")).toContainText("Review the prompt, then press Send");
  const value = await composer.inputValue();
  expect(value).toContain("Review these '");
  expect(value).toContain("/notes.txt'");
  expect(value).toContain("screen '\\''one'\\''.png'");
  expect(inputs).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(composer).toHaveValue("");
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("notes.txt");
  await expect.poll(() => inputs.length).toBe(2);
  expect(inputs.map((item) => item.params.surface_id)).toEqual(Array(2).fill("11111111-1111-4111-8111-111111111111"));
  expect(inputs[0]?.params.text).toBe(value); expect(inputs[1]?.params.key).toBe("enter");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "UI Agent" }).click();
  await expect(page.locator(".xterm-accessibility-tree")).toContainText("ui ready");
  await expect(page.locator(".xterm-accessibility-tree")).not.toContainText("notes.txt");
});

test("keeps the prompt after upload failure and permits selecting the same file again", async ({ page, request }) => {
  await login(page);
  await page.getByRole("button", { name: "API Agent" }).click();
  const composer = page.getByRole("textbox", { name: "Prompt or command" });
  await composer.fill("Keep this draft");
  await request.post(control + "/uploads/fail");
  const file = { name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("retry") };
  await page.getByLabel("Files and images").setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText("Upload failed");
  await expect(composer).toHaveValue("Keep this draft");
  await request.post(control + "/uploads/reset");
  await page.getByLabel("Files and images").setInputFiles(file);
  await expect(page.locator(".attachment-notice")).toContainText("Attached retry.txt");
  await expect(composer).toHaveValue(/Keep this draft '.*\/retry.txt'/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
