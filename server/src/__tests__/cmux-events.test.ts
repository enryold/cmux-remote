import { describe, expect, it } from "bun:test";
import { CmuxEventStream } from "../cmux-events";
import {
  eventually,
  startFakeCmuxServer,
  type FakeCmuxServer,
} from "./fake-cmux";

interface EventServer extends FakeCmuxServer {
  sendEvent(frame: unknown): void;
  lastSubscription(): { params: Record<string, unknown> } | undefined;
}

async function startEventServer(options: { gap?: boolean } = {}) {
  const fake = await startFakeCmuxServer({
    onRequest(request, socket, server) {
      if (request.method === "auth.login") {
        server.reply(socket, request.id, { authenticated: true });
      } else if (request.method === "events.stream") {
        server.send(socket, {
          type: "ack",
          protocol: "cmux-events",
          version: 1,
          boot_id: "33333333-3333-4333-8333-333333333333",
          resume: { gap: options.gap ?? false },
        });
      }
    },
  });
  return Object.assign(fake, {
    sendEvent(frame: unknown) {
      for (const socket of fake.connections) fake.send(socket, frame);
    },
    lastSubscription() {
      return [...fake.requests]
        .reverse()
        .find((request) => request.method === "events.stream");
    },
  }) as EventServer;
}

describe("CmuxEventStream", () => {
  it("authenticates, subscribes to topology, and resumes after the last sequence", async () => {
    const fake = await startEventServer();
    const changes: Array<{ seq: number | null; gap: boolean }> = [];
    const stream = new CmuxEventStream({
      socketPath: fake.path,
      socketPassword: "socket-secret",
    });
    const unsubscribe = stream.subscribe((change) => changes.push(change));

    try {
      await stream.start();
      expect(fake.requests.map(({ method }) => method)).toEqual([
        "auth.login",
        "events.stream",
      ]);
      expect(fake.lastSubscription()?.params).toMatchObject({
        categories: ["window", "workspace", "pane", "surface"],
        include_heartbeats: true,
      });

      fake.sendEvent({
        type: "event",
        category: "surface",
        seq: 41,
        name: "surface.input_sent",
      });
      await Bun.sleep(20);
      expect(changes).toEqual([]);

      fake.sendEvent({
        type: "event",
        category: "surface",
        seq: 42,
        name: "surface.created",
      });
      await eventually(() =>
        expect(changes).toContainEqual({ seq: 42, gap: false }),
      );

      fake.disconnectAll();
      await eventually(
        () => expect(fake.lastSubscription()?.params.after_seq).toBe(42),
        1_500,
      );
    } finally {
      unsubscribe();
      stream.stop();
      await fake.close();
    }
  });

  it("signals a snapshot refresh when the ack reports a gap", async () => {
    const fake = await startEventServer({ gap: true });
    const changes: Array<{ seq: number | null; gap: boolean }> = [];
    const stream = new CmuxEventStream({ socketPath: fake.path });
    const unsubscribe = stream.subscribe((change) => changes.push(change));

    try {
      await stream.start();
      await eventually(() =>
        expect(changes).toContainEqual({ seq: null, gap: true }),
      );
    } finally {
      unsubscribe();
      stream.stop();
      await fake.close();
    }
  });
});
