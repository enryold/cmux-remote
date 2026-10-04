import { describe, expect, it } from "bun:test";
import {
  parseAllowedRequest,
  sanitizeCmuxResult,
  toCmuxCall,
} from "../rpc";

const surfaceId = "11111111-1111-4111-8111-111111111111";
const paneId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";

describe("parseAllowedRequest", () => {
  it("delivers the finite modified-key catalogue to the exact terminal", () => {
    for (const key of ["escape", "tab", "enter", "ctrl+c", "ctrl+d", "up", "down", "left", "right", "shift+tab", "shift+left", "shift+right", "shift+up", "shift+down"]) {
      const request = parseAllowedRequest(JSON.stringify({id: "keys", method: "surface.send_key", params: {surface_id: surfaceId, key}}));
      expect(toCmuxCall(request, "client")).toEqual({method: "surface.send_key", params: {surface_id: surfaceId, key}});
    }
    expect(() => parseAllowedRequest(JSON.stringify({id: "bad", method: "surface.send_key", params: {surface_id: surfaceId, key: "shift+cmd+q"}}))).toThrow("invalid_params");
  });
  it("accepts and maps a bounded exact terminal read", () => {
    const request = parseAllowedRequest(
      JSON.stringify({
        id: "7",
        method: "surface.read_text",
        params: { surface_id: surfaceId.toUpperCase(), lines: 2_000 },
      }),
    );
    expect(request).toEqual({
      id: "7",
      method: "surface.read_text",
      params: { surface_id: surfaceId, lines: 2_000 },
    });
    expect(toCmuxCall(request, "bridge-client")).toEqual({
      method: "surface.read_text",
      params: { surface_id: surfaceId, lines: 2_000, scrollback: true },
    });
  });

  it("rejects methods, implicit targets, aliases, extra fields, and invalid bounds", () => {
    const invalid = [
      { id: "1", method: "workspace.create", params: {} },
      { id: "1", method: "surface.send_text", params: { text: "pwd" } },
      {
        id: "1",
        method: "surface.send_text",
        params: { surfaceId, text: "pwd" },
      },
      {
        id: "1",
        method: "surface.send_key",
        params: { surface_id: surfaceId, key: "cmd+q" },
      },
      {
        id: "1",
        method: "surface.read_text",
        params: { surface_id: surfaceId, lines: 0 },
      },
      {
        id: "1",
        method: "terminal.viewport",
        params: {
          surface_id: surfaceId,
          viewport_columns: 19,
          viewport_rows: 24,
          viewport_generation: 1,
        },
      },
      {
        id: "1",
        method: "system.tree",
        params: { all: true },
      },
    ];

    for (const value of invalid) {
      expect(() => parseAllowedRequest(JSON.stringify(value))).toThrow();
    }
  });

  it("measures text input as UTF-8 bytes", () => {
    const accepted = "é".repeat(8_192);
    expect(
      parseAllowedRequest(
        JSON.stringify({
          id: "1",
          method: "surface.send_text",
          params: { surface_id: surfaceId, text: accepted },
        }),
      ),
    ).toMatchObject({ params: { text: accepted } });

    const rejected = `${accepted}a`;
    expect(() =>
      parseAllowedRequest(
        JSON.stringify({
          id: "1",
          method: "surface.send_text",
          params: { surface_id: surfaceId, text: rejected },
        }),
      ),
    ).toThrow("invalid_params");
  });
});

describe("sanitizeCmuxResult", () => {
  it("exports only HTTP(S) origins for browser labels, including URL titles", () => {
    for (const [url, expected] of [
      ["https://user:password@example.com/private-token?token=secret#fragment", "https://example.com"],
      ["http://localhost:3000/path", "http://localhost:3000"], ["file:///private/secret.png", null], ["javascript:alert(1)", null],
      [`https://example.com/${"x".repeat(4096)}`, null],
    ]) {
      const tree = { windows: [{ workspaces: [{ id: workspaceId, title: "Test", index: 0, selected: true, panes: [{ id: paneId, index: 0, focused: true, surfaces: [{ id: surfaceId, type: "browser", title: url, url, index: 0, selected: true }] }] }] }] };
      const result = sanitizeCmuxResult("system.tree", tree) as { workspaces: Array<{ panes: Array<{ surfaces: Array<{ title: string; urlLabel: string | null }> }> }> };
      expect(result.workspaces[0]?.panes[0]?.surfaces[0]?.urlLabel).toBe(expected);
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(JSON.stringify(result)).not.toContain("password");
    }
  });
  it("flattens tree windows and strips refs, tty, URL, and unknown fields", () => {
    const result = sanitizeCmuxResult("system.tree", {
      active: null,
      caller: { pid: 42 },
      windows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          ref: "window:1",
          workspaces: [
            {
              id: workspaceId.toUpperCase(),
              ref: "workspace:1",
              title: "CODEX",
              index: 0,
              selected: true,
              panes: [
                {
                  id: paneId.toUpperCase(),
                  ref: "pane:1",
                  index: 0,
                  focused: true,
                  surfaces: [
                    {
                      id: surfaceId.toUpperCase(),
                      ref: "surface:1",
                      type: "terminal",
                      title: "API Agent",
                      index: 0,
                      selected: true,
                      tty: "/dev/ttys001",
                      url: "https://secret.invalid",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      workspaces: [
        {
          id: workspaceId,
          title: "CODEX",
          index: 0,
          selected: true,
          panes: [
            {
              id: paneId,
              index: 0,
              focused: true,
              surfaces: [
                {
                  id: surfaceId,
                  type: "terminal",
                  title: "API Agent",
                  index: 0,
                  selected: true,
                  urlLabel: null,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret.invalid");
    expect(JSON.stringify(result)).not.toContain("ttys001");
  });

  it("returns only public capability and viewport fields", () => {
    expect(
      sanitizeCmuxResult("system.capabilities", {
        protocol: "cmux-socket",
        version: 2,
        access_mode: "automation",
        capabilities: ["events.v1", "terminal.viewport.v1"],
        methods: ["workspace.create"],
        socket_path: "/private/cmux.sock",
      }),
    ).toEqual({
      protocol: "cmux-socket",
      version: 2,
      access_mode: "automation",
      capabilities: ["events.v1", "terminal.viewport.v1"],
    });

    expect(
      sanitizeCmuxResult("terminal.viewport", {
        surface_id: surfaceId.toUpperCase(),
        columns: 80,
        rows: 24,
        workspace_id: workspaceId,
        render_epoch: "private",
      }),
    ).toEqual({ surface_id: surfaceId, columns: 80, rows: 24 });
  });

  it("accepts the smaller viewport-clear response", () => {
    expect(
      sanitizeCmuxResult("terminal.viewport", {
        surface_id: surfaceId.toUpperCase(),
        workspace_id: workspaceId,
        render_epoch: "private",
        render_revision_floor: 12,
      }),
    ).toEqual({ surface_id: surfaceId });
  });

  it("keeps a valid UTF-8 suffix and rejects malformed cmux results", () => {
    const prefix = "x".repeat(2 * 1024 * 1024);
    expect(
      sanitizeCmuxResult("surface.read_text", {
        text: `${prefix}🙂`,
        tty: "/dev/private",
      }),
    ).toEqual({ text: `${"x".repeat(2 * 1024 * 1024 - 4)}🙂` });

    expect(() =>
      sanitizeCmuxResult("surface.read_text", { text: 42 }),
    ).toThrow("invalid_cmux_response");
  });
});
