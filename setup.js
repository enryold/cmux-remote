import { isCapabilityName } from "./server/src/config.ts";

export const DEFAULT_CAPABILITY = "gibb.one/cap/cmux-remote";
export const SERVE_TARGET = "http://127.0.0.1:3456";

const ipv4 = (values) =>
  Array.isArray(values)
    ? values.find(
        (value) => typeof value === "string" && /^100\./.test(value),
      )
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
      name: String(peer.HostName || peer.DNSName || "iPhone").replace(
        /\.$/,
        "",
      ),
      online: peer.Online === true,
    }));

  return {
    macIp,
    origin: `https://${dnsName.replace(/\.$/, "")}`,
    phones,
  };
}

export function renderGrant({ capability, macIp, phoneIp }) {
  if (!isCapabilityName(capability)) {
    throw new Error("Invalid capability name");
  }

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

export function classifyServeStatus(raw, expected) {
  const status = JSON.parse(raw);
  if (
    status &&
    typeof status === "object" &&
    Object.keys(status).length === 0
  ) {
    return "missing";
  }

  const host = `${new URL(expected.origin).hostname}:443`;
  const handler = status?.Web?.[host]?.Handlers?.["/"];
  return handler?.Proxy === SERVE_TARGET &&
    Array.isArray(handler.AcceptAppCaps) &&
    handler.AcceptAppCaps.length === 1 &&
    handler.AcceptAppCaps[0] === expected.capability
    ? "exact"
    : "conflict";
}
