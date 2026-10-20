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

  it.each(["─", "━", "═", "_", "-", "="])("fits standalone %s rules to the local width and retains surrounding content", (rule) => {
    const input = `Answer 日本語 👋\n${rule.repeat(181)}\n› Choose\n${rule.repeat(181)}\n  1. Continue    2. Cancel`;
    expect(cleanTerminalSnapshot(input, 40)).toBe(`Answer 日本語 👋\n${rule.repeat(40)}\n› Choose\n${rule.repeat(40)}\n  1. Continue    2. Cancel`);
    expect(cleanTerminalSnapshot(input, 80)).toContain(rule.repeat(80));
  });

  it("keeps separator styles and resets across spans without shortening code or table borders", () => {
    const gray = "\u001b[0;38;2;120;120;120m";
    expect(cleanTerminalSnapshot(`${gray}${"─".repeat(20)}\u001b[0m${gray}${"─".repeat(161)}\u001b[0m`, 40))
      .toBe(`${gray}${"─".repeat(20)}\u001b[0m${gray}${"─".repeat(20)}\u001b[0m`);
    const content = `const border = "${"_".repeat(80)}";\n┌${"─".repeat(80)}┐\n${"─".repeat(60)} label\n-----\n  indented text`;
    expect(cleanTerminalSnapshot(content, 40)).toBe(content);
    expect(cleanTerminalSnapshot(`  ${gray}${"─".repeat(80)}\u001b[0m`, 40)).toBe(`  ${gray}${"─".repeat(38)}\u001b[0m`);
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
