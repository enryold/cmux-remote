import { randomBytes as secureRandomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import { isIPv4 } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { isCapabilityName, loadConfig } from "./server/src/config.ts";

export const DEFAULT_CAPABILITY = "gibb.one/cap/cmux-remote";
export const SERVE_TARGET = "http://127.0.0.1:3456";

const ipv4 = (values) =>
  Array.isArray(values)
    ? values.find(
        (value) =>
          typeof value === "string" && value.startsWith("100.") && isIPv4(value),
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
  return status?.TCP?.["443"]?.HTTPS === true &&
    status?.AllowFunnel?.[host] !== true &&
    handler?.Proxy === SERVE_TARGET &&
    Array.isArray(handler.AcceptAppCaps) &&
    handler.AcceptAppCaps.length === 1 &&
    handler.AcceptAppCaps[0] === expected.capability
    ? "exact"
    : "conflict";
}

export async function createEnvFile(path, values) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(
      [
        `CMUX_REMOTE_TOKEN=${values.secret}`,
        `CMUX_REMOTE_ORIGIN=${values.origin}`,
        `CMUX_REMOTE_TAILSCALE_CAPABILITY=${values.capability}`,
        "",
      ].join("\n"),
      "utf8",
    );
  } finally {
    await file.close();
  }
}

