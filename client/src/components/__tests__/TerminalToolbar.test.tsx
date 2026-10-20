// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalToolbar } from "../TerminalToolbar";
import { useTerminalPreferences } from "../../hooks/useTerminalPreferences";

afterEach(() => { cleanup(); localStorage.clear(); });
function Toolbar({ connected = true, ...props }: Pick<Parameters<typeof TerminalToolbar>[0], "onKey" | "onSubmit"> & {
  connected?: boolean; connectionGeneration?: number; onUpload?(file: File, signal: AbortSignal): Promise<string>;
  agentSource?: string | null;
}) {
  return <TerminalToolbar {...props} connected={connected} settings={useTerminalPreferences()} />;
}

it("offers three local draft rows, keeps Shift+Return local and submits the whole multiline prompt once", async () => {
  const onSubmit = vi.fn().mockResolvedValue("accepted");
  render(<Toolbar onKey={vi.fn()} onSubmit={onSubmit} />);
  const input = screen.getByRole("textbox", { name: "Prompt or command" });
  expect(input.tagName).toBe("TEXTAREA");
  expect(input.getAttribute("rows")).toBe("3");
  fireEvent.change(input, { target: { value: "First line\nSecond line\nThird line" } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith("First line\nSecond line\nThird line"));
});

it("enables the keyboard's native correction and spelling suggestions for the prompt", () => {
  render(<Toolbar onKey={vi.fn()} onSubmit={vi.fn()} />);
  const input = screen.getByRole("textbox", { name: "Prompt or command" });
  expect(input.getAttribute("autocorrect")).toBe("on");
  expect(input.getAttribute("spellcheck")).toBe("true");
});

it.each([
  ["codex", ["Shift+←", "Enter", "Esc"], ["shift+left", "enter", "escape"]],
  ["claude_code", ["↑", "↓", "Enter", "Esc"], ["up", "down", "enter", "escape"]],
] as const)("keeps %s question keys in their own fixed group without duplicate favorites", (agentSource, labels, keys) => {
  const onKey = vi.fn();
  render(<Toolbar agentSource={agentSource} onKey={onKey} onSubmit={vi.fn()} />);
  const group = screen.getByRole("group", { name: "Question controls" });
  expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(labels);
  for (const label of labels) {
    const buttons = screen.getAllByRole("button", { name: label });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
  }
  expect(onKey.mock.calls.map(([key]) => key)).toEqual(keys);
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  expect(screen.getByRole("button", { name: `Always visible ${labels[0]}` }).hasAttribute("disabled")).toBe(true);
});

it("keeps the saved favorites for unknown agents and disables contextual invocation offline", () => {
  const onKey = vi.fn();
  const { rerender } = render(<Toolbar agentSource="unknown_agent" onKey={onKey} onSubmit={vi.fn()} />);
  expect(screen.queryByRole("group", { name: "Question controls" })).toBeNull();
  expect(screen.getByRole("button", { name: "Shift+←" })).toBeTruthy();
  rerender(<Toolbar agentSource="codex" connected={false} onKey={onKey} onSubmit={vi.fn()} />);
  const group = screen.getByRole("group", { name: "Question controls" });
  for (const button of within(group).getAllByRole("button")) {
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
  }
  expect(onKey).not.toHaveBeenCalled();
});

it("offers compact attachment and send icons with accessible action names", async () => {
  const onSubmit = vi.fn().mockResolvedValue("accepted");
  render(<Toolbar onKey={vi.fn()} onSubmit={onSubmit} onUpload={vi.fn()} />);
  for (const name of ["Attach files or images", "Send"]) {
    const button = screen.getByRole("button", { name });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
  }
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt or command" }), { target: { value: "continue" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith("continue"));
});

it("maps every named key to the exact cmux key", () => {
  const onKey = vi.fn();
  render(<Toolbar onKey={onKey} onSubmit={vi.fn()} />);

  for (const name of ["Esc", "Tab", "←", "→", "↑", "↓", "Shift+←", "Enter"]) {
    fireEvent.click(screen.getByRole("button", { name }));
  }
  expect(onKey.mock.calls.map(([key]) => key)).toEqual([
    "escape",
    "tab",
    "left",
    "right",
    "up",
    "down",
    "shift+left",
    "enter",
  ]);
});

it("offers Ctrl-C and Ctrl-D through the shortcuts catalogue", () => {
  render(<Toolbar onKey={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Ctrl" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Ctrl-C" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Ctrl-D" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  expect(screen.getByRole("dialog", { name: "Shortcuts" })).toBeTruthy();
  expect(screen.getByText("Interrupt the current process")).toBeTruthy();
  expect(screen.getByText("End input; may close a shell")).toBeTruthy();
});

it("submits a visible prompt and clears it only after accepted", async () => {
  const onSubmit = vi
    .fn()
    .mockResolvedValueOnce("text_unconfirmed")
    .mockResolvedValueOnce("accepted");
  render(<Toolbar onKey={vi.fn()} onSubmit={onSubmit} />);

  const input = screen.getByRole("textbox", { name: "Prompt or command" });
  expect(input.getAttribute("enterkeyhint")).toBe("send");
  fireEvent.change(input, { target: { value: "continue the task" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);

  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("continue the task"));
  expect((input as HTMLTextAreaElement).value).toBe("continue the task");

  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
});

it("sends empty Return once and keeps composing Return local", async () => {
  const onSubmit = vi.fn().mockResolvedValue("accepted");
  render(<Toolbar onKey={vi.fn()} onSubmit={onSubmit} />);
  const input = screen.getByRole("textbox", { name: "Prompt or command" });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith("");
});

it("shows an unconfirmed saved-command Enter inside the open shortcuts dialog", async () => {
  const onSubmit = vi.fn().mockResolvedValue("enter_unconfirmed");
  render(<Toolbar onKey={vi.fn()} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Shortcut name" }), { target: { value: "Launch" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Command" }), { target: { value: "launcher" } });
  fireEvent.click(screen.getByRole("button", { name: "Save command" }));
  fireEvent.click(screen.getByRole("button", { name: "Launch" }));
  await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Shortcuts" })).getByRole("alert").textContent).toMatch(/Enter was not confirmed/));
  expect(onSubmit).toHaveBeenCalledOnce();
});

it("attaches files sequentially, preserves typing and quotes paths without submitting", async () => {
  let finish!: (path: string) => void;
  const onUpload = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce("/tmp/photo.png");
  const onSubmit = vi.fn().mockResolvedValue("accepted");
  render(<Toolbar onKey={vi.fn()} onSubmit={onSubmit} onUpload={onUpload} />);
  const input = screen.getByRole("textbox", { name: "Prompt or command" });
  fireEvent.change(input, { target: { value: "Inspect" } });
  fireEvent.change(screen.getByLabelText("Files and images"), { target: {
    files: [new File(["document"], "notes.txt"), new File(["image"], "photo.png", { type: "image/png" })],
  } });
  await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
  expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: "Inspect both" } });
  finish("/tmp/it's notes.txt");
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("Inspect both '/tmp/it'\\''s notes.txt' '/tmp/photo.png'"));
  expect(onUpload).toHaveBeenCalledTimes(2);
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Inspect both '/tmp/it'\\''s notes.txt' '/tmp/photo.png'"));
});

