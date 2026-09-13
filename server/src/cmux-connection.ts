import { Socket } from "node:net";

export interface JsonLineOptions {
  socketPath: string;
  connectTimeoutMs?: number;
  maxLineBytes?: number;
  maxQueuedFrames?: number;
  maxBufferedBytes?: number;
}

interface QueuedFrame {
  value: unknown;
  bytes: number;
}

interface Reader {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class JsonLineConnection {
  readonly #socket: Socket;
  readonly #maxLineBytes: number;
  readonly #maxQueuedFrames: number;
  readonly #maxBufferedBytes: number;
  #buffer = Buffer.alloc(0);
  #queuedBytes = 0;
  #frames: QueuedFrame[] = [];
  #readers: Reader[] = [];
  #terminalError: Error | null = null;
  #open = false;

  private constructor(socket: Socket, options: JsonLineOptions) {
    this.#socket = socket;
    this.#maxLineBytes = options.maxLineBytes ?? 4 * 1024 * 1024;
    this.#maxQueuedFrames = options.maxQueuedFrames ?? 64;
    this.#maxBufferedBytes = options.maxBufferedBytes ?? 8 * 1024 * 1024;
  }

  static connect(options: JsonLineOptions): Promise<JsonLineConnection> {
    const socket = new Socket();
    const connection = new JsonLineConnection(socket, options);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        const error = new Error("cmux_connect_timeout");
        connection.#terminate(error);
        if (!settled) reject(error);
      }, options.connectTimeoutMs ?? 5_000);

      socket.on("data", (data) =>
        connection.#receive(Buffer.isBuffer(data) ? data : Buffer.from(data)),
      );
      socket.once("error", () => {
        const error = connection.#terminalError ?? new Error("cmux_disconnected");
        connection.#terminate(error);
        clearTimeout(timeout);
        if (!settled) reject(error);
      });
      socket.once("close", () => {
        const error = connection.#terminalError ?? new Error("cmux_disconnected");
        connection.#terminate(error);
        clearTimeout(timeout);
        if (!settled) reject(error);
      });
      socket.connect(options.socketPath, () => {
        if (connection.#terminalError) return;
        settled = true;
        clearTimeout(timeout);
        connection.#open = true;
        resolve(connection);
      });
    });
  }

  write(frame: unknown): void {
    if (!this.isOpen) throw this.#terminalError ?? new Error("cmux_disconnected");
    this.#socket.write(`${JSON.stringify(frame)}\n`);
  }

  read(): Promise<unknown> {
    if (this.#terminalError) return Promise.reject(this.#terminalError);
    const frame = this.#frames.shift();
    if (frame) {
      this.#queuedBytes -= frame.bytes;
      return Promise.resolve(frame.value);
    }
    return new Promise((resolve, reject) => {
      this.#readers.push({ resolve, reject });
    });
  }

  close(reason = new Error("cmux_disconnected")): void {
    this.#terminate(reason);
  }

  get isOpen(): boolean {
    return this.#open && !this.#terminalError && !this.#socket.destroyed;
  }

  #receive(data: Buffer): void {
    if (this.#terminalError) return;
    this.#buffer = Buffer.concat([this.#buffer, data]);
    if (this.#queuedBytes + this.#buffer.length > this.#maxBufferedBytes) {
      this.#terminate(new Error("frame_buffer_limit"));
      return;
    }

    while (!this.#terminalError) {
      const newline = this.#buffer.indexOf(0x0a);
      if (newline < 0) {
        if (this.#buffer.length > this.#maxLineBytes) {
          this.#terminate(new Error("frame_limit"));
        }
        return;
      }

      let line = this.#buffer.subarray(0, newline);
      this.#buffer = Buffer.from(this.#buffer.subarray(newline + 1));
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      if (line.length === 0) continue;
      if (line.length > this.#maxLineBytes) {
        this.#terminate(new Error("frame_limit"));
        return;
      }

      let value: unknown;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
        value = JSON.parse(text);
      } catch {
        this.#terminate(new Error("invalid_frame"));
        return;
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        this.#terminate(new Error("invalid_frame"));
        return;
      }

      const reader = this.#readers.shift();
      if (reader) {
        reader.resolve(value);
      } else {
        if (this.#frames.length >= this.#maxQueuedFrames) {
          this.#terminate(new Error("frame_queue_limit"));
          return;
        }
        this.#queuedBytes += line.length;
        this.#frames.push({ value, bytes: line.length });
      }
    }
  }

  #terminate(error: Error): void {
    if (this.#terminalError) return;
    this.#terminalError = error;
    this.#open = false;
    this.#buffer = Buffer.alloc(0);
    this.#queuedBytes = 0;
    this.#frames = [];
    for (const reader of this.#readers.splice(0)) reader.reject(error);
    this.#socket.destroy();
  }
}
