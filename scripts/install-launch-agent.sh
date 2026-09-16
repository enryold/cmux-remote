#!/bin/sh

set -eu

root=$(CDPATH= cd "$(dirname "$0")/.." && pwd -P)
agent="$HOME/Library/LaunchAgents/dev.cmux-remote.bridge.plist"
label=dev.cmux-remote.bridge
devenv_path=$(command -v devenv)

[ -f "$root/.env" ] || { echo "Missing $root/.env" >&2; exit 1; }
[ -f "$root/client/dist/index.html" ] || { echo "Build the PWA first: devenv shell -- build-all" >&2; exit 1; }
[ ! -e "$agent" ] || { echo "LaunchAgent already exists: $agent" >&2; exit 1; }
if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  echo "LaunchAgent is already loaded: $label" >&2
  exit 1
fi

umask 077
mkdir -p "$(dirname "$agent")"
temporary=$(mktemp "$agent.XXXXXX")
trap 'rm -f "$temporary"' 0
plutil -create xml1 -o "$temporary" "$temporary"
plutil -insert Label -string "$label" "$temporary"
plutil -insert ProgramArguments -array "$temporary"
plutil -insert ProgramArguments.0 -string /bin/sh "$temporary"
plutil -insert ProgramArguments.1 -string "$root/scripts/launchd-run.sh" "$temporary"
plutil -insert ProgramArguments.2 -string "$devenv_path" "$temporary"
plutil -insert ProgramArguments.3 -string shell "$temporary"
plutil -insert ProgramArguments.4 -json '"--"' "$temporary"
plutil -insert ProgramArguments.5 -string start "$temporary"
plutil -insert WorkingDirectory -string "$root" "$temporary"
plutil -insert RunAtLoad -bool true "$temporary"
plutil -insert StandardOutPath -string /dev/null "$temporary"
plutil -insert StandardErrorPath -string /dev/null "$temporary"
plutil -lint "$temporary"
mv "$temporary" "$agent"

if ! launchctl bootstrap "gui/$(id -u)" "$agent"; then
  rm "$agent"
  exit 1
fi
echo "Installed and started $label"
