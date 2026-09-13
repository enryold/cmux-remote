import type { Page } from "@playwright/test";
import {
  createPairedSessionValue,
  SESSION_COOKIE,
} from "../server/src/auth";
import { TAILSCALE_CAPABILITIES_HEADER } from "../server/src/tailscale";

export const E2E_TOKEN = "e2e-token-with-at-least-32-bytes";
export const E2E_PAIRING_CODE = "123456";
export const E2E_CAPABILITY = "example.com/cap/cmux-remote";
export const E2E_CAPABILITIES_HEADER = JSON.stringify({
  [E2E_CAPABILITY]: [{ access: true }],
});
export const E2E_CAPABILITY_HEADERS = {
  [TAILSCALE_CAPABILITIES_HEADER]: E2E_CAPABILITIES_HEADER,
};

export async function login(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: createPairedSessionValue(
        E2E_TOKEN,
        Math.floor(Date.now() / 1_000) + 3_600,
        E2E_CAPABILITY,
      ),
      url: "http://127.0.0.1:3457",
    },
  ]);
  await page.goto("/");
  await page.getByRole("heading", { name: "Terminals" }).waitFor();
}
