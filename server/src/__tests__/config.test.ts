import { describe, expect, it } from "bun:test";
import { isCapabilityName, loadConfig } from "../config";

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

  it("enables pairing only behind loopback HTTPS with exact inputs", () => {
    const pairing = loadConfig({
      CMUX_REMOTE_TOKEN: token,
      CMUX_REMOTE_ORIGIN: "https://cmux.example.ts.net",
      CMUX_REMOTE_TAILSCALE_CAPABILITY: "example.com/cap/cmux-remote",
    });
    expect(pairing.tailscaleCapability).toBe(
      "example.com/cap/cmux-remote",
    );
    expect(pairing.pairingCode).toMatch(/^\d{6}$/);

    expect(() =>
      loadConfig({
        CMUX_REMOTE_TOKEN: token,
        CMUX_REMOTE_ORIGIN: "http://cmux.example.ts.net",
        CMUX_REMOTE_TAILSCALE_CAPABILITY: "example.com/cap/cmux-remote",
      }),
    ).toThrow("HTTPS");
    expect(() =>
      loadConfig({
        CMUX_REMOTE_TOKEN: token,
        CMUX_REMOTE_ORIGIN: "https://cmux.example.ts.net",
        CMUX_REMOTE_TAILSCALE_CAPABILITY: "example.com/cap/cmux-remote",
        HOST: "0.0.0.0",
      }),
    ).toThrow("127.0.0.1");
    expect(() =>
      loadConfig({
        CMUX_REMOTE_TOKEN: token,
        CMUX_REMOTE_ORIGIN: "https://cmux.example.ts.net",
        CMUX_REMOTE_TAILSCALE_CAPABILITY: "not-a-capability",
      }),
    ).toThrow("CMUX_REMOTE_TAILSCALE_CAPABILITY");
  });

  it("accepts only a six-digit pairing override in pairing mode", () => {
    expect(
      loadConfig({
        CMUX_REMOTE_TOKEN: token,
        CMUX_REMOTE_ORIGIN: "https://cmux.example.ts.net",
        CMUX_REMOTE_TAILSCALE_CAPABILITY: "example.com/cap/cmux-remote",
        CMUX_REMOTE_PAIRING_CODE: "012345",
      }).pairingCode,
    ).toBe("012345");

    expect(() =>
      loadConfig({
        CMUX_REMOTE_TOKEN: token,
        CMUX_REMOTE_PAIRING_CODE: "012345",
      }),
    ).toThrow("pairing mode");
    expect(() =>
      loadConfig({
        CMUX_REMOTE_TOKEN: token,
        CMUX_REMOTE_ORIGIN: "https://cmux.example.ts.net",
        CMUX_REMOTE_TAILSCALE_CAPABILITY: "example.com/cap/cmux-remote",
        CMUX_REMOTE_PAIRING_CODE: "12345x",
      }),
    ).toThrow("six digits");
  });

  it("validates setup capability identifiers", () => {
    expect(isCapabilityName("gibb.one/cap/cmux-remote")).toBe(true);
    expect(isCapabilityName("tail1234.ts.net/cap/cmux-remote")).toBe(true);
    expect(isCapabilityName("not-a-capability")).toBe(false);
    expect(isCapabilityName(`example.com/${"x".repeat(256)}`)).toBe(false);
  });
});
