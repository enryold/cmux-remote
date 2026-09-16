# Login startup for cmux-remote

**Goal:** Start the bridge at macOS login and retry up to three failed process exits with backoff.
**Why planning is required:** Installing a LaunchAgent changes persistent Mac login behavior and starts a shell-capable remote bridge.
**Acceptance:** The agent uses the current user session and localhost configuration; it starts after login, retries failed exits after 2/4/8 seconds, stops on clean exit or after retry exhaustion, and remains manually restartable. Before installation, confirm no agent with the same label exists, the existing Tailscale Serve route is unchanged, and private configuration is valid. Recovery is `launchctl bootout gui/$(id -u)/dev.cmux-remote.bridge` followed by removal of the agent plist. Do not install a conflicting agent or overwrite an existing `.env`.

### Outcome 1: Launch configuration and retry behavior
- Work: Add a portable per-user installer and small process wrapper; document commands and security implications.
- Verify: Focused retry test, `plutil -lint` on generated plist, and `git diff --check`.

### Outcome 2: Activate on this Mac
- Work: Restore missing ignored `.env` only from the already configured Serve route, generate a new signing secret, install and load the agent.
- Verify: `launchctl print` shows the job, loopback listener and `/health` report the bridge running, Serve route remains the same, and no secret is logged.

### Outcome 3: Repository gate
- Work: Update the roadmap and current README; inspect final diff.
- Verify: `devenv shell -- check` and `git diff --check`.

### Outcome 4: Foreground pairing access
- Work: Add a devenv command that shows the ephemeral pairing code and restores the LaunchAgent when it exits, while preserving the signing secret and existing session design.
- Verify: Run the command, interrupt it, then confirm the agent and loopback health recover; review the README command.
