import { afterEach, expect, it, vi } from "vitest";
import { uploadAttachment } from "../attachments";

const id = "11111111-1111-4111-8111-111111111111";
const file = new File(["notes"], "notes.txt");
afterEach(() => vi.unstubAllGlobals());

it("posts raw files with no caching and accepts only an exact-target bounded path", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ surfaceId: id, path: "/tmp/notes.txt" }));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  await expect(uploadAttachment(id, file, signal, vi.fn())).resolves.toBe("/tmp/notes.txt");
  expect(fetch).toHaveBeenCalledWith(`/api/surfaces/${id}/attachments`, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": "notes.txt" }, body: file,
  });
  for (const value of [
    { surfaceId: "wrong", path: "/tmp/notes.txt" }, { surfaceId: id, path: "/tmp/a\nenter" },
    { surfaceId: id, path: `/${"a".repeat(1024)}` }, { surfaceId: id, path: "relative" },
    { surfaceId: id, path: "/tmp/file", private: "secret" },
  ]) {
    fetch.mockResolvedValueOnce(Response.json(value));
    await expect(uploadAttachment(id, file, signal, vi.fn())).rejects.toThrow("could not be confirmed");
  }
});

it("expires a rejected session but ignores an old aborted response", async () => {
  const expire = vi.fn();
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  await expect(uploadAttachment(id, file, new AbortController().signal, expire)).rejects.toThrow("session expired");
  expect(expire).toHaveBeenCalledOnce();
  const controller = new AbortController();
  fetch.mockImplementationOnce(async () => { controller.abort(); return new Response(null, { status: 401 }); });
  await expect(uploadAttachment(id, file, controller.signal, expire)).rejects.toThrow();
  expect(expire).toHaveBeenCalledOnce();
});
