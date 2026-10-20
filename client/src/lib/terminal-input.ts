import type { AllowedKey } from "./cmux-rpc";

export type TerminalInput = { kind: "text"; text: string } | { kind: "key"; key: AllowedKey };
export type SubmitResult = "accepted" | "text_unconfirmed" | "enter_unconfirmed";
export function createTerminalInputDispatcher(deps: {
  sendText(surfaceId: string, text: string): Promise<void>;
  sendKey(surfaceId: string, key: AllowedKey): Promise<void>;
  isCurrent(surfaceId: string, connectionGeneration: number): boolean;
}) {
  let tail = Promise.resolve();
  let queued = 0;
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (queued >= 64) return Promise.reject(new Error("input_queue_full"));
    queued++;
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined).finally(() => { queued--; });
    return result;
  }
  function ensureCurrent(surfaceId: string, generation: number) {
    if (!deps.isCurrent(surfaceId, generation)) throw new Error("input_target_changed");
  }
  return {
    send(surfaceId: string, generation: number, input: TerminalInput): Promise<void> {
      return enqueue(async () => {
        ensureCurrent(surfaceId, generation);
        if (input.kind === "key") await deps.sendKey(surfaceId, input.key);
        else await deps.sendText(surfaceId, input.text);
      });
    },
    async submit(surfaceId: string, generation: number, text: string): Promise<SubmitResult> {
      let stage: SubmitResult = text.length ? "text_unconfirmed" : "enter_unconfirmed";
      try {
        return await enqueue(async () => {
          ensureCurrent(surfaceId, generation);
          if (text.length) await deps.sendText(surfaceId, text);
          stage = "enter_unconfirmed";
          ensureCurrent(surfaceId, generation);
          await deps.sendKey(surfaceId, "enter");
          return "accepted" as const;
        });
      } catch { return stage; }
    },
  };
}
export function submissionError(result: SubmitResult, text: string): string | null {
  if (result === "accepted") return null;
  if (result === "text_unconfirmed") return "Text was not confirmed. Check the terminal before trying again.";
  return text.length ? "Text was sent, but Enter was not confirmed. Check the terminal before trying again." : "Enter was not confirmed. Check the terminal before trying again.";
}
