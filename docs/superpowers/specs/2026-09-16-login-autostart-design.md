# Login startup and bounded process retries

**Created:** 2026-09-16

cmux-remote runs as a per-user macOS LaunchAgent after login, when cmux and Tailscale can run in the same user session. Installation uses the existing repository and devenv paths; it does not change Tailscale Serve or tailnet policy. The bridge remains bound to its configured loopback address and reads secrets from the ignored `.env`.

The agent starts once at login. A small supervisor retries an unexpectedly failed bridge process three times, after 2, 4, and 8 seconds, then stops until a manual restart or the next login. A clean exit or service stop does not retry. The agent discards stdout and stderr because startup output can contain a pairing code. The existing cmux socket reconnect loop handles sleep and wake without restarting a healthy bridge.

Installation must reject an existing agent rather than overwrite it. The user can inspect status, restart, and disable the agent with `launchctl`. Existing Serve routes and configuration files are never overwritten by the installer.

The `devenv shell -- pair` command temporarily stops the agent, starts the bridge in the foreground to show its short-lived code, and restores the agent on exit. It does not rotate the session-signing secret or add a second device registry; the existing paired cookie and Tailscale capability continue to recognize the authorized iPhone after restarts.
