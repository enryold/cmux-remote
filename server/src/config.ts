import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomInt } from "node:crypto";

export interface RuntimeConfig {
  hostname: string;
  port: number;
  remoteToken: string;
  publicOrigin: string | null;
  tailscaleCapability: string | null;
  pairingCode: string | null;
  socketPath: string;
  socketPassword: string | null;
}

export function loadConfig(
  env: Record<string, string | undefined>,
): RuntimeConfig {
  const remoteToken = env.CMUX_REMOTE_TOKEN ?? "";
  if (new TextEncoder().encode(remoteToken).length < 32) {
    throw new Error("CMUX_REMOTE_TOKEN must contain at least 32 UTF-8 bytes");
  }

  const port = Number(env.PORT ?? "3456");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }

  const hostname = env.HOST || "127.0.0.1";
  const publicOrigin = parseExactOrigin(env.CMUX_REMOTE_ORIGIN);
  const tailscaleCapability = env.CMUX_REMOTE_TAILSCALE_CAPABILITY || null;
  const configuredPairingCode = env.CMUX_REMOTE_PAIRING_CODE;

  if (configuredPairingCode && !tailscaleCapability) {
    throw new Error("CMUX_REMOTE_PAIRING_CODE requires pairing mode");
  }

  let pairingCode: string | null = null;
  if (tailscaleCapability) {
    if (!isCapabilityName(tailscaleCapability)) {
      throw new Error(
        "CMUX_REMOTE_TAILSCALE_CAPABILITY must use the domain/path format",
      );
    }
    if (hostname !== "127.0.0.1") {
      throw new Error("Tailscale pairing requires HOST=127.0.0.1");
    }
    if (!publicOrigin || new URL(publicOrigin).protocol !== "https:") {
      throw new Error("Tailscale pairing requires an HTTPS CMUX_REMOTE_ORIGIN");
    }
    if (configuredPairingCode && !/^\d{6}$/.test(configuredPairingCode)) {
      throw new Error("CMUX_REMOTE_PAIRING_CODE must contain exactly six digits");
    }
    pairingCode =
      configuredPairingCode ?? randomInt(1_000_000).toString().padStart(6, "0");
  }

  return {
    hostname,
    port,
    remoteToken,
    publicOrigin,
    tailscaleCapability,
    pairingCode,
    socketPath: resolveSocketPath(env),
    socketPassword: env.CMUX_SOCKET_PASSWORD || null,
  };
}

export function isCapabilityName(value: string): boolean {
  return (
    value.length <= 255 &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}\/[A-Za-z0-9][A-Za-z0-9/-]*$/.test(
      value,
    )
  );
}

function parseExactOrigin(value: string | undefined): string | null {
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CMUX_REMOTE_ORIGIN must be an exact HTTP(S) origin");
  }

  if (
    url.origin !== value ||
    (url.protocol !== "http:" && url.protocol !== "https:")
  ) {
    throw new Error("CMUX_REMOTE_ORIGIN must be an exact HTTP(S) origin");
  }
  return value;
}

export function resolveSocketPath(
  env: Record<string, string | undefined>,
): string {
  const configured = env.CMUX_SOCKET_PATH || env.CMUX_SOCKET;
  if (configured) return configured;

  const userHome = env.HOME || homedir();
  const stateDirectory = join(userHome, ".local/state/cmux");
  const currentSocketPath = join(stateDirectory, "cmux.sock");
  const pointerPath = join(stateDirectory, "last-socket-path");

  if (existsSync(pointerPath)) {
    const pointedSocket = readFileSync(pointerPath, "utf8").trim();
    if (pointedSocket && existsSync(pointedSocket)) return pointedSocket;
  }

  if (existsSync(currentSocketPath)) return currentSocketPath;

  const legacySocketPath = join(
    userHome,
    "Library/Application Support/cmux/cmux.sock",
  );
  return existsSync(legacySocketPath) ? legacySocketPath : currentSocketPath;
}
