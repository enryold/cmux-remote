# Guided First-Run Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe interactive `setup.js` that configures one iPhone for Tailscale pairing, then add reproducible devenv shortcuts and make that path the README's primary Getting Started flow.

**Architecture:** One root Bun script owns the prompts and orchestration while exporting a small set of pure parsers/renderers for focused tests. It reuses the server's capability validator, invokes external programs only through argument arrays, preserves existing `.env` and Serve state, and leaves remote tailnet-policy editing to the human.

**Tech Stack:** Bun, Node standard library, TypeScript/Bun tests, devenv, Tailscale CLI, existing Bun/Hono bridge

**Spec:** `docs/superpowers/specs/2026-09-14-guided-first-run-setup-design.md`

## Global Constraints

- Add no runtime or development dependency.
- Support the repository's macOS + Tailscale deployment only.
- Never print or copy the generated `CMUX_REMOTE_TOKEN`.
- Never overwrite an existing `.env` or a non-matching Tailscale Serve configuration.
- Never edit tailnet policy through an API; generate and copy one narrow grant for human review.
- Use `gibb.one/cap/cmux-remote` only as a public default; accept a validated replacement.
- Keep token-mode fallback, authentication, cookies, and browser RPC behavior unchanged.
- Run every build, test, formatter, and language command through repository devenv.

## File map

- Create `setup.js`: pure Tailscale/Serve/config helpers plus the interactive first-run orchestrator.
- Create `setup.test.ts`: Bun tests for parsing, rendering, file safety, command ordering, and failure behavior.
- Modify `server/src/config.ts`: export the existing capability-name validator without changing it.
- Modify `server/src/__tests__/config.test.ts`: pin the exported validator's accepted/rejected boundary.
- Modify `devenv.nix`: add `setup` and `start` scripts and include root setup tests in `test-all`.
- Modify `package.json`: lint the new setup files.
- Modify `README.md`: put the guided Tailscale path first and move token details under security/advanced setup.
- Modify `AGENTS.md`: document the two operator commands and setup-script safety boundary.
- Modify `docs/superpowers/ROADMAP.md`: change lifecycle dates only after delivery is merged and verified.

---

### Task 1: Tailscale and Serve configuration helpers

**Files:**
- Create: `setup.js`
- Create: `setup.test.ts`
- Modify: `server/src/config.ts:70-79`
- Modify: `server/src/__tests__/config.test.ts:1-100`

**Interfaces:**
- Consumes: installed Tailscale JSON shapes and `isCapabilityName(value: string): boolean` from `server/src/config.ts`.
- Produces: `DEFAULT_CAPABILITY`, `SERVE_TARGET`, `parseTailscaleStatus(raw)`, `renderGrant(input)`, `classifyServeStatus(raw, expected)`, and exported `isCapabilityName`.

- [ ] **Step 1: Write failing status and grant tests**

Create `setup.test.ts` with literal fixtures that cover an object-valued `.Peer`, an absent `.Peer`, exact IPv4 selection, trailing-dot removal, and exact grant output:

```ts
import { describe, expect, it } from "bun:test";
import {
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
});
```

- [ ] **Step 2: Write failing Serve-classification tests**

Add cases for empty, exact, and conflicting Serve state. Exact requires the HTTPS TCP listener and
must reject Funnel exposure. The fixture must mirror the installed CLI:

```ts
import { classifyServeStatus } from "./setup.js";

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
```

- [ ] **Step 3: Pin the shared capability validator**

Export `isCapabilityName` from `server/src/config.ts`. In `server/src/__tests__/config.test.ts`, import it and add:

```ts
it("validates setup capability identifiers", () => {
  expect(isCapabilityName("gibb.one/cap/cmux-remote")).toBe(true);
  expect(isCapabilityName("tail1234.ts.net/cap/cmux-remote")).toBe(true);
  expect(isCapabilityName("not-a-capability")).toBe(false);
  expect(isCapabilityName(`example.com/${"x".repeat(256)}`)).toBe(false);
});
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```bash
devenv shell -- bun test ./setup.test.ts server/src/__tests__/config.test.ts
```

Expected: FAIL because `setup.js` and its exports do not exist and `isCapabilityName` is private.

- [ ] **Step 5: Implement the pure helpers**

Create `setup.js` using `JSON.parse`, `Object.values`, `Array.find`, `URL`, and literal object rendering. Required behavior:

```js
import { isCapabilityName } from "./server/src/config.ts";

