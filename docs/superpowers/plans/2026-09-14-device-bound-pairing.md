# Device-bound Tailscale Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one Tailscale-authorized iPhone pair with a six-digit code once and then control cmux through the existing secure PWA session.

**Architecture:** Keep the bridge on loopback behind Tailscale Serve. A tailnet grant gives the iPhone a deployment-owned app capability, Serve forwards that capability in a spoof-resistant header, and the bridge requires it in addition to the signed session cookie. Pairing mode reuses the existing auth/session flow; token mode remains the fallback.

**Tech Stack:** Bun, Hono, TypeScript, React 19, Vitest, Playwright Chromium, Playwright iPhone WebKit, Tailscale Serve 1.92+

**Spec:** `docs/superpowers/specs/2026-09-14-device-bound-pairing-design.md`

## Global Constraints

- The bridge binds to `127.0.0.1` in pairing mode and is exposed only with Tailscale Serve, never Funnel.
- Pairing mode requires an exact HTTPS `CMUX_REMOTE_ORIGIN` and a deployment-owned Tailscale capability identifier.
- The six-digit code expires after ten minutes, is single-use, and locks after five failed attempts.
- Pairing sessions last 365 days; token-mode sessions retain the existing seven-day lifetime.
- Origin, cookie, WebSocket, body-size, RPC-whitelist, logging, and service-worker boundaries remain unchanged.
- No new runtime dependency is added.

---

### Task 1: Fail-closed Tailscale capability configuration

**Files:**
- Create: `server/src/tailscale.ts`
- Create: `server/src/__tests__/tailscale.test.ts`
- Modify: `server/src/config.ts`
- Modify: `server/src/__tests__/config.test.ts`
- Modify: server test fixtures that construct `RuntimeConfig`

**Interfaces:**
- Produces: `RuntimeConfig.tailscaleCapability: string | null`
- Produces: `RuntimeConfig.pairingCode: string | null`
- Produces: `hasTailscaleCapability(request: Request, capability: string | null): boolean`
- Consumes later: auth routes and WebSocket upgrade checks use the same capability function.

- [ ] **Step 1: Write failing configuration tests**

Add cases proving pairing mode generates a six-digit code and rejects unsafe combinations:

```ts
const pairing = loadConfig({
  CMUX_REMOTE_TOKEN: token,
  CMUX_REMOTE_ORIGIN: "https://cmux.example.ts.net",
  CMUX_REMOTE_TAILSCALE_CAPABILITY: "example.com/cap/cmux-remote",
});
expect(pairing.tailscaleCapability).toBe("example.com/cap/cmux-remote");
expect(pairing.pairingCode).toMatch(/^\d{6}$/);

expect(() =>
  loadConfig({
    CMUX_REMOTE_TOKEN: token,
    CMUX_REMOTE_ORIGIN: "http://cmux.example.ts.net",
    CMUX_REMOTE_TAILSCALE_CAPABILITY: "example.com/cap/cmux-remote",
  }),
).toThrow("HTTPS");
```

Also reject `HOST=0.0.0.0`, a capability without `{domain}/{path}`, a pairing code outside
`/^\d{6}$/`, and `CMUX_REMOTE_PAIRING_CODE` without pairing mode.

- [ ] **Step 2: Write failing capability-header tests**

Cover absent, malformed, oversized, wrong, and valid JSON headers:

```ts
const capability = "example.com/cap/cmux-remote";
const request = new Request("https://cmux.example.ts.net", {
  headers: {
    "Tailscale-App-Capabilities": JSON.stringify({
      [capability]: [{ access: true }],
    }),
  },
});
expect(hasTailscaleCapability(request, capability)).toBe(true);
expect(hasTailscaleCapability(request, null)).toBe(true);
```

- [ ] **Step 3: Run focused tests and confirm red**

Run:

