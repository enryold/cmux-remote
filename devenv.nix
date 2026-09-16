{ pkgs, ... }:

{
  dotenv.enable = true;

  packages = [
    pkgs.bun
    pkgs.git
    pkgs.jq
    pkgs.nodejs_22
  ];

  processes.client.exec = "bun run --cwd client dev";
  processes.server.exec = "bun run --cwd server dev";

  scripts.deps.exec = ''
    bun install
    bun install --cwd client
    bun install --cwd server
  '';

  scripts.lint.exec = "bun run lint";

  scripts.setup.exec = "bun setup.js";

  scripts.start.exec = ''
    build-all
    bun run --cwd server start
  '';

  scripts.service-start.exec = ''
    service="gui/$(id -u)/dev.cmux-remote.bridge"
    if launchctl print "$service" >/dev/null 2>&1; then
      launchctl kickstart "$service"
    else
      launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.cmux-remote.bridge.plist"
    fi
  '';

  scripts.service-stop.exec = ''
    launchctl bootout "gui/$(id -u)/dev.cmux-remote.bridge"
  '';

  scripts.service-restart.exec = ''
    service="gui/$(id -u)/dev.cmux-remote.bridge"
    if launchctl print "$service" >/dev/null 2>&1; then
      launchctl kickstart -k "$service"
    else
      service-start
    fi
  '';

  scripts.pair.exec = ''
    if launchctl print "gui/$(id -u)/dev.cmux-remote.bridge" >/dev/null 2>&1; then
      service-stop
    fi
    trap 'service-start' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    echo "Enter the pairing code shown below on your iPhone, then press Ctrl-C."
    start
  '';

  scripts.e2e-deps.exec = "bunx playwright install chromium webkit";

  scripts.e2e.exec = "bun run e2e";

  scripts.test-all.exec = ''
    bun test ./setup.test.ts
    bun test ./launchd.test.ts
    bun run --cwd client test
    bun --cwd server test
  '';

  scripts.typecheck.exec = ''
    bun client/node_modules/typescript/bin/tsc --noEmit -p client/tsconfig.json
    bun server/node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json
  '';

  scripts.build-all.exec = ''
    bun run --cwd client build
  '';

  scripts.check.exec = ''
    lint
    test-all
    typecheck
    build-all
    e2e
  '';

  enterShell = ''
    echo "cmux-remote development environment"
    echo "Bun:  $(bun --version)"
    echo "Node: $(node --version)"
    echo "Commands: deps, setup, start, pair, service-start, service-stop, service-restart, lint, test-all, typecheck, build-all, e2e-deps, e2e, check, devenv up"
  '';

  enterTest = ''
    check
  '';
}
