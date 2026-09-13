export const TAILSCALE_CAPABILITIES_HEADER = "Tailscale-App-Capabilities";

const CAPABILITIES_HEADER_LIMIT = 4_096;

export function hasTailscaleCapability(
  request: Request,
  capability: string | null,
): boolean {
  if (capability === null) return true;

  const raw = request.headers.get(TAILSCALE_CAPABILITIES_HEADER);
  if (
    raw === null ||
    new TextEncoder().encode(raw).length > CAPABILITIES_HEADER_LIMIT
  ) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return false;
  }

  const grant = (parsed as Record<string, unknown>)[capability];
  return (
    Array.isArray(grant) &&
    grant.length > 0 &&
    grant.every(
      (entry) =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry),
    )
  );
}