export const DEFAULT_CAPABILITY = "gibb.one/cap/cmux-remote";
export const SERVE_TARGET = "http://127.0.0.1:3456";

const ipv4 = (values) =>
  Array.isArray(values)
    ? values.find((value) => typeof value === "string" && /^100\./.test(value))
    : undefined;

export function parseTailscaleStatus(raw) {
  const status = JSON.parse(raw);
  if (status?.BackendState !== "Running") {
    throw new Error("Tailscale is not running");
  }
  const dnsName = status?.Self?.DNSName;
  const macIp = ipv4(status?.Self?.TailscaleIPs);
  if (typeof dnsName !== "string" || !dnsName || !macIp) {
    throw new Error("Tailscale status has no MagicDNS name or IPv4 address");
  }
  const phones = Object.values(status.Peer ?? {})
    .filter((peer) => peer?.OS === "iOS" && ipv4(peer.TailscaleIPs))
    .map((peer) => ({
      dnsName: String(peer.DNSName ?? "").replace(/\.$/, ""),
      ip: ipv4(peer.TailscaleIPs),
      name: String(peer.HostName || peer.DNSName || "iPhone").replace(/\.$/, ""),
      online: peer.Online === true,
    }));
  return {
    macIp,
    origin: `https://${dnsName.replace(/\.$/, "")}`,
    phones,
  };
}

export function renderGrant({ capability, macIp, phoneIp }) {
  if (!isCapabilityName(capability)) throw new Error("Invalid capability name");
  return JSON.stringify(
    {
      src: [phoneIp],
      dst: [macIp],
      ip: ["tcp:443"],
      app: { [capability]: [{ access: true }] },
    },
    null,
    2,
  );
}
```

Implement `classifyServeStatus` by parsing the expected origin with `URL`, checking the exact root handler at `${url.hostname}:443`, and returning only `"missing"`, `"exact"`, or `"conflict"`. Invalid JSON must throw instead of being classified as missing.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
devenv shell -- bun test ./setup.test.ts server/src/__tests__/config.test.ts
```

Expected: all focused tests PASS with no warning or secret output.

- [ ] **Step 7: Commit the helper boundary**

```bash
git add setup.js setup.test.ts server/src/config.ts server/src/__tests__/config.test.ts
git commit -m "feat(setup): parse Tailscale pairing state"
```

---

### Task 2: Safe interactive setup orchestration