```sh
devenv shell -- bun test server/src/__tests__/config.test.ts server/src/__tests__/tailscale.test.ts
```

Expected: failure because the fields and `server/src/tailscale.ts` do not exist.

- [ ] **Step 4: Implement minimal config and capability parsing**

In `config.ts`, validate the capability with an ASCII `{domain}/{path}` expression, require
`HOST=127.0.0.1` and HTTPS origin in pairing mode, generate a code with `crypto.randomInt(1_000_000)`,
and allow a deterministic six-digit `CMUX_REMOTE_PAIRING_CODE` for tests.

In `tailscale.ts`, cap the header at 4096 bytes, parse it as a non-array object, and accept only a
non-empty array at the exact configured own property. Return `false` for every parse or shape error.

- [ ] **Step 5: Update typed fixtures and run focused tests green**

Set `tailscaleCapability: null` and `pairingCode: null` on existing explicit `RuntimeConfig` values,
then rerun the Task 1 command. Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```sh
git add server/src/config.ts server/src/tailscale.ts server/src/__tests__
git commit -m "feat(auth): validate Tailscale device capabilities"
```

### Task 2: Six-digit pairing lifecycle and session issuance

**Files:**
- Modify: `server/src/auth.ts`
- Modify: `server/src/__tests__/auth.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `RuntimeConfig.tailscaleCapability`, `RuntimeConfig.pairingCode`, and `hasTailscaleCapability`.
- Produces: `createPairingChallenge(code: string, createdAt?: number): PairingChallenge`.
- Produces: `isAuthorized(request: Request, config: RuntimeConfig, now?: number): boolean` for WebSockets.
- Produces: `/auth/status` body `{ authenticated, mode, deviceAuthorized }`.

- [ ] **Step 1: Write failing pairing challenge tests**

Add deterministic tests for success, reuse, expiry, and five failures:

```ts
const challenge = createPairingChallenge("123456", 1_000);
expect(challenge.verify("123456", 1_001)).toBe(true);
expect(challenge.verify("123456", 1_002)).toBe(false);

const expired = createPairingChallenge("123456", 1_000);
expect(expired.verify("123456", 1_601)).toBe(false);

const locked = createPairingChallenge("123456", 1_000);
for (let attempt = 0; attempt < 5; attempt += 1) {
  expect(locked.verify("000000", 1_001)).toBe(false);
}
expect(locked.verify("123456", 1_001)).toBe(false);
```

- [ ] **Step 2: Write failing pairing-route tests**

Use a pairing config and the exact capability header. Prove missing capability returns 403, wrong
code returns the generic 401, correct code sets `HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`,
and a second use fails. Preserve the existing token-login tests and seven-day cookie lifetime.

- [ ] **Step 3: Run auth tests and confirm red**

Run:

```sh
devenv shell -- bun test server/src/__tests__/auth.test.ts
```

Expected: failure because pairing interfaces and route behavior do not exist.

- [ ] **Step 4: Implement the pairing state machine**

Keep the challenge in memory. Compare every syntactically valid candidate with `safeEqual`, then
combine the result with expiry, used, and failed-attempt state. Mark success used; increment only
failed active attempts. Do not expose the failure reason.

- [ ] **Step 5: Extend auth routes without duplicating session logic**

Derive the mode from `config.tailscaleCapability`. In token mode accept exactly `{ token }`; in
pairing mode require the capability and accept exactly `{ pairingCode }`. Parameterize cookie
`maxAge`, using seven days for token login and 365 days for pairing. Make `isAuthorized` require both
the capability and valid cookie.

Create one pairing challenge in `startServer`, pass it to `createAuthRoutes`, and print the generated
code once with its ten-minute expiry. Never print `CMUX_REMOTE_TOKEN` or capability-header contents.

- [ ] **Step 6: Run auth and config tests green**

```sh
devenv shell -- bun test server/src/__tests__/auth.test.ts server/src/__tests__/config.test.ts server/src/__tests__/tailscale.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

