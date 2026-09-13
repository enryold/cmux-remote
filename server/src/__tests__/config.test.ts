import { describe, expect, it } from "bun:test";
import { loadConfig } from "../config";

const token = "a".repeat(32);

describe("loadConfig", () => {
  it("binds to localhost by default", () => {
    expect(loadConfig({ CMUX_REMOTE_TOKEN: token })).toMatchObject({
      hostname: "127.0.0.1",
      port: 3456,
      remoteToken: token,
    });
  });

  it("honors an explicit cmux socket path", () => {
    expect(
      loadConfig({
        CMUX_REMOTE_TOKEN: token,
        CMUX_SOCKET_PATH: "/tmp/cmux-test.sock",
      }).socketPath,
    ).toBe("/tmp/cmux-test.sock");
  });

  it("rejects a missing or short token", () => {
    expect(() => loadConfig({})).toThrow("CMUX_REMOTE_TOKEN");
    expect(() => loadConfig({ CMUX_REMOTE_TOKEN: "short" })).toThrow("32");
  });

  it("rejects invalid ports and non-origin public URLs", () => {
    expect(() => loadConfig({ CMUX_REMOTE_TOKEN: token, PORT: "0" })).toThrow(
      "PORT",
    );
    expect(() =>
      loadConfig({
        CMUX_REMOTE_TOKEN: token,
        CMUX_REMOTE_ORIGIN: "https://mac.example/path",
      }),
    ).toThrow("CMUX_REMOTE_ORIGIN");
  });
});
