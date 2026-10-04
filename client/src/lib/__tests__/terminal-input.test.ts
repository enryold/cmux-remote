import { describe, expect, it, vi } from "vitest";
import { createTerminalInputDispatcher, normalizeTerminalInput } from "../terminal-input";

const context = { composing: false, paste: false };
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
describe("terminal input", () => {
  it("normalizes committed keys but preserves paste, IME, and unknown data", () => {
    expect(normalizeTerminalInput("\r", context)).toEqual({ kind: "key", key: "enter" });
    expect(normalizeTerminalInput("\n", context)).toEqual({ kind: "key", key: "enter" });
    expect(normalizeTerminalInput("\u001b[1;2D", context)).toEqual({ kind: "key", key: "shift+left" });
    for (const value of ["hello", "hello\rworld", "\u001b[999~"]) expect(normalizeTerminalInput(value, context)).toEqual({ kind: "text", text: value });
    for (const options of [{ composing: true, paste: false }, { composing: false, paste: true }]) expect(normalizeTerminalInput("\r", options)).toEqual({ kind: "text", text: "\r" });
  });
  it("serializes a complete submission before later typing", async () => {
    let acknowledge!: () => void;
    const sendText = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; })).mockResolvedValue(undefined);
    const sendKey = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createTerminalInputDispatcher({ sendText, sendKey, isCurrent: () => true });
    const submit = dispatcher.submit("original", 1, "run");
    const typed = dispatcher.send("original", 1, { kind: "text", text: "later" });
    await tick();
    expect(sendText.mock.calls).toEqual([["original", "run"]]);
    acknowledge();
    await expect(submit).resolves.toBe("accepted");
    await typed;
    expect(sendKey).toHaveBeenCalledWith("original", "enter");
    expect(sendKey.mock.invocationCallOrder[0]).toBeLessThan(sendText.mock.invocationCallOrder[1]);
  });
  it("never sends Enter after failed text, or retries after an unconfirmed Enter", async () => {
    const sendText = vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValue(undefined);
    const sendKey = vi.fn().mockRejectedValue(new Error("lost"));
    const dispatcher = createTerminalInputDispatcher({ sendText, sendKey, isCurrent: () => true });
    await expect(dispatcher.submit("a", 1, "run")).resolves.toBe("text_unconfirmed");
    expect(sendKey).not.toHaveBeenCalled();
    await expect(dispatcher.submit("a", 1, "run")).resolves.toBe("enter_unconfirmed");
    expect(sendText).toHaveBeenCalledTimes(2);
    await expect(dispatcher.submit("a", 1, "")).resolves.toBe("enter_unconfirmed");
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendKey).toHaveBeenCalledTimes(2);
  });
  it.each(["connection", "selection"])("invalidates pending actions on %s changes without replay", async () => {
    let acknowledge!: () => void;
    let current = true;
    const sendText = vi.fn(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    const sendKey = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createTerminalInputDispatcher({ sendText, sendKey, isCurrent: () => current });
    const submit = dispatcher.submit("original", 1, "run");
    const queued = dispatcher.send("original", 1, { kind: "key", key: "down" });
    const rejection = expect(queued).rejects.toThrow();
    await tick(); current = false; acknowledge();
    await expect(submit).resolves.toBe("enter_unconfirmed");
    await rejection;
    current = true;
    expect(sendKey).not.toHaveBeenCalled();
  });
  it("bounds queued actions at 64", async () => {
    let acknowledge!: () => void;
    let current = true;
    const dispatcher = createTerminalInputDispatcher({ sendText: () => new Promise<void>((resolve) => { acknowledge = resolve; }), sendKey: vi.fn(), isCurrent: () => current });
    const queued = Array.from({ length: 64 }, () => dispatcher.send("a", 1, { kind: "text", text: "x" }).catch(() => undefined));
    await expect(dispatcher.send("a", 1, { kind: "key", key: "enter" })).rejects.toThrow("input_queue_full");
    await tick(); current = false; acknowledge(); await Promise.all(queued);
  });
});
