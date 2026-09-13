import { describe, expect, it } from "bun:test";
import {
  hasTailscaleCapability,
  TAILSCALE_CAPABILITIES_HEADER,
} from "../tailscale";

const capability = "example.com/cap/cmux-remote";

function requestWith(value?: string): Request {
  return new Request("https://cmux.example.ts.net", {
    headers:
      value === undefined ? undefined : { [TAILSCALE_CAPABILITIES_HEADER]: value },
  });
}

describe("hasTailscaleCapability", () => {
  it("accepts only a non-empty exact capability grant", () => {
    expect(
      hasTailscaleCapability(
        requestWith(JSON.stringify({ [capability]: [{ access: true }] })),
        capability,
      ),
    ).toBe(true);
    expect(
      hasTailscaleCapability(
        requestWith(JSON.stringify({ [capability]: [] })),
        capability,
      ),
    ).toBe(false);
    expect(
      hasTailscaleCapability(
        requestWith(
          JSON.stringify({ "example.com/cap/different": [{ access: true }] }),
        ),
        capability,
      ),
    ).toBe(false);
  });

  it("fails closed for missing, malformed, or oversized headers", () => {
    expect(hasTailscaleCapability(requestWith(), capability)).toBe(false);
    expect(hasTailscaleCapability(requestWith("not-json"), capability)).toBe(
      false,
    );
    expect(hasTailscaleCapability(requestWith("[]"), capability)).toBe(false);
    expect(
      hasTailscaleCapability(requestWith("x".repeat(4_097)), capability),
    ).toBe(false);
  });

  it("allows token mode without trusting a proxy header", () => {
    expect(hasTailscaleCapability(requestWith(), null)).toBe(true);
  });
});
