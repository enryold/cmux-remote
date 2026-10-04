# Surface Content Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** View content already open in cmux through read-only iPhone previews, delivering browser
screenshots independently of the blocked native Markdown/image provider.

**Architecture:** Discover typed surfaces through the existing tree. Add one authenticated,
surface-targeted HTTP preview route backed by fixed server-owned cmux reads. Keep bytes in memory,
and isolate preview failures from terminal input and discovery.

**Tech Stack:** Existing Bun/Hono, React 19, TypeScript, Vitest, Bun tests, Playwright, repository
devenv; no rendering or streaming dependency for the simple browser viewer.

**Spec:** [Surface content previews](../specs/2026-10-04-surface-content-previews-design.md)

**Status:** execution authorized on 2026-10-04; browser Tasks 1–3 implemented on the feature branch. Task 4 remains blocked by the verified installed socket contract. Final review/acceptance are recorded below.

## Global Constraints

- Request: protected POST `/api/surfaces/:surfaceId/preview`, empty body, exact UUID, no path/RPC name.
- Every request requires session, exact Origin, and the configured Tailscale app capability.
- Preserve localhost-only binding and the explicit terminal RPC whitelist.
- Do not expose browser navigation/input, script evaluation, cookies, storage, HTML, or file browsing.
- JSON at most 3 MiB; image bytes at most 2 MiB; dimensions at most 4,096; area at most 8,388,608.
- Markdown at most 256 KiB UTF-8; allowed native raster MIME types: PNG, JPEG, WebP.
- Deadline 10 seconds; at most one preview capture in flight; no capture queue or server cache.
- Preserve existing socket frame limits and reject oversized captures without changing those limits.
- Responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; no path-bearing errors.
- Image zoom is local only: 25%–300%, initial 100%, step 25%; capture on open, Refresh, or foreground.
- No persistence of preview content and no new service-worker cache entries.
- Native Markdown/images require the spec's verified provider gate; capability advertisement is insufficient.

## Review Focus

1. A forged/stale/moved UUID or wrong panel type must not capture another surface (Tasks 2 and 4).
2. PNG/base64 metadata, dimensions, or byte budgets are malformed: typed error without path/data leaks (Task 2).
3. The phone switches views or loses auth during capture: discard late content and clear bytes (Task 3).
4. Unauthorized device/Origin or overlapping captures: reject without taking down terminals (Task 2).
5. Missing native handlers or unsupported MIME: explicit unavailable state and incomplete lifecycle (Tasks 1 and 4).

## File Ownership

- New `server/src/surface-preview.ts`: target resolution, fixed reads, validation, capture limits/errors.
- New `server/src/preview-routes.ts`: protected HTTP endpoint and response boundary.
- Existing `server/src/index.ts`: route registration before static serving and shared service lifetime.
- Existing `server/src/rpc.ts`: retain raw/private fields server-side; add only sanitized preview labels
  as `urlLabel: string | null` to the tree, never broad new browser methods.
- Existing `client/src/lib/topology.ts` and `components/Dashboard.tsx`: typed surface discovery/rows.
- New `client/src/lib/surface-preview.ts`: normalized response type and validation.
- New `client/src/hooks/useSurfacePreview.ts`: selected-view retrieval and late-response invalidation.
- New `client/src/components/SurfacePreview.tsx`: loading/unsupported/stale states, local image zoom/pan.
- Existing `client/src/App.tsx`, `lib/cmux-rpc.ts`, `hooks/useCmux.ts`, `styles/global.css`:
  typed selection, tree shape, preview navigation.
- Existing `client/vite.config.ts`: add the `/api` proxy alongside `/auth`, `/health`, and `/ws`.
- Focused test files accompany new units; browser flows use new `e2e/preview.spec.ts` and `e2e/fake-cmux.ts`.

## Task 1: Establish the actual preview compatibility contract

**Files:** update compatibility evidence in the governing spec; create
`server/src/__tests__/preview-fixtures.ts` only for complete verified shapes and the known failure.

**Interfaces:** fixtures identify workspace/surface UUIDs, complete successful browser screenshot
response (`png_base64`, IDs, extra private fields), and native-handler failure. They are inert data,
not fake evidence of support. Native provider work is gated separately below.

- [x] Read the spec and fresh installed version/capabilities; redact local paths and private identity
  from any durable evidence.
- [x] Capture a browser screenshot only from a disposable surface containing deterministic public
  test content. Verify screenshot IDs, PNG encoding, dimensions, bounds, and timeout behavior.
  Preserve any viewport override cleanup; no screenshot of existing private browser content.
- [x] Recheck native panel support with nonexistent UUIDs first. The planning-time result was
  `internal_error: v2 worker method 'mobile.panel.artifact.stat' has no worker handler`.
  Do not treat `panel.artifact.v1` as proof the operation is callable through this socket.
- [x] Save complete synthetic/redacted browser response fixtures and the negative native response.
  Record that current `system.tree` gives no native-panel content path/descriptor.
