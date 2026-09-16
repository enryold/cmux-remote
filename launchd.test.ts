import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.each([
  [0, 0, "1", ""],
  [3, 0, "4", "2\n4\n8\n"],
  [4, 1, "4", "2\n4\n8\n"],
])(
  "launchd runner stops after bounded retries (fail through %i)",
  async (failThrough, exitCode, expectedCount, expectedDelays) => {
    const root = await mkdtemp(join(tmpdir(), "cmux-remote-launchd-"));
    const counter = join(root, "count");
    const delays = join(root, "delays");
    const service = join(root, "service");
    const sleep = join(root, "sleep");
    try {
      await writeFile(
        service,
        '#!/bin/sh\ncount=0\n[ -f "$COUNT_FILE" ] && read count < "$COUNT_FILE"\ncount=$((count + 1))\nprintf "%s" "$count" > "$COUNT_FILE"\n[ "$count" -gt "$FAIL_THROUGH" ]\n',
      );
      await writeFile(
        sleep,
        '#!/bin/sh\nprintf "%s\\n" "$1" >> "$SLEEP_RECORD"\n',
      );
      await chmod(service, 0o755);
      await chmod(sleep, 0o755);
      const process = Bun.spawn(
        ["/bin/sh", join(import.meta.dir, "scripts/launchd-run.sh"), service],
        {
          env: {
            ...Bun.env,
            COUNT_FILE: counter,
            FAIL_THROUGH: String(failThrough),
            SLEEP_RECORD: delays,
            PATH: `${root}:${Bun.env.PATH}`,
          },
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      expect(await process.exited).toBe(exitCode);
      expect(await readFile(counter, "utf8")).toBe(expectedCount);
      expect(await readFile(delays, "utf8").catch(() => "")).toBe(expectedDelays);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
