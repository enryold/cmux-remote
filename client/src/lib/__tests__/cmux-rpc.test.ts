import { describe, expect, it } from "vitest";
import { createRpcRequest, parseServerMessage } from "../cmux-rpc";

describe("cmux-rpc", () => {
  it("creates requests only for the typed bridge methods", () => {
    const request = createRpcRequest("surface.read_text", {
      surface_id: "11111111-1111-4111-8111-111111111111",
      lines: 2_000,
    });
    expect(request).toMatchObject({
      method: "surface.read_text",
      params: { lines: 2_000 },
    });
    expect(request.id).toBeTruthy();
  });

  it("parses only known response, state, and topology envelopes", () => {
    expect(
      parseServerMessage('{"id":"1","ok":true,"result":{}}'),
    ).toEqual({ id: "1", ok: true, result: {} });
    expect(
      parseServerMessage('{"type":"state","cmux":"connected"}'),
    ).toEqual({ type: "state", cmux: "connected" });
    expect(
      parseServerMessage(
        '{"type":"event","event":"topology.changed","seq":4,"gap":false}',
      ),
    ).toEqual({
      type: "event",
      event: "topology.changed",
      seq: 4,
      gap: false,
    });
  });

  it("rejects unknown, malformed, or extended envelopes", () => {
    const invalid = [
      '{"type":"event","event":"browser.input"}',
      '{"type":"state","cmux":"ready"}',
      '{"id":"1","ok":false,"error":{"code":42,"message":"bad"}}',
      '{"id":"1","ok":true,"result":{},"socket_path":"/private/cmux.sock"}',
      "not-json",
    ];
    for (const message of invalid) {
      expect(() => parseServerMessage(message)).toThrow(
        "invalid_server_message",
      );
    }
  });
});
