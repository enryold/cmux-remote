import { expect, it } from "vitest";
import { isCacheableRequest } from "../../service-worker";

it("caches only same-origin static GET requests", () => {
  const origin = "https://mac.test";
  expect(
    isCacheableRequest(new Request(`${origin}/assets/app.js`), origin),
  ).toBe(true);
  expect(
    isCacheableRequest(new Request(`${origin}/manifest.json`), origin),
  ).toBe(true);
  expect(
    isCacheableRequest(new Request(`${origin}/auth/status`), origin),
  ).toBe(false);
  expect(isCacheableRequest(new Request(`${origin}/health`), origin)).toBe(false);
  expect(isCacheableRequest(new Request(`${origin}/ws`), origin)).toBe(false);
  expect(
    isCacheableRequest(new Request(`${origin}/`, { method: "POST" }), origin),
  ).toBe(false);
  expect(
    isCacheableRequest(new Request("https://other.test/app.js"), origin),
  ).toBe(false);
});