- [x] If native support remains unavailable, keep Task 4 blocked and proceed with browser Tasks 2–3.
  Do not add a filesystem fallback, mobile cloud transport, inferred path, or cmux fork in this task.
- [x] Review fixture representativeness and the spec's evidence; commit the compatibility record.

## Task 2: Add a protected bounded browser screenshot endpoint

**Files:** create `server/src/surface-preview.ts`, `server/src/preview-routes.ts`,
`server/src/__tests__/surface-preview.test.ts`, `server/src/__tests__/preview-routes.test.ts`;
modify `server/src/index.ts`, relevant server integration tests, and `client/vite.config.ts`.

**Interfaces:** export `SurfacePreview` matching the spec and `PreviewError` with its exact codes;
`resolvePreviewSurface(tree: unknown, surfaceId: string): {workspaceId: string; surfaceId: string; type: string}`;
`sanitizeBrowserPreview(raw: unknown, target: {workspaceId: string; surfaceId: string}, capturedAt: string): SurfacePreview`;
`createPreviewService(config: RuntimeConfig): {capture(surfaceId: string): Promise<SurfacePreview>; close(): void}`;
`createPreviewRoutes(config: RuntimeConfig, service: ReturnType<typeof createPreviewService>): Hono`.

- [x] Write tests that missing session, wrong Origin, missing/wrong capability, invalid UUID,
  nonempty body, extra client fields, and path/RPC inputs are rejected before a cmux capture.
- [x] Add tests resolving a fresh live browser target and checking response IDs and post-capture
  ownership. Assert unknown/terminal/native types produce `preview_unsupported`, missing/moved
  targets produce `surface_unavailable`, and there is no implicit focused-surface fallback.
- [x] Pin byte validation and all limits with assertions such as:

  ```ts
  expect(() => sanitizeBrowserPreview(oversizedPngResponse, target, capturedAt))
    .toThrow("preview_too_large");
  expect(JSON.stringify(sanitizeBrowserPreview(validResponse, target, capturedAt)))
    .not.toContain("/private/");
  ```

  Cover invalid base64/signature/IHDR, mismatched IDs, 2 MiB decoded bytes, 4,096-pixel axes,
  8,388,608-pixel area, 3 MiB JSON, and upstream path-bearing errors. Valid data URLs never use
  upstream `path` or `url` fields.
- [x] Add concurrency/deadline tests: second capture is busy, one capture expires at 10 seconds,
  errors release resources, and unrelated terminal WebSocket operations continue. Include disconnect
  and service shutdown. Require no unbounded overlap or request queue after timeout.
- [x] Run `devenv shell -- bun --cwd server test src/__tests__/surface-preview.test.ts src/__tests__/preview-routes.test.ts`;
  confirm new route/service tests fail before implementation.
- [x] Implement the dedicated shared preview service over the existing CmuxClient, fresh-tree target
  checks, fixed `browser.screenshot` call, response sanitizer, and error normalization. Reject native
  types until Task 4's gate passes. Reuse `isAuthorized` / `isAllowedOrigin` rather than inventing auth.
- [x] Register the route before static serving, close its client during server shutdown, and proxy
  `/api` in Vite. Preserve current CSP and WebSocket whitelist.
- [x] Repeat focused server tests and relevant `server.test.ts` / `ws.test.ts`; require all pass.
  Inspect/commit the independently testable endpoint and document its actual bounds in README.

## Task 3: Discover typed surfaces and show local browser previews

**Files:** create `client/src/lib/surface-preview.ts`, `client/src/hooks/useSurfacePreview.ts`,
`client/src/components/SurfacePreview.tsx`, their tests, and `e2e/preview.spec.ts`;
modify topology, Dashboard, App, cmux tree parsing, CSS, `e2e/fake-cmux.ts`, and README.

**Interfaces:** export `parseSurfacePreview(value: unknown): SurfacePreview` and
`previewSurfaceWorkspaces(tree: TreeSnapshot)` alongside existing terminal helpers;
`useSurfacePreview({surfaceId: string | null, enabled: boolean, onUnauthorized(): void})`
returns `{preview: SurfacePreview | null; status: "idle" | "loading" | "ready" | "stale" | "unsupported" | "error"; refresh(): void}`.
`SurfacePreview` component consumes these values and handles local zoom/pan. App selection tracks
surface ID/type and enables terminal polling/input only for terminal selections. Client/server
`TreeSnapshot` surface rows and `useCmux` tree parsing add `urlLabel: string | null`, as defined in
the spec; existing terminal-only helpers remain usable.

- [x] Write topology tests for browser/Markdown/filepreview discovery and stable workspace/pane order;
  unknown types remain unsupported. Sanitize browser URL display to HTTP(S) origin only; test credentials,
  path tokens, query tokens, fragments, and file URLs never reach labels or navigation targets.
