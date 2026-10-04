import { describe, expect, it } from "vitest";
import {
  cleanTerminalSnapshot,
  controlText,
  restoredViewportLine,
  snapshotUpdate,
} from "../terminal";

describe("terminal helpers", () => {
  it("skips identical snapshots, appends suffixes, and repaints changed prompts", () => {
    expect(snapshotUpdate(null, "ready")).toEqual({ kind: "replace", text: "ready" });
    expect(snapshotUpdate("ready", "ready")).toEqual({ kind: "unchanged", text: "" });
    expect(snapshotUpdate("ready", "ready\nnext")).toEqual({ kind: "append", text: "\nnext" });
    expect(snapshotUpdate("ready\nprompt", "ready\nchanged")).toEqual({ kind: "replace", text: "ready\nchanged" });
  });
  it("normalizes padded snapshots without trimming meaningful leading text", () => {
    expect(cleanTerminalSnapshot("  prompt  \nvalue    \n")).toBe(
      "  prompt\nvalue\n",
    );
  });

  it("applies Ctrl to ASCII letters only", () => {
    expect(controlText("c")).toBe("\u0003");
    expect(controlText("D")).toBe("\u0004");
    expect(controlText("l")).toBe("\u000c");
    expect(controlText("1")).toBeNull();
  });

  it("restores the same distance from the bottom", () => {
    expect(restoredViewportLine(80, 12)).toBe(68);
    expect(restoredViewportLine(4, 12)).toBe(0);
  });
});
