import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyServeStatus,
  createEnvFile,
  DEFAULT_CAPABILITY,
  parseTailscaleStatus,
  renderGrant,
  runSetup,
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

const exactServeStatus = JSON.stringify({
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
});

async function temporaryRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "cmux-remote-setup-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function setupDependencies(
  root: string,
  options: {
    answers?: string[];
    env?: Record<string, string>;
    phoneStatus?: string;
    serveStatus?: string;
    buildExitCode?: number;
    copyError?: Error;
  } = {},
) {
  const answers = [...(options.answers ?? ["yes", "", "yes"])];
  const commands: string[][] = [];
  const commandOptions: Array<Record<string, unknown>> = [];
  const copied: string[] = [];
  const logs: string[] = [];
  const run = async (args: string[], command: Record<string, unknown> = {}) => {
    commands.push(args);
    commandOptions.push(command);
    if (args.join(" ") === "tailscale status --json") {
      return { exitCode: 0, stdout: options.phoneStatus ?? status };
    }
    if (args.join(" ") === "tailscale serve status --json") {
      return { exitCode: 0, stdout: options.serveStatus ?? "{}" };
    }
    if (args.join(" ") === "bun run --cwd client build") {
      return { exitCode: options.buildExitCode ?? 0, stdout: "" };
    }
    return { exitCode: 0, stdout: "" };
  };

  return {
    commands,
    commandOptions,
    copied,
    logs,
    dependencies: {
      ask: async () => answers.shift() ?? "",
      close: () => {},
      copy: async (value: string) => {
        if (options.copyError) throw options.copyError;
        copied.push(value);
      },
      env: options.env ?? {},
      log: (message: string) => logs.push(message),
      platform: "darwin",
      randomBytes: () => Buffer.alloc(32, 0xaa),
      root,
      run,
    },
  };
}

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
});

