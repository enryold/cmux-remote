import { describe, expect, it } from "vitest";
import { defaultTerminalPreferences, parseTerminalPreferences } from "../terminal-preferences";

const id = "11111111-1111-4111-8111-111111111111";
describe("terminal preferences", () => {
  it("uses safe defaults and round trips commands and favorites", () => {
    const defaults = defaultTerminalPreferences();
    expect(defaults.fontSize).toBe(12);
    expect(defaults.commands).toEqual([]);
    expect(defaults.favorites).toContainEqual({ kind: "key", key: "shift+left" });
    expect(defaults.favorites).not.toContainEqual({ kind: "key", key: "ctrl+c" });
    expect(parseTerminalPreferences(null)).toEqual(defaults);
    expect(parseTerminalPreferences(JSON.stringify({ ...defaults, fontSize: 13 })).fontSize).toBe(13);
    const saved = { ...defaults, fontSize: 24, commands: [{ id, label: "Start", text: "codex-dsp" }], favorites: [{ kind: "command", commandId: id }] };
    expect(parseTerminalPreferences(JSON.stringify(saved))).toEqual(saved);
  });
  it("rejects invalid documents rather than partially trusting them", () => {
    const base = defaultTerminalPreferences();
    const command = { id, label: "Start", text: "hello" };
    for (const value of [
      { ...base, version: 2 }, { ...base, fontSize: 9 }, { ...base, fontSize: 25 }, { ...base, fontSize: 13.5 },
      { ...base, extra: true },
      { ...base, commands: [command, command] },
      { ...base, commands: [{ ...command, id: "not-a-uuid" }] },
      { ...base, commands: [{ ...command, label: "x".repeat(41) }] },
      { ...base, commands: [{ ...command, text: "💡".repeat(1025) }] },
      { ...base, commands: [{ ...command, text: "one\ntwo" }] },
      { ...base, commands: [{ ...command, text: "\u007f" }] },
      { ...base, commands: Array.from({ length: 21 }, (_, i) => ({ ...command, id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111` })) },
      { ...base, favorites: [{ kind: "key", key: "cmd+q" }] },
      { ...base, favorites: [base.favorites[0], base.favorites[0]] },
      { ...base, favorites: [{ kind: "command", commandId: id }] },
    ]) expect(parseTerminalPreferences(JSON.stringify(value))).toEqual(base);
    expect(parseTerminalPreferences(" ".repeat(131073))).toEqual(base);
  });
  it("counts command bytes and label code points", () => {
    const saved = { ...defaultTerminalPreferences(), fontSize: 10, commands: [{ id, label: "💡".repeat(40), text: "💡".repeat(1024) }] };
    expect(parseTerminalPreferences(JSON.stringify(saved))).toEqual(saved);
  });
});