it("retains the prompt on failed or oversized uploads and allows choosing the same file again", async () => {
  const onUpload = vi.fn().mockRejectedValueOnce(new Error("Upload failed.")).mockResolvedValue("/tmp/notes.txt");
  render(<Toolbar onKey={vi.fn()} onSubmit={vi.fn()} onUpload={onUpload} />);
  const input = screen.getByRole("textbox", { name: "Prompt or command" });
  const picker = screen.getByLabelText("Files and images");
  fireEvent.change(input, { target: { value: "Keep this" } });
  const file = new File(["notes"], "notes.txt");
  fireEvent.change(picker, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Upload failed/));
  expect((input as HTMLTextAreaElement).value).toBe("Keep this");
  const tooBig = new File(["x"], "large.bin");
  Object.defineProperty(tooBig, "size", { value: 10 * 1024 * 1024 + 1 });
  fireEvent.change(picker, { target: { files: [tooBig] } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/10 MiB/));
  expect(onUpload).toHaveBeenCalledTimes(1);
  fireEvent.change(picker, { target: { files: Array(5).fill(file) } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/four files/));
  expect(onUpload).toHaveBeenCalledTimes(1);
  fireEvent.change(picker, { target: { files: [file] } });
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("Keep this '/tmp/notes.txt'"));
});

it("aborts on reconnect or departure and ignores late upload responses", async () => {
  let finish!: (path: string) => void;
  const onUpload = vi.fn((_file: File, _signal: AbortSignal) => new Promise<string>((resolve) => { finish = resolve; }));
  const props = { onKey: vi.fn(), onSubmit: vi.fn(), onUpload, connectionGeneration: 1 };
  const { rerender, unmount } = render(<Toolbar {...props} />);
  const input = screen.getByRole("textbox", { name: "Prompt or command" });
  fireEvent.change(input, { target: { value: "Keep" } });
  fireEvent.change(screen.getByLabelText("Files and images"), { target: { files: [new File(["x"], "x.txt")] } });
  await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
  const signal = onUpload.mock.calls[0]?.[1];
  rerender(<Toolbar {...props} connectionGeneration={2} />);
  expect(signal?.aborted).toBe(true);
  finish("/tmp/late.txt");
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("Keep"));
  fireEvent.change(screen.getByLabelText("Files and images"), { target: { files: [new File(["x"], "x.txt")] } });
  await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
  unmount();
  expect(onUpload.mock.calls[1]?.[1].aborted).toBe(true);
});