- [x] Add hook tests for one request on open/Refresh/foreground, no periodic capture, late responses
  after selection changes, auth expiry, disconnect, and preserving only a visibly stale last capture
  after refresh errors. Check the exact POST route, empty body, and same-origin credentials.
  Bound response reading to 3 MiB before JSON parsing, including missing/dishonest Content-Length;
  reject a body exceeding that budget rather than relying on an unbounded `response.json()`.
- [x] Add UI tests for captured time, loading/error/unsupported states, local zoom boundaries and
  scroll containers; no remote keys or browser controls. Markdown/native rows truthfully report unavailable.
- [x] Run `devenv shell -- bun run --cwd client test src/lib/__tests__/surface-preview.test.ts src/hooks/__tests__/useSurfacePreview.test.ts src/components/__tests__/SurfacePreview.test.tsx`;
  confirm failures before adding the viewer.
- [x] Implement typed navigation and normalized response validation, the hook, and the local image
  viewer. Keep no preview bytes in browser storage; retain existing terminal behavior and Back flow.
- [x] Add complete fake browser PNG responses and E2E for view/zoom/Refresh/closure/reconnect/auth expiry.
  Record cmux calls and assert no browser input, navigation, reload, viewport mutation, or arbitrary RPC.
  Add the preview POST path to service-worker exclusion tests without expanding its cache policy.
- [x] Repeat focused client tests and run `devenv shell -- bun run e2e -- e2e/preview.spec.ts e2e/terminal.spec.ts`;
  require both configured browser projects pass. Update README's current behavior only now, inspect,
  and commit the usable browser-preview milestone slice.

## Task 4: Unblock and deliver native Markdown/image previews

**Files:** after the gate passes, extend `server/src/surface-preview.ts` and its tests,
`client/src/components/SurfacePreview.tsx` and tests, verified preview fixtures,
`e2e/preview.spec.ts`, the governing spec, and README. Add a dedicated native-provider file only
if the verified contract's size warrants separating it from the existing service.

**Interfaces:** normalize native reads to the same `SurfacePreview` union. No additional client path,
RPC selector, directory API, or arbitrary URL is introduced. A supported provider must resolve
the content associated with `{workspaceId, surfaceId}` through its verified resource identity.

- [ ] **Gate:** obtain a supported, callable content descriptor/read contract on the target cmux
  version, and prove exact native-panel ownership plus changes/removal behavior in disposable panels.
  Document complete stat/read shapes, byte limits, stale identity handling, and any private-contract
  compatibility review. This gate currently fails; capability strings alone cannot complete it.
- [ ] If it still fails, leave this task unchecked and report the explicit upstream dependency.
  Stop only native-provider work; Tasks 2–3 and terminal usability remain valid deliverables.
  Editing/deploying a cmux fork requires a separately scoped, reviewable plan and authority.
- [ ] Once the gate passes, write failing tests for authorized current-panel Markdown and raster
  retrieval, unrelated path/resource rejection, symlink/replacement handling when relevant to the
  real contract, removal/reassignment, schema drift, and no sensitive metadata/error leakage.
- [ ] Pin Markdown UTF-8 limit 256 KiB; raster byte/dimension/area bounds from the spec; reject SVG,
  PDF, malformed bytes, unsupported formats, and automatic Markdown asset/HTML execution.
- [ ] Run `devenv shell -- bun --cwd server test src/__tests__/surface-preview.test.ts` and focused
  client viewer tests; confirm the new native cases fail under the unsupported provider state.
- [ ] Implement the narrow server-owned provider using the verified contract, returning escaped
  Markdown source or validated image bytes. Do not infer paths from titles or shell output.
- [ ] Repeat focused tests and full fake/real native-panel flows. Update the compatibility record
  and README with the actual supported version; commit only after the gate and tests pass.

## Task 5: Review security and verify the requested viewing scope

**Files:** tests/fixes within this plan's owned units; README real-device checklist and roadmap
lifecycle only when the applicable events actually occur.

- [ ] Run `devenv shell -- check`; require lint, unit/integration tests, typechecks, build, and
  Chromium/iPhone WebKit E2E pass. Inspect the whole diff, including auth placement and cache policy.
- [ ] Request a fresh whole-branch review focused on capability/Origin checks, target binding,
  byte/queue bounds, private response fields, late content, and isolation from terminal input.
- [ ] On disposable Mac/iPhone surfaces, verify the spec's browser checklist and existing terminal
  discovery/input/reconnect. Verify native panels as well only after Task 4 succeeds.
- [ ] Record partial acceptance accurately. Browser screenshots can pass independently; the full
  Markdown/image/browser viewing request cannot be declared complete while Task 4 is blocked.
- [ ] Commit verified changes; set Developed after merge and Live only after the applicable real
  Mac/iPhone checks. Do not deploy or mark lifecycle dates merely because this plan was written.

## Handoff

Review the spec, the installed native-handler blocker, and this plan before execution. Complete
terminal usability first. Native execution with one independent security-focused branch review is
recommended for browser Tasks 1–3; decide how to resolve the native cmux dependency separately.
This plan does not authorize browser control, filesystem access, or a cmux fork.
