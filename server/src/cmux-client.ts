import { JsonLineConnection } from "./cmux-connection";
import { resolveSocketPath } from "./config";

export interface CmuxClientOptions {
  socketPath: string;
  socketPassword?: string | null;
  requestTimeoutMs?: number;
  maxPending?: number;
  onStateChange?: (connected: boolean) => void;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ResponseEnvelope {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: unknown;
}

export class CmuxRequestError extends Error {
  constructor(readonly code: string, message = code) {
    super(`${code}: ${message}`);
    this.name = "CmuxRequestError";
  }
}

function responseEnvelope(value: unknown): ResponseEnvelope | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const frame = value as Record<string, unknown>;
  if (typeof frame.id !== "string" || typeof frame.ok !== "boolean") return null;
  return {
    id: frame.id,
    ok: frame.ok,
    result: frame.result,
    error: frame.error,
  };
}

function cmuxError(value: unknown): CmuxRequestError {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return new CmuxRequestError("cmux_error", "cmux request failed");
  }
  const error = value as Record<string, unknown>;
  const code =
    typeof error.code === "string" && /^[a-z0-9_.-]{1,64}$/i.test(error.code)
      ? error.code
      : "cmux_error";
  const message =
    typeof error.message === "string"
      ? error.message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 256)
      : "cmux request failed";
  return new CmuxRequestError(code, message);
}

export class CmuxClient {
  readonly #options: Required<
    Pick<CmuxClientOptions, "socketPath" | "requestTimeoutMs" | "maxPending">
  > &
    Omit<CmuxClientOptions, "socketPath" | "requestTimeoutMs" | "maxPending">;
  readonly #pending = new Map<string, PendingRequest>();
  #connection: JsonLineConnection | null = null;
  #connectPromise: Promise<void> | null = null;
  #connected = false;
  #generation = 0;

  constructor(options?: CmuxClientOptions) {
    this.#options = {
      socketPath: options?.socketPath ?? resolveSocketPath(process.env),
      socketPassword: options?.socketPassword ?? null,
      requestTimeoutMs: options?.requestTimeoutMs ?? 10_000,
      maxPending: options?.maxPending ?? 64,
      onStateChange: options?.onStateChange,
    };
  }

  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    if (this.#connectPromise) return this.#connectPromise;

    const generation = this.#generation;
    this.#connectPromise = this.#open(generation).finally(() => {
      this.#connectPromise = null;
    });
    return this.#connectPromise;
  }

  async request<T = unknown>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    await this.connect();
    return (await this.#sendRequest(method, params)) as T;
  }

  disconnect(): void {
    this.#generation += 1;
    this.#dropConnection(new CmuxRequestError("cmux_disconnected"));
  }

  get isConnected(): boolean {
    return this.#connected && this.#connection?.isOpen === true;
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.connect();
      return true;
    } catch {
      return false;
    } finally {
      this.disconnect();
    }
  }

  async #open(generation: number): Promise<void> {
    let connection: JsonLineConnection;
    try {
      connection = await JsonLineConnection.connect({
        socketPath: this.#options.socketPath,
      });
    } catch (error) {
      throw error instanceof Error
        ? error
        : new CmuxRequestError("cmux_disconnected");
    }

    if (generation !== this.#generation) {
      connection.close();
      throw new CmuxRequestError("cmux_disconnected");
    }

    this.#connection = connection;
    void this.#readFrames(connection);

    try {
      if (this.#options.socketPassword) {
        const result = await this.#sendRequest("auth.login", {
          password: this.#options.socketPassword,
        });
        if (
          typeof result !== "object" ||
          result === null ||
          !("authenticated" in result) ||
          result.authenticated !== true
        ) {
          throw new CmuxRequestError("cmux_auth_failed");
        }
      }
      if (generation !== this.#generation) {
        throw new CmuxRequestError("cmux_disconnected");
      }
      this.#connected = true;
      this.#options.onStateChange?.(true);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error
          : new CmuxRequestError("cmux_disconnected");
      this.#dropConnection(reason, connection);
      throw reason;
    }
  }

  #sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const connection = this.#connection;
    if (!connection?.isOpen) {
      return Promise.reject(new CmuxRequestError("cmux_disconnected"));
    }
    if (this.#pending.size >= this.#options.maxPending) {
      return Promise.reject(new CmuxRequestError("cmux_busy"));
    }

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CmuxRequestError("cmux_timeout"));
      }, this.#options.requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });

      try {
        connection.write({ id, method, params });
      } catch {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(new CmuxRequestError("cmux_disconnected"));
      }
    });
  }

  async #readFrames(connection: JsonLineConnection): Promise<void> {
    try {
      while (this.#connection === connection) {
        const frame = responseEnvelope(await connection.read());
        if (!frame) continue;
        const pending = this.#pending.get(frame.id);
        if (!pending) continue;

        clearTimeout(pending.timeout);
        this.#pending.delete(frame.id);
        if (frame.ok) pending.resolve(frame.result);
        else pending.reject(cmuxError(frame.error));
      }
    } catch (error) {
      this.#dropConnection(
        error instanceof Error
          ? error
          : new CmuxRequestError("cmux_disconnected"),
        connection,
      );
    }
  }

  #dropConnection(error: Error, expected?: JsonLineConnection): void {
    if (expected && this.#connection !== expected) return;
    const wasConnected = this.#connected;
    const connection = this.#connection;
    this.#connection = null;
    this.#connected = false;
    connection?.close(error);

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
    if (wasConnected) this.#options.onStateChange?.(false);
  }
}