```sh
git add server/src/auth.ts server/src/index.ts server/src/__tests__/auth.test.ts
git commit -m "feat(auth): add one-time device pairing"
```

### Task 3: Enforce capability on WebSockets and render pairing UI

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/__tests__/server.test.ts`
- Modify: `client/src/hooks/useAuth.ts`
- Modify: `client/src/hooks/__tests__/useAuth.test.tsx`
- Modify: `client/src/components/Login.tsx`
- Modify: `client/src/components/__tests__/Login.test.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `isAuthorized(request, config)` at `/ws`.
- Produces: client `AuthMode = "token" | "pairing"`.
- Produces: `useAuth().deviceAuthorized: boolean` and mode-aware `login(credential: string)`.

- [ ] **Step 1: Write failing WebSocket boundary test**

Create a pairing-mode server and a valid session. A request with Origin and cookie but no capability
must return 401; adding the exact serialized capability must reach the upgrade path and return 400.

- [ ] **Step 2: Write failing auth-hook tests**

Return `{ authenticated: false, mode: "pairing", deviceAuthorized: true }` from status and assert
that `login("123456")` posts `{ "pairingCode": "123456" }`. Add a status response with
`deviceAuthorized: false` and assert the value is exposed without attempting login. Keep the token
body assertion.

- [ ] **Step 3: Write failing Login component tests**

Pairing mode must render a numeric six-character field named `Pairing code`, submit only six digits,
clear it, and use `autocomplete="one-time-code"`. Unauthorized mode renders “Device not authorized”
and no submit button. Token mode keeps `Access token` and `current-password`.

- [ ] **Step 4: Run focused server and client tests red**

```sh
devenv shell -- bun test server/src/__tests__/server.test.ts
devenv shell -- bun run --cwd client test -- client/src/hooks/__tests__/useAuth.test.tsx client/src/components/__tests__/Login.test.tsx
```

- [ ] **Step 5: Implement the shared authorization boundary and client mode**

Replace the `/ws` cookie-only check with `isAuthorized`. Parse `/auth/status` conservatively: unknown
mode falls back to token, and missing booleans fail closed. Build the request body from the parsed
mode, not from user-controlled data. Pass mode and device authorization from `App` to `Login`.

Use native input attributes and React state only; add no validation or form dependency.

- [ ] **Step 6: Run focused tests green and typecheck**

```sh
devenv shell -- bun test server/src/__tests__/server.test.ts
devenv shell -- bun run --cwd client test -- client/src/hooks/__tests__/useAuth.test.tsx client/src/components/__tests__/Login.test.tsx
devenv shell -- typecheck
```

- [ ] **Step 7: Commit**

```sh
git add server/src/index.ts server/src/__tests__/server.test.ts client/src
git commit -m "feat(client): pair an authorized iPhone"
```

### Task 4: Pairing E2E and deployment documentation

**Files:**
- Modify: `e2e/helpers.ts`
- Modify: `e2e/start.ts`
- Modify: `e2e/auth.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/ROADMAP.md`

**Interfaces:**
- Produces: deterministic E2E pairing code and capability constants.
- Consumes: Playwright `extraHTTPHeaders` to model Tailscale Serve's trusted boundary.
- Produces: a test-only signed-cookie helper for non-authentication scenarios, so the single-use
  pairing challenge is consumed only by the pairing scenario.

- [ ] **Step 1: Convert auth E2E to pairing mode**

Define:

```ts
export const E2E_PAIRING_CODE = "123456";
export const E2E_CAPABILITY = "example.com/cap/cmux-remote";
export const E2E_CAPABILITIES_HEADER = JSON.stringify({
  [E2E_CAPABILITY]: [{ access: true }],
});

export async function login(page: Page): Promise<void> {
  await page.context().addCookies([{
    name: SESSION_COOKIE,
    value: createSessionValue(E2E_TOKEN, Math.floor(Date.now() / 1_000) + 3_600),
    url: "http://127.0.0.1:3457",
  }]);
  await page.goto("/");
}
```

