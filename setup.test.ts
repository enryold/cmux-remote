import { describe, expect, it } from "bun:test";
import {
  classifyServeStatus,
  DEFAULT_CAPABILITY,
  parseTailscaleStatus,
  renderGrant,
} from "./setup.js";

const status = JSON.stringify({
  BackendState: "Running",
  Self: {
    DNSName: "cmux.tail1234.ts.net.",
    TailscaleIPs: ["100.64.0.1", "fd7a:115c:a1e0::1"],
  },
  Peer: {
    phone: {
      DNSName: "iphone.tail1234.ts.net.",
      HostName: "iPhone",
      OS: "iOS",
      Online: true,
      TailscaleIPs: ["100.64.0.2", "fd7a:115c:a1e0::2"],
    },
    mac: {
      DNSName: "other.tail1234.ts.net.",
      HostName: "Other Mac",
      OS: "macOS",
      Online: true,
      TailscaleIPs: ["100.64.0.3"],
    },
  },
});

describe("first-run setup helpers", () => {
  it("derives the Mac origin and lists only iOS peers with IPv4", () => {
    expect(parseTailscaleStatus(status)).toEqual({
      macIp: "100.64.0.1",
      origin: "https://cmux.tail1234.ts.net",
      phones: [
        {
          dnsName: "iphone.tail1234.ts.net",
          ip: "100.64.0.2",
          name: "iPhone",
          online: true,
        },
      ],
    });
  });

  it("accepts a status response with no peers", () => {
    const empty = JSON.stringify({
      BackendState: "Running",
      Self: {
        DNSName: "cmux.tail1234.ts.net.",
        TailscaleIPs: ["100.64.0.1"],
      },
      Peer: null,
    });

    expect(parseTailscaleStatus(empty).phones).toEqual([]);
  });

  it("renders one exact device grant", () => {
    expect(
      renderGrant({
        capability: DEFAULT_CAPABILITY,
        macIp: "100.64.0.1",
        phoneIp: "100.64.0.2",
      }),
    ).toBe(
      JSON.stringify(
        {
          src: ["100.64.0.2"],
          dst: ["100.64.0.1"],
          ip: ["tcp:443"],
          app: {
            "gibb.one/cap/cmux-remote": [{ access: true }],
          },
        },
        null,
        2,
      ),
    );
  });

  it("classifies empty, exact, and conflicting Serve handlers", () => {
    const expected = {
      capability: "gibb.one/cap/cmux-remote",
      origin: "https://cmux.tail1234.ts.net",
    };

    expect(classifyServeStatus("{}", expected)).toBe("missing");
    expect(
      classifyServeStatus(
        JSON.stringify({
          TCP: { "443": { HTTPS: true } },
          Web: {
            "cmux.tail1234.ts.net:443": {
              Handlers: {
                "/": {
                  Proxy: "http://127.0.0.1:3456",
                  AcceptAppCaps: ["gibb.one/cap/cmux-remote"],
                },
              },
            },
          },
        }),
        expected,
      ),
    ).toBe("exact");
    expect(
      classifyServeStatus(
        JSON.stringify({
          Web: {
            "cmux.tail1234.ts.net:443": {
              Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } },
            },
          },
        }),
        expected,
      ),
    ).toBe("conflict");
  });
});
