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
    bun install --cwd client
    bun install --cwd server
  '';

  scripts.test-all.exec = ''
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
    test-all
    typecheck
    build-all
  '';

  enterShell = ''
    echo "cmux-remote development environment"
    echo "Bun:  $(bun --version)"
    echo "Node: $(node --version)"
    echo "Commands: deps, test-all, typecheck, build-all, check, devenv up"
  '';

  enterTest = ''
    check
  '';
}
