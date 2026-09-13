import { JsonLineConnection } from "./cmux-connection";
import type { CmuxClientOptions } from "./cmux-client";

export interface TopologyChange {
  seq: number | null;
  gap: boolean;
}

type EventStreamOptions = Pick<
  CmuxClientOptions,
  "socketPath" | "socketPassword"
>;

const RECONNECT_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const TOPOLOGY_EVENTS = new Set([
  "window.created",
  "window.closed",
  "workspace.created",
  "workspace.selected",
  "workspace.closed",
  "workspace.renamed",
  "workspace.reordered",
  "workspace.moved",
  "pane.created",
  "pane.closed",
  "pane.focused",
  "pane.swapped",
  "pane.broken",
  "pane.joined",
  "surface.created",
  "surface.selected",
  "surface.focused",
  "surface.closed",
  "surface.moved",
  "surface.reordered",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function authAccepted(frame: unknown, id: string): boolean {
  const response = record(frame);
  const result = record(response?.result);
  return response?.id === id && response.ok === true && result?.authenticated === true;
}

export class CmuxEventStream {
  readonly #options: EventStreamOptions;
  readonly #listeners = new Set<(change: TopologyChange) => void>();
  #connection: JsonLineConnection | null = null;
  #runPromise: Promise<void> | null = null;
  #readyPromise: Promise<void> | null = null;
  #resolveReady: (() => void) | null = null;
  #rejectReady: ((error: Error) => void) | null = null;
  #sleepTimer: ReturnType<typeof setTimeout> | null = null;
  #wakeSleep: (() => void) | null = null;
  #lastSeq: number | null = null;
  #stopped = true;

  constructor(options: EventStreamOptions) {
    this.#options = options;
  }

  start(): Promise<void> {
    if (this.#runPromise) return this.#readyPromise ?? Promise.resolve();

    this.#stopped = false;
    this.#readyPromise = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#runPromise = this.#run().finally(() => {
      this.#runPromise = null;
    });
    return this.#readyPromise;
  }

  subscribe(listener: (change: TopologyChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  stop(): void {
    this.#stopped = true;
    this.#connection?.close();
    this.#connection = null;
    if (this.#sleepTimer) clearTimeout(this.#sleepTimer);
    this.#sleepTimer = null;
    this.#wakeSleep?.();
    this.#wakeSleep = null;
  }

  async #run(): Promise<void> {
    let reconnectAttempt = 0;
    while (!this.#stopped) {
      try {
        await this.#connectAndRead(() => {
          reconnectAttempt = 0;
          this.#resolveReady?.();
          this.#resolveReady = null;
          this.#rejectReady = null;
        });
      } catch (error) {
        if (this.#stopped) return;
        if (error instanceof Error && error.message === "cmux_auth_failed") {
          this.#rejectReady?.(error);
          this.#resolveReady = null;
          this.#rejectReady = null;
          this.#stopped = true;
          return;
        }
      }

      if (this.#stopped) return;
      const delay = RECONNECT_DELAYS[
        Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)
      ] ?? 10_000;
      reconnectAttempt += 1;
      await this.#sleep(delay);
    }
  }

  async #connectAndRead(onAck: () => void): Promise<void> {
    const connection = await JsonLineConnection.connect({
      socketPath: this.#options.socketPath,
    });
    this.#connection = connection;

    try {
      if (this.#options.socketPassword) {
        const authId = crypto.randomUUID();
        connection.write({
          id: authId,
          method: "auth.login",
          params: { password: this.#options.socketPassword },
        });
        if (!authAccepted(await this.#readWithTimeout(connection), authId)) {
          throw new Error("cmux_auth_failed");
        }
      }

      const params: Record<string, unknown> = {
        categories: ["window", "workspace", "pane", "surface"],
        include_heartbeats: true,
      };
      if (this.#lastSeq !== null) params.after_seq = this.#lastSeq;
      connection.write({
        id: `cmux-remote-events-${crypto.randomUUID()}`,
        method: "events.stream",
        params,
      });

      const ack = record(await this.#readWithTimeout(connection));
      const resume = record(ack?.resume);
      if (
        ack?.type !== "ack" ||
        ack.protocol !== "cmux-events" ||
        ack.version !== 1 ||
        typeof resume?.gap !== "boolean"
      ) {
        throw new Error("invalid_event_ack");
      }
      onAck();
      if (resume.gap) this.#emit({ seq: null, gap: true });

      while (!this.#stopped && this.#connection === connection) {
        const frame = record(await connection.read());
        if (frame?.type === "heartbeat") continue;
        if (
          frame?.type !== "event" ||
          typeof frame.seq !== "number" ||
          !Number.isSafeInteger(frame.seq) ||
          frame.seq < 0 ||
          typeof frame.name !== "string"
        ) {
          throw new Error("invalid_event_frame");
        }
        if (this.#lastSeq !== null && frame.seq <= this.#lastSeq) continue;
        this.#lastSeq = frame.seq;
        if (TOPOLOGY_EVENTS.has(frame.name)) {
          this.#emit({ seq: frame.seq, gap: false });
        }
      }
    } finally {
      if (this.#connection === connection) this.#connection = null;
      connection.close();
    }
  }

  async #readWithTimeout(connection: JsonLineConnection): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        connection.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("cmux_timeout")), 10_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #emit(change: TopologyChange): void {
    for (const listener of this.#listeners) {
      try {
        listener(change);
      } catch {
        // A consumer cannot stop topology recovery for other clients.
      }
    }
  }

  #sleep(delay: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        if (this.#sleepTimer) clearTimeout(this.#sleepTimer);
        this.#sleepTimer = null;
        this.#wakeSleep = null;
        resolve();
      };
      this.#wakeSleep = finish;
      this.#sleepTimer = setTimeout(finish, delay);
    });
  }
}
