# Milestone 2 — Read-only surface content previews

**Date:** 2026-10-04

**Status:** approved for execution on 2026-10-04; browser screenshots merged into `master` on 2026-10-04; full check passed; native Markdown/image reads remain blocked and hardware iPhone acceptance is pending.

## Intent and scope

Enrico chose the simple version: consult content already open in cmux from the iPhone. The requested
content is browser tabs, local Markdown panels, and local images. Discover live surfaces, open one
preview, refresh it, and enlarge its content locally. There is no file picker, arbitrary path input,
directory listing, remote browser interaction, or agent dashboard in this milestone.

The [terminal usability work](2026-10-04-mobile-terminal-usability-design.md) is independently
deliverable and precedes preview integration. It must retain reliable discovery, output, input,
and reconnect throughout this work.

## Verified compatibility and current blocker

Assessment on 2026-10-04: installed cmux `0.64.25 (106)`, commit `b685a275c`, socket automation mode.

Execution recheck on the same version: a disposable browser displaying deterministic local public
HTML returned a valid 80,755-byte PNG (1,462 × 1,818 pixels) from raw `browser.screenshot` with
explicit workspace/surface UUIDs. The complete result has `workspace_id`, `workspace_ref`,
`surface_id`, `surface_ref`, `png_base64`, `path`, and `url`; IDs use uppercase and dimensions come
from PNG IHDR bytes, not response metadata. The CLI `browser screenshot --json` consumes the bytes
and only prints path/ref fields, so the bridge must use the socket RPC. The temporary viewport
override was reset. Repeating the nonexistent-panel native request reproduced the handler error
below; native delivery remains blocked.

- `system.tree` discovers typed surfaces, including `browser`, `markdown`, and `filepreview`.
  Installed live surfaces happened to be terminal-only; no existing user content was captured.
- `browser.screenshot` is an advertised socket method. Matching upstream source returns
  `png_base64` and may include temporary filesystem `path`/`url` fields; the latter must be stripped.
  The screenshot depicts the browser's current viewport, not a full-page document.
- Native panel artifact capabilities are advertised, but they are not evidence that this Unix
  socket exposes the corresponding operations. An inert request with nonexistent UUIDs to
  `mobile.panel.artifact.stat` returned:
  `internal_error: v2 worker method 'mobile.panel.artifact.stat' has no worker handler`.
- Matching upstream `ControlSystemTreeSurfaceNode` only emits a URL for browser surfaces.
  It does not expose the native Markdown/image file path. Native panel content cannot be recovered
  safely just from the current sanitized tree or the surface title.

**Native Markdown/image previews are blocked on a verified cmux content-read contract.** The plan
must not invent a successful socket method, infer file paths from titles, parse shell output for
paths, or silently add general filesystem access. Browser preview work can proceed independently.
If the compatibility gate fails during execution, record the remaining dependency and leave native
content previews incomplete. Resolution may require a separately scoped cmux upstream change; this
repository's plan does not authorize editing or deploying a cmux fork.

Primary references for compatibility investigation:

- [cmux CLI contract](https://github.com/manaflow-ai/cmux/blob/b685a275c/docs/cli-contract.md)
- [Screenshot implementation](https://github.com/manaflow-ai/cmux/blob/b685a275c/Sources/TerminalController.swift)
- [Tree surface fields](https://github.com/manaflow-ai/cmux/blob/b685a275c/Packages/macOS/CmuxControlSocket/Sources/CmuxControlSocket/Coordinator/System/ControlSystemTreeSurfaceNode.swift)
- [Native panel resolution tests](https://github.com/manaflow-ai/cmux/blob/b685a275c/cmuxTests/MobilePanelArtifactResolutionTests.swift)

## Discovery and navigation

Preserve workspace and pane ordering, and show terminal, browser, Markdown, and file-preview rows
with a type label. Unknown types remain visibly unsupported and cannot receive terminal input.
Opening a preview does not focus or switch the surface on the Mac. Removing the selected surface
returns to the dashboard; late responses for another surface are discarded.

A browser row shows its HTTP(S) origin as a display label; remove userinfo, path, query, and fragment
so token-bearing URLs are not exported. Add `urlLabel: string | null` to the sanitized surface shape,
bounded to 4,096 UTF-8 bytes. Non-browser and non-HTTP(S) surfaces, including local file URLs, use
null and a generic UI label. Do not turn a displayed label into a proxy-fetch or navigation target.
Do not add arbitrary browser URL retrieval, DOM, cookies, storage, script execution, or input RPCs.

## Normalized preview boundary

The browser-facing request is a protected **POST `/api/surfaces/:surfaceId/preview`** with an empty
body and an exact UUID target. It accepts neither a file path nor an upstream RPC name. Protect every
request with the current application session, exact-Origin validation, and the configured Tailscale
app capability. Register it before static-file serving. The production route and Vite proxy share
the same path. Responses always use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

The server obtains a fresh live tree, resolves the UUID to its workspace and panel type, and only
then invokes a server-owned read operation. Recheck membership/ownership after retrieval; removal,
replacement, or workspace reassignment invalidates that result. No request may target a focused or
default surface implicitly. No browser input is ever accepted by this route.

Browser retrieval uses fixed `browser.screenshot` parameters for the resolved workspace/surface.
Validate returned IDs against the target, validate PNG bytes and dimensions, and expose only the
normalized image payload. Never return or read the upstream screenshot's temporary path. The route
must use the base64 bytes, not fetch a returned URL.

The successful response is a bounded JSON union:

```ts
type SurfacePreview =
  | {
      kind: "image";
      surfaceId: string;
      capturedAt: string;
      mime: "image/png" | "image/jpeg" | "image/webp";
      width: number;
      height: number;
      base64: string;
    }
  | {
      kind: "markdown";
      surfaceId: string;
      capturedAt: string;
      text: string;
    };
```

Limits: decoded image 2 MiB, each image dimension 4,096 pixels, image area 8,388,608 pixels,
Markdown 256 KiB of UTF-8 text, JSON body 3 MiB, retrieval deadline 10 seconds. Existing socket
framing limits remain bounded. Do not increase them implicitly to fit an oversized screenshot.
Allow only one preview capture in flight across the bridge; an overlapping request returns a typed
busy error, rather than creating a queue. Keep no server preview cache.

Failures return `{error: {code}}` with generic codes: `unauthorized` (401), `surface_unavailable`
(404), `preview_unsupported` (422), `preview_too_large` (413), `preview_busy` (429),
`preview_timeout` (504), or `preview_failed` (502). Path-bearing upstream errors are not forwarded.
Unsupported or failed preview requests do not close the terminal WebSocket or break discovery.

## Native content provider prerequisite

Before implementing native content retrieval, prove a supported cmux operation can authorize and
read the exact currently open native panel by surface/workspace identity. Record its version,
complete response fixtures, resource identity, limits, and changes/removal behavior. A capability
name alone does not pass the gate. Resolve any private contract through an explicit compatibility
review before adopting it.

The provider must supply current panel identity and either bounded bytes or an opaque, authorized
content reference. Client-supplied paths and directory enumeration remain excluded. If the actual
upstream contract requires a path, the path must come from a verified server-side descriptor for
that exact live panel, and the provider must enforce the panel/file association on every read.
The route must never accept that path from the PWA. A generic filesystem reader is not a fallback.

Once the prerequisite is met, support Markdown as escaped, readable source text and PNG/JPEG/WebP
as locally zoomable images. The simple Markdown viewer does not execute embedded HTML, scripts,
links, or load referenced local/remote images automatically. SVG, PDF, video, arbitrary source files,
and unsupported image formats remain unsupported. Image previews show the currently saved file;
they do not expose native panel editing controls. No new Markdown rendering dependency is required.

## Client behavior

Fetch on open, manual **Refresh**, and return to the foreground while a preview remains selected.
Do not stream or poll screenshots continuously. Show capture time, loading, unavailable/unsupported,
and failure states. During a refresh failure keep the last image visibly marked stale; disconnect
or auth expiry clears preview bytes. Abandon old responses after switching surfaces or leaving
the view, even if the underlying capture cannot be cancelled immediately.

Use ordinary scroll containers and bounded local zoom controls (25%–300%, default 100%, step 25%)
for image inspection. Local panning/zooming never sends browser scroll, zoom, click, navigation, or
typing commands to the Mac. A screenshot only reveals the viewport visible on the Mac; the user
must move the page on the Mac to expose different remote page content in this simple version.

Keep preview bytes in memory. Do not save them in preferences, browser storage, logs, static assets,
or the service worker cache. The existing same-origin/data-image CSP is sufficient for validated
image data URLs; do not add iframes, remote image origins, blob scripts, or active HTML rendering.

## Verification and release acceptance

Use Bun tests for auth, target membership, response validation, concurrency, resource limits, and
failure isolation. Use Vitest for typed topology and stale-response handling. Use deterministic
Chromium and iPhone WebKit E2E against complete fake browser responses. Native-content fixtures
are admitted only after the compatibility gate, and need real-panel verification as well.

Browser acceptance: open a disposable browser surface, view its screenshot, zoom/pan locally,
refresh after a Mac-side change, switch surfaces, close the original panel, background/resume,
disconnect, and expire auth. Verify no remote input/navigation/viewport mutation occurred.

Native acceptance: open disposable saved Markdown and image panels, retrieve the exact associated
content, enforce limits, reject unrelated resources, and fail closed after removal/reassignment.
Do not mark the full requested viewing scope complete while this gate remains blocked.

Run `devenv shell -- check` after implementation. Developed and Live dates require merge and real
Mac/iPhone PWA evidence respectively; this design supplies neither.