**Files:**
- Modify: `setup.js`
- Modify: `setup.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers and `loadConfig(env)` from `server/src/config.ts`.
- Produces: `createEnvFile(path, values)`, `runSetup(dependencies)`, and the main-module CLI behavior.

- [ ] **Step 1: Write failing private-file tests**

Use `mkdtemp`, `readFile`, `stat`, and `rm` from `node:fs/promises` with a temporary directory. Prove that `createEnvFile`:

```ts
it("creates a private env file without exposing or replacing its secret", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cmux-remote-setup-"));
  const path = join(directory, ".env");
  try {
    await createEnvFile(path, {
      capability: "gibb.one/cap/cmux-remote",
      origin: "https://cmux.tail1234.ts.net",
      secret: "a".repeat(64),
    });
    expect(await readFile(path, "utf8")).toBe(
      [
        `CMUX_REMOTE_TOKEN=${"a".repeat(64)}`,
        "CMUX_REMOTE_ORIGIN=https://cmux.tail1234.ts.net",
        "CMUX_REMOTE_TAILSCALE_CAPABILITY=gibb.one/cap/cmux-remote",
        "",
      ].join("\n"),
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(createEnvFile(path, {
      capability: "gibb.one/cap/cmux-remote",
      origin: "https://cmux.tail1234.ts.net",
      secret: "b".repeat(64),
    })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toContain("a".repeat(64));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write failing successful-orchestration test**

Define a dependency object with captured `logs`, `copied`, `commands`, fixed prompt answers, a temporary root, and a fake 32-byte random value. Invoke `runSetup(dependencies)` and assert the exact command sequence:

```ts
expect(commands).toEqual([
  ["tailscale", "status", "--json"],
  ["tailscale", "serve", "status", "--json"],
  ["bun", "run", "--cwd", "client", "build"],
  ["tailscale", "serve", "status", "--json"],
  [
    "tailscale",
    "serve",
    "--bg",
    "--yes",
    "--accept-app-caps=gibb.one/cap/cmux-remote",
    "http://127.0.0.1:3456",
  ],
  ["bun", "run", "--cwd", "server", "start"],
]);
expect(copied).toHaveLength(1);
expect(copied[0]).toContain('"src": [\n    "100.64.0.2"');
expect(logs.join("\n")).not.toContain("a".repeat(64));
```

The fake command runner returns the Task 1 status fixture for `tailscale status`, `{}` for Serve
status, success for build/configure/start, and records the environment given to the server command.
Assert that the server receives the generated token, origin, and capability without any value being
logged.

- [ ] **Step 3: Write failing preservation and stop-on-error tests**

Add separate cases proving:

```ts
it("reuses an exact Serve handler without configuring it", async () => {
  await runSetup(exactServeDependencies);
  expect(commands).not.toContainEqual(
    expect.arrayContaining(["tailscale", "serve", "--bg"]),
  );
});

it("stops before start when Serve conflicts", async () => {
  await expect(runSetup(conflictingServeDependencies)).rejects.toThrow(
    "existing Tailscale Serve configuration",
  );
  expect(commands).not.toContainEqual([
    "bun", "run", "--cwd", "server", "start",
  ]);
});

it("stops when no iPhone peer is available", async () => {
  await expect(runSetup(noPhoneDependencies)).rejects.toThrow("No iPhone");
  expect(commands).toEqual([["tailscale", "status", "--json"]]);
});
```

Also cover multiple phones with an out-of-range selection, refusal at the single-phone confirmation,
build failure before Serve mutation, `.env` reuse only with valid pairing variables, and clipboard
failure falling back to terminal output.

- [ ] **Step 4: Run the setup tests and verify RED**

Run:

```bash
devenv shell -- bun test ./setup.test.ts
```

Expected: FAIL because `createEnvFile` and `runSetup` do not exist.

- [ ] **Step 5: Implement private configuration creation**

Use `randomBytes(32).toString("hex")`, `open(path, "wx", 0o600)`, one `writeFile` call through the
opened handle, and `close()` in `finally`. Render exactly three newline-terminated assignments. Do
not implement a general dotenv parser or merge helper.

- [ ] **Step 6: Implement prompt and command orchestration**

Define default dependencies around `node:readline/promises`, `Bun.spawn`, `process.stdin/stdout`,
`pbcopy`, and filesystem APIs. `Bun.spawn` receives arrays; no command passes through a shell.

`runSetup` must:

1. reject non-darwin platforms;
2. capture and parse `tailscale status --json`;
3. confirm/select one displayed iOS peer;
4. reuse valid pairing variables from an existing `.env`, or prepare a validated capability and
   secret without writing yet;
5. preflight the exact HTTPS, non-Funnel Serve state and stop on conflict;
6. run the client build and stop on nonzero exit before writing `.env` or showing a grant;
7. create the new private `.env` when needed, copy and print the exact grant, print
   `https://login.tailscale.com/admin/acls/file`, and wait for confirmation;
8. recheck Serve and either reuse, configure, or reject with grant-removal instructions;
9. log the derived HTTPS origin and pairing instruction without secrets;
10. run the server in foreground with inherited stdio and the merged generated environment;
11. forward termination signals, propagate the server exit code, and close readline.

Execute the CLI only under:

```js
if (import.meta.main) {
  runSetup().catch((error) => {
    console.error(`Setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
```

Do not add automatic policy APIs, node renaming, launchd, Funnel, `.env` overwrites, Serve resets, or
multi-phone grants.

- [ ] **Step 7: Run setup tests and verify GREEN**

Run:

```bash
devenv shell -- bun test ./setup.test.ts
```

Expected: all setup tests PASS; captured output contains no generated secret.

- [ ] **Step 8: Commit the wizard**

```bash
git add setup.js setup.test.ts
git commit -m "feat(setup): guide one-device Tailscale pairing"
```

---

### Task 3: Devenv commands and primary Getting Started documentation

**Files:**
- Modify: `devenv.nix:10-58`
- Modify: `package.json:4-7`
- Modify: `README.md:1-240`
- Modify: `AGENTS.md:79-125`

**Interfaces:**
- Consumes: root `setup.js` and its tested command behavior.
- Produces: `devenv shell -- setup`, `devenv shell -- start`, setup tests inside `test-all`, and the new README information hierarchy.

- [ ] **Step 1: Add devenv setup and start scripts**

Add:

```nix
scripts.setup.exec = "bun setup.js";

scripts.start.exec = ''
  build-all
  bun run --cwd server start
'';
```

Add `bun test ./setup.test.ts` to `scripts.test-all.exec` before client/server suites. Add `setup` and
`start` to `enterShell`'s command list. Keep `devenv up` unchanged.

- [ ] **Step 2: Include setup files in linting**

Change the root lint script to:

```json
"lint": "biome lint setup.js setup.test.ts client/src server/src e2e playwright.config.ts"
```

Run:

```bash
devenv shell -- lint
```

Expected: PASS after formatting only the reported setup-file issues with the repository's Biome
configuration. Do not reformat unrelated files.

- [ ] **Step 3: Reorder README around Getting Started**

Place `## Getting started` immediately after the product introduction. It must:

- say the only credential entered on the iPhone is the six-digit pairing code;
- list cmux, Tailscale on Mac/iPhone, and devenv as prerequisites;
- show `devenv shell -- deps`, then `devenv shell -- setup`;
- describe selecting the displayed iPhone, pasting the copied grant, saving policy, opening the
  derived HTTPS URL, entering the printed code, and Add to Home Screen;
- show `devenv shell -- start` for later launches.

Move the current session-signing-secret explanation, manual `.env` instructions, token fallback,
configuration table, revocation, and threat model below `## Security and advanced setup`. Do not
remove the token fallback or claim the six-digit code alone authorizes a non-Tailscale client.

- [ ] **Step 4: Align the agent guide**

Update `AGENTS.md` so first-run and normal production smoke work use the two shortcuts. State that
`setup.js` may inspect only local Tailscale state and may configure Serve, but must never edit remote
tailnet policy or reveal `.env` values. Keep `CLAUDE.md` as a thin pointer with no duplicated setup.

- [ ] **Step 5: Run documentation and focused command checks**

Run:

```bash
devenv shell -- test-all
devenv shell -- lint
git diff --check
```

Expected: setup/client/server tests PASS, lint PASS, and no whitespace errors. Manually confirm every
relative README/AGENTS link exists and each documented devenv command is defined in `devenv.nix`.

- [ ] **Step 6: Commit commands and documentation**

```bash
git add devenv.nix package.json README.md AGENTS.md
git commit -m "docs: make guided setup the primary path"
```

---

### Task 4: Full verification and fork delivery

**Files:**
- Modify after merge: `docs/superpowers/ROADMAP.md`

**Interfaces:**
- Consumes: all prior task commits and the approved spec.
- Produces: verified fork `master`, closed feature branch, and accurate roadmap lifecycle dates.

- [ ] **Step 1: Run setup regression tests independently**

Run:

```bash
devenv shell -- bun test ./setup.test.ts server/src/__tests__/config.test.ts
```

Expected: all setup/config tests PASS with no real Tailscale, clipboard, Serve, or bridge mutation.

- [ ] **Step 2: Run the complete repository gate**

Run:

```bash
devenv shell -- check
```

Expected: Biome lint, root/client/server tests, both TypeScript builds, production PWA build, Chromium
E2E, and iPhone WebKit E2E PASS. The deliberate non-iPhone Chromium pairing scenario remains the only
skip.

- [ ] **Step 3: Review the final branch**

Run:

```bash
git diff master...HEAD --check
git status --short --branch
git log --oneline master..HEAD
```

Expected: no whitespace errors, no uncommitted files, and only the setup feature's commits. Inspect
the complete diff for token leakage, shell interpolation, broad grants, `.env` overwrite, Serve
reset, Funnel, and unrelated changes.

- [ ] **Step 4: Merge only into the fork**

Fast-forward the local `master`, set it to track `origin/master`, and push only to
`https://github.com/enryold/cmux-remote`. Do not push, open a pull request, or merge against the
`upstream` remote.

- [ ] **Step 5: Record lifecycle after merge**

On merged `master`, set the Guided first-run setup row's `Developed` date to `2026-09-14`. Leave
`Live` as `—` until the real wizard has been run from a clean first-run configuration on the target
Mac and paired from the target iPhone. Commit and push that documentation-only lifecycle update.

- [ ] **Step 6: Close the feature branch without disrupting the live PWA**

Delete the merged local and fork feature branch. Preserve the existing detached
`.worktrees/milestone-1` directory while its live server is still serving the paired iPhone; do not
remove or reset that worktree as part of this feature.
