# Terminal file and image attachments

Approved on 2026-10-05: select files or photos from the phone, upload them to the Mac,
and add their references to the selected terminal's prompt before explicit Send.

## Scope and flow

The existing composer gains an accessible attachment button using the native file picker.
Files are transferred sequentially through a protected HTTP POST for an exact live terminal
UUID. The bridge owns upload identities and forwards bounded chunks to cmux's installed
`mobile.task.attachment.upload` contract. cmux owns storage, filename normalization, and
cleanup; cmux-remote provides no directory browser, arbitrary destination, or file reader.

Completed paths are quoted and appended to the editable composer. Upload never sends
terminal input or Enter. Interpretation of a document/image belongs to the running program;
no agent-specific parser or clipboard manipulation is added.

## Boundaries and failure behavior

- Exact Origin, authenticated session, and the configured Tailscale capability protect every POST.
- Maximum 10 MiB per file, four files per selection, one bridge upload in flight, a 120-second
  deadline, bounded request bytes and filenames, and bounded cmux frames.
- Server-generated operation/upload UUIDs and validated cmux responses prevent client-selected
  destinations. Verify the actual installed contract before adopting it.
- Surface ownership/type is checked before and after transfer. No terminal input occurs here.
- Leaving the terminal, reconnecting, or hiding the app aborts active transfers. Failures show
  actionable feedback and retain the typed prompt; no automatic retry/replay occurs.
- Uploaded files and paths never enter service-worker caches or local storage. cmux prunes its
  attachment cache after seven days during subsequent uploads. Removing a prompt reference or
  canceling a transfer does not promise deletion of an already staged file.
- Unsupported cmux versions show an explicit error; no arbitrary RPC or shell fallback.

## Verification

Focused server tests exercise authorization, byte/name limits, chunk sequencing, response paths,
ownership, concurrency, cancellation, timeout, and unsupported contracts. Client tests cover
prompt preservation, quoting, failed transfers, and interrupted uploads. Chromium and iPhone
WebKit exercise file/image selection, review-before-Send, and exact-target submission.
Run `devenv shell -- check` and inspect the final diff. Hardware iPhone acceptance stays pending
until the real photo/file picker is exercised on the target device.
