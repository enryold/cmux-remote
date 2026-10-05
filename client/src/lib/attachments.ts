export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function validateAttachment(file: File): void {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("Each file must be 10 MiB or smaller.");
  if (!file.name || new TextEncoder().encode(file.name).length > 180 || /[/\\\p{C}]/u.test(file.name)) {
    throw new Error("Use a shorter filename without slashes or control characters.");
  }
}

export async function uploadAttachment(surfaceId: string, file: File, signal: AbortSignal, onUnauthorized: () => void): Promise<string> {
  validateAttachment(file);
  const response = await fetch(`/api/surfaces/${encodeURIComponent(surfaceId)}/attachments`, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) }, body: file,
  });
  if (signal.aborted) { await response.body?.cancel(); throw new Error("Upload interrupted. Your prompt was kept."); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) { onUnauthorized(); throw new Error("Your session expired. Pair again to upload."); }
    const errors: Record<number, string> = {
      404: "This terminal is no longer available.",
      413: "Each file must be 10 MiB or smaller.",
      422: "Uploads are unavailable on this Mac. Check the filename and update cmux.",
      429: "Another upload is in progress. Try again when it finishes.",
      504: "Upload timed out. Choose the file again to retry.",
    };
    throw new Error(errors[response.status] ?? "Upload failed. Your prompt was kept; choose the file again to retry.");
  }
  const result = await response.json();
  if (signal.aborted || !result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).length !== 2
    || result.surfaceId !== surfaceId || typeof result.path !== "string" || !result.path.startsWith("/")
    || new TextEncoder().encode(result.path).length > 1024 || /[\p{C}]/u.test(result.path)) {
    throw new Error("Upload could not be confirmed. Your prompt was kept.");
  }
  return result.path;
}