Start the E2E bridge with the capability and code, and set `extraHTTPHeaders` on both browser
projects so HTTP requests and the WebSocket handshake cross the same simulated Serve boundary. The
cookie helper is used only by terminal/reconnect tests; it must not be used by `auth.spec.ts`.

- [ ] **Step 2: Add wrong-code, persistence, and unauthorized-device E2E coverage**

Because the production challenge is deliberately single-use, keep one successful pairing scenario
for the iPhone WebKit project: submit `000000`, observe generic failure, pair with `123456`, reload,
and remain on the dashboard. Use a separate Playwright context without the header to prove it sees
“Device not authorized” and cannot submit. Chromium still exercises the signed-cookie dashboard,
terminal, reconnect, and unauthorized-device paths; server and component tests cover pairing state
independently. Keep dynamic ninth-terminal discovery in the successful iPhone scenario.

- [ ] **Step 3: Run E2E in both projects**

```sh
devenv shell -- bun run --cwd client build
devenv shell -- bunx playwright test e2e/auth.spec.ts
```

Expected: pairing tests pass in Chromium and iPhone WebKit.

- [ ] **Step 4: Document exact deployment and recovery**

Update the security model, `.env` variables, tailnet host/grant example, Serve command with
`--accept-app-caps`, six-digit startup code, 365-day session, token fallback, revocation by token
rotation or grant removal, and the stable HTTPS/MagicDNS constraints. Do not put real tailnet IPs,
capability names, tokens, or codes in tracked files.

Update the roadmap evidence row for device pairing but do not mark Milestone 1 live until the real
iPhone gate passes.

- [ ] **Step 5: Run docs/diff checks and commit**

```sh
git diff --check
git add e2e playwright.config.ts README.md docs/superpowers/ROADMAP.md
git commit -m "test: cover device-bound mobile pairing"
```

### Task 5: Full verification, security review, and live iPhone gate

**Files:**
- Modify only if verification finds a concrete defect.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a clean, reviewed feature branch and live deployment evidence.

- [ ] **Step 1: Run the complete deterministic gate**

```sh
devenv shell -- check
```

Expected: lint, server tests, client tests, typecheck, build, and all Chromium/WebKit E2E pass.

- [ ] **Step 2: Review the security diff**

Inspect every trust-boundary change. Confirm direct requests cannot select auth mode, capability
header contents are bounded and never logged, pairing responses are generic, token mode still works,
and `/ws` requires Origin + capability + cookie.

- [ ] **Step 3: Configure the supervised live bridge**

Use an untracked high-entropy signing token, the exact Tailscale HTTPS origin, and a deployment-owned
capability. Configure Tailscale Serve with the same `--accept-app-caps` value. Do not enable Funnel or
leave diagnostic TCP/HTTP routes active.

- [ ] **Step 4: Run the physical iPhone checklist**

On the allowed iPhone: resolve the HTTPS MagicDNS URL, pair with the six-digit code, install/open the
PWA, discover at least eight terminals, use a disposable terminal for text/Enter/Ctrl-C, return to
the dashboard, background/foreground the app, and disconnect/reconnect the network.

From a request without the capability, confirm `/auth/login` and `/ws` fail. Verify no dangerous
endpoint is accessible without both layers.

- [ ] **Step 5: Clean up and record evidence**

Close only the disposable workspace, disable the temporary diagnostic TCP route, clear the pairing
code from the clipboard, and retain only the intended HTTPS Serve route. Update the roadmap's Live
column only after the physical gate passes.

- [ ] **Step 6: Commit any evidence-only roadmap update**

```sh
git add docs/superpowers/ROADMAP.md
git commit -m "docs: record live mobile pairing verification"
```