async function runCommand(args, options = {}) {
  const child = Bun.spawn(args, {
    cwd: options.cwd,
    env: options.env,
    stdin: "inherit",
    stdout: options.capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const stdout = options.capture
    ? new Response(child.stdout).text()
    : Promise.resolve("");
  return { exitCode: await child.exited, stdout: await stdout };
}

async function copyToClipboard(value) {
  const child = Bun.spawn(["pbcopy"], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });
  child.stdin.write(value);
  child.stdin.end();
  if ((await child.exited) !== 0) {
    throw new Error("pbcopy failed");
  }
}

async function checkedRun(run, args, options, label) {
  let result;
  try {
    result = await run(args, options);
  } catch (error) {
    throw new Error(`${label} failed: ${error.message}`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode}`);
  }
  return result.stdout ?? "";
}

const confirmed = (answer) => /^(?:y|yes)$/i.test(answer.trim());

export async function runSetup(overrides = {}) {
  const readline = overrides.ask
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });
  const ask = overrides.ask ?? ((question) => readline.question(question));
  const close = overrides.close ?? (() => readline?.close());
  const copy = overrides.copy ?? copyToClipboard;
  const env = overrides.env ?? process.env;
  const log = overrides.log ?? console.log;
  const platform = overrides.platform ?? process.platform;
  const randomBytes = overrides.randomBytes ?? secureRandomBytes;
  const root = overrides.root ?? import.meta.dir;
  const run = overrides.run ?? runCommand;

  try {
    if (platform !== "darwin") {
      throw new Error("Guided setup currently requires macOS");
    }

    const tailscale = parseTailscaleStatus(
      await checkedRun(
        run,
        ["tailscale", "status", "--json"],
        { capture: true, cwd: root },
        "Tailscale status",
      ),
    );
    if (tailscale.phones.length === 0) {
      throw new Error(
        "No iPhone with a Tailscale IPv4 address was found in this tailnet",
      );
    }

    let phone;
    if (tailscale.phones.length === 1) {
      phone = tailscale.phones[0];
      log(
        `Found ${phone.name} (${phone.ip})${phone.online ? "" : " — offline"}`,
      );
      if (!confirmed(await ask("Use this iPhone? [y/N] "))) {
        throw new Error("iPhone selection cancelled");
      }
    } else {
      log("Available iPhones:");
      for (const [index, candidate] of tailscale.phones.entries()) {
        log(
          `${index + 1}. ${candidate.name} (${candidate.ip})${candidate.online ? "" : " — offline"}`,
        );
      }
      const selection = Number(
        (await ask(`Choose iPhone [1-${tailscale.phones.length}]: `)).trim(),
      );
      if (
        !Number.isInteger(selection) ||
        selection < 1 ||
        selection > tailscale.phones.length
      ) {
        throw new Error("Invalid iPhone selection");
      }
      phone = tailscale.phones[selection - 1];
    }

    const envPath = join(root, ".env");
    let capability;
    let newEnvValues;
    let serverEnv;
    if (existsSync(envPath)) {
      let config;
      try {
        config = loadConfig(env);
      } catch {
        throw new Error(
          "Existing .env is not a valid Tailscale pairing configuration; check CMUX_REMOTE_TOKEN, CMUX_REMOTE_ORIGIN, and CMUX_REMOTE_TAILSCALE_CAPABILITY",
        );
      }
      if (
        !config.tailscaleCapability ||
        config.publicOrigin !== tailscale.origin
      ) {
        throw new Error(
          "Existing .env is not a valid Tailscale pairing configuration; check CMUX_REMOTE_TOKEN, CMUX_REMOTE_ORIGIN, and CMUX_REMOTE_TAILSCALE_CAPABILITY",
        );
      }
      capability = config.tailscaleCapability;
      serverEnv = env;
      log("Reusing the existing private .env configuration.");
    } else {
      capability = (
        await ask(`Capability [${DEFAULT_CAPABILITY}]: `)
      ).trim() || DEFAULT_CAPABILITY;
      if (!isCapabilityName(capability)) {
        throw new Error("Invalid capability name");
      }
      const secret = Buffer.from(randomBytes(32)).toString("hex");
      newEnvValues = {
        capability,
        origin: tailscale.origin,
        secret,
      };
      serverEnv = {
        ...env,
        CMUX_REMOTE_TOKEN: secret,
        CMUX_REMOTE_ORIGIN: tailscale.origin,
        CMUX_REMOTE_TAILSCALE_CAPABILITY: capability,
      };
    }

    const inspectServe = async () =>
      classifyServeStatus(
        await checkedRun(
          run,
          ["tailscale", "serve", "status", "--json"],
          { capture: true, cwd: root },
          "Tailscale Serve status",
        ),
        { capability, origin: tailscale.origin },
      );

    if ((await inspectServe()) === "conflict") {
      throw new Error(
        "Refusing to continue because of the existing Tailscale Serve configuration",
      );
    }

    await checkedRun(
      run,
      ["bun", "run", "--cwd", "client", "build"],
      { cwd: root },
      "client build",
    );

    if (newEnvValues) {
      await createEnvFile(envPath, newEnvValues);
      log("Created a private .env configuration.");
    }

    const grant = renderGrant({
      capability,
      macIp: tailscale.macIp,
      phoneIp: phone.ip,
    });
    try {
      await copy(grant);
      log("Grant copied to the clipboard.");
    } catch {
      log("Clipboard unavailable; copy the grant shown below.");
    }
    log(grant);
    log("Open https://login.tailscale.com/admin/acls/file and add this grant.");
    if (!confirmed(await ask("Saved the Tailscale policy? [y/N] "))) {
      throw new Error("Tailscale policy was not confirmed");
    }

    const serveStatus = await inspectServe();
    if (serveStatus === "conflict") {
      throw new Error(
        "Tailscale Serve changed during setup; remove the grant you just added before retrying",
      );
    }
    if (serveStatus === "missing") {
      await checkedRun(
        run,
        [
          "tailscale",
          "serve",
          "--bg",
          "--yes",
          `--accept-app-caps=${capability}`,
          SERVE_TARGET,
        ],
        { cwd: root },
        "Tailscale Serve configuration",
      );
    } else {
      log("Reusing the existing Tailscale Serve configuration.");
    }

    log(`Open ${tailscale.origin} on ${phone.name}.`);
    log("Enter the six-digit pairing code printed by the server below.");
    const server = await run(
      ["bun", "run", "--cwd", "server", "start"],
      { cwd: root, env: serverEnv, foreground: true },
    );
    return server.exitCode;
  } finally {
    close();
  }
}

if (import.meta.main) {
  runSetup()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`Setup failed: ${error.message}`);
      process.exitCode = 1;
    });
}