describe("first-run setup orchestration", () => {
  it("creates a private env file without replacing its secret", async () => {
    await temporaryRoot(async (root) => {
      const path = join(root, ".env");
      await createEnvFile(path, {
        capability: DEFAULT_CAPABILITY,
        origin: "https://cmux.tail1234.ts.net",
        secret: "a".repeat(64),
      });

      expect(await readFile(path, "utf8")).toBe(
        [
          `CMUX_REMOTE_TOKEN=${"a".repeat(64)}`,
          "CMUX_REMOTE_ORIGIN=https://cmux.tail1234.ts.net",
          `CMUX_REMOTE_TAILSCALE_CAPABILITY=${DEFAULT_CAPABILITY}`,
          "",
        ].join("\n"),
      );
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      await expect(
        createEnvFile(path, {
          capability: DEFAULT_CAPABILITY,
          origin: "https://cmux.tail1234.ts.net",
          secret: "b".repeat(64),
        }),
      ).rejects.toThrow();
      expect(await readFile(path, "utf8")).toContain("a".repeat(64));
    });
  });

  it("runs the safe first-run sequence without displaying its secret", async () => {
    await temporaryRoot(async (root) => {
      const setup = setupDependencies(root);

      expect(await runSetup(setup.dependencies)).toBe(0);
      expect(setup.commands).toEqual([
        ["tailscale", "status", "--json"],
        ["bun", "run", "--cwd", "client", "build"],
        ["tailscale", "serve", "status", "--json"],
        [
          "tailscale",
          "serve",
          "--bg",
          "--yes",
          `--accept-app-caps=${DEFAULT_CAPABILITY}`,
          "http://127.0.0.1:3456",
        ],
        ["bun", "run", "--cwd", "server", "start"],
      ]);
      expect(setup.copied).toHaveLength(1);
      expect(setup.copied[0]).toContain('"src": [\n    "100.64.0.2"');
      expect(setup.logs.join("\n")).not.toContain("aa".repeat(32));
      expect(setup.commandOptions.at(-1)?.env).toMatchObject({
        CMUX_REMOTE_ORIGIN: "https://cmux.tail1234.ts.net",
        CMUX_REMOTE_TAILSCALE_CAPABILITY: DEFAULT_CAPABILITY,
        CMUX_REMOTE_TOKEN: "aa".repeat(32),
      });
    });
  });

  it("reuses an exact Serve handler without configuring it", async () => {
    await temporaryRoot(async (root) => {
      const setup = setupDependencies(root, { serveStatus: exactServeStatus });

      await runSetup(setup.dependencies);

      expect(setup.commands).not.toContainEqual(
        expect.arrayContaining(["tailscale", "serve", "--bg"]),
      );
      expect(setup.commands.at(-1)).toEqual([
        "bun",
        "run",
        "--cwd",
        "server",
        "start",
      ]);
    });
  });

  it("stops before start when Serve conflicts", async () => {
    await temporaryRoot(async (root) => {
      const setup = setupDependencies(root, {
        serveStatus: JSON.stringify({
          Web: {
            "cmux.tail1234.ts.net:443": {
              Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } },
            },
          },
        }),
      });

      await expect(runSetup(setup.dependencies)).rejects.toThrow(
        "existing Tailscale Serve configuration",
      );
      expect(setup.commands).not.toContainEqual([
        "bun",
        "run",
        "--cwd",
        "server",
        "start",
      ]);
    });
  });

  it("stops before local changes when no iPhone peer is available", async () => {
    await temporaryRoot(async (root) => {
      const setup = setupDependencies(root, {
        phoneStatus: JSON.stringify({
          BackendState: "Running",
          Self: {
            DNSName: "cmux.tail1234.ts.net.",
            TailscaleIPs: ["100.64.0.1"],
          },
          Peer: null,
        }),
      });

      await expect(runSetup(setup.dependencies)).rejects.toThrow("No iPhone");
      expect(setup.commands).toEqual([["tailscale", "status", "--json"]]);
    });
  });

  it("rejects an out-of-range choice when multiple iPhones are found", async () => {
    await temporaryRoot(async (root) => {
      const multiple = JSON.parse(status);
      multiple.Peer.phone2 = {
        DNSName: "second.tail1234.ts.net.",
        HostName: "Second iPhone",
        OS: "iOS",
        Online: false,
        TailscaleIPs: ["100.64.0.4"],
      };
      const setup = setupDependencies(root, {
        answers: ["3"],
        phoneStatus: JSON.stringify(multiple),
      });

      await expect(runSetup(setup.dependencies)).rejects.toThrow(
        "Invalid iPhone selection",
      );
      expect(setup.commands).toEqual([["tailscale", "status", "--json"]]);
    });
  });

  it("stops when the only iPhone is not confirmed", async () => {
    await temporaryRoot(async (root) => {
      const setup = setupDependencies(root, { answers: ["no"] });

      await expect(runSetup(setup.dependencies)).rejects.toThrow(
        "iPhone selection cancelled",
      );
      expect(setup.commands).toEqual([["tailscale", "status", "--json"]]);
    });
  });

  it("does not inspect or mutate Serve after a failed build", async () => {
    await temporaryRoot(async (root) => {
      const setup = setupDependencies(root, { buildExitCode: 1 });

      await expect(runSetup(setup.dependencies)).rejects.toThrow(
        "client build failed",
      );
      expect(setup.commands).toEqual([
        ["tailscale", "status", "--json"],
        ["bun", "run", "--cwd", "client", "build"],
      ]);
    });
  });

  it("reuses a valid existing pairing env without changing the file", async () => {
    await temporaryRoot(async (root) => {
      const existing = "preserve this file exactly\n";
      await writeFile(join(root, ".env"), existing);
      const setup = setupDependencies(root, {
        answers: ["yes", "yes"],
        env: {
          CMUX_REMOTE_ORIGIN: "https://cmux.tail1234.ts.net",
          CMUX_REMOTE_TAILSCALE_CAPABILITY: DEFAULT_CAPABILITY,
          CMUX_REMOTE_TOKEN: "z".repeat(32),
        },
      });

      await runSetup(setup.dependencies);

      expect(await readFile(join(root, ".env"), "utf8")).toBe(existing);
      expect(setup.commandOptions.at(-1)?.env).toMatchObject({
        CMUX_REMOTE_TOKEN: "z".repeat(32),
      });
    });
  });

  it("rejects an existing env that is not valid pairing configuration", async () => {
    await temporaryRoot(async (root) => {
      await writeFile(join(root, ".env"), "do not replace\n");
      const setup = setupDependencies(root, {
        answers: ["yes"],
        env: { CMUX_REMOTE_TOKEN: "z".repeat(32) },
      });

      await expect(runSetup(setup.dependencies)).rejects.toThrow(
        "Existing .env is not a valid Tailscale pairing configuration",
      );
      expect(await readFile(join(root, ".env"), "utf8")).toBe(
        "do not replace\n",
      );
      expect(setup.commands).toEqual([["tailscale", "status", "--json"]]);
    });
  });

  it("prints the grant and continues when clipboard access fails", async () => {
    await temporaryRoot(async (root) => {
      const setup = setupDependencies(root, {
        copyError: new Error("pbcopy unavailable"),
      });

      await runSetup(setup.dependencies);

      expect(setup.logs.join("\n")).toContain("Clipboard unavailable");
      expect(setup.logs.join("\n")).toContain('"tcp:443"');
      expect(setup.commands.at(-1)).toEqual([
        "bun",
        "run",
        "--cwd",
        "server",
        "start",
      ]);
    });
  });
});
