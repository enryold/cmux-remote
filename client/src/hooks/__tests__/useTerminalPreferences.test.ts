// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalPreferences } from "../useTerminalPreferences";
import { PREFERENCES_STORAGE_KEY } from "../../lib/terminal-preferences";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe("device preferences", () => {
  it("saves, reloads, and removes favorites when deleting commands", () => {
    const { result, unmount } = renderHook(useTerminalPreferences);
    act(() => expect(result.current.saveCommand({ label: "Launch", text: "claude-dsp" })).toBe(true));
    const id = result.current.preferences.commands[0].id;
    act(() => result.current.toggleFavorite({ kind: "command", commandId: id }));
    act(() => result.current.setFontSize(17));
    unmount();
    const again = renderHook(useTerminalPreferences);
    expect(again.result.current.preferences.fontSize).toBe(17);
    act(() => again.result.current.deleteCommand(id));
    expect(again.result.current.preferences.commands).toEqual([]);
    expect(again.result.current.preferences.favorites).not.toContainEqual({ kind: "command", commandId: id });
    act(() => expect(again.result.current.saveCommand({ label: "Bad", text: "line\nline" })).toBe(false));
  });
  it("keeps edits in memory when storage is denied", () => {
    const { result } = renderHook(useTerminalPreferences);
    const prior = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    act(() => result.current.setFontSize(18));
    expect(result.current.preferences.fontSize).toBe(18);
    expect(result.current.persistenceError).toBeTruthy();
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBe(prior);
    const reload = renderHook(useTerminalPreferences);
    expect(reload.result.current.preferences.fontSize).toBe(13);
  });
});
