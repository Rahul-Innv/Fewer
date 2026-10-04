"use client";

import { useEffect, useRef, useState } from "react";
import { X, ArrowUp, Square, Sparkles } from "lucide-react";
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";

const SUGGESTIONS = [
  "Why did you say no to the panel?",
  "What did you protect this week?",
  "Which asks are waiting on me?",
];

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-action px-3.5 py-2 text-[14px] leading-relaxed text-action-ink">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2 text-[14px] leading-relaxed text-ink">
        <MessagePrimitive.Parts />
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="mt-1 rounded-md bg-blocked-bg px-2.5 py-1.5 text-[13px] text-blocked-fg">
            <ErrorPrimitive.Message />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  );
}

function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div className="space-y-3 pt-2">
            <p className="font-serif text-[22px] leading-tight text-ink">Ask Fewer why it decided what it did.</p>
            <p className="text-[13.5px] text-muted">
              Fewer reads the same Desk you see. It explains; it never sends anything. Only the approval card does.
            </p>
            <div className="flex flex-col items-start gap-2 pt-1">
              {SUGGESTIONS.map((s) => (
                <ThreadPrimitive.Suggestion
                  key={s}
                  prompt={s}
                  send
                  className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-left text-[13px] text-ink transition hover:border-ink"
                >
                  {s}
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </div>
        </AuiIf>
        <ThreadPrimitive.Messages>
          {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
        </ThreadPrimitive.Messages>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <p role="status" className="px-1 text-[12.5px] text-muted">
            Fewer is thinking…
          </p>
        </AuiIf>
      </ThreadPrimitive.Viewport>

      <ComposerPrimitive.Root className="m-3 flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 focus-within:border-focus">
        <ComposerPrimitive.Input
          placeholder="Ask about a decision…"
          aria-label="Message Fewer"
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] text-ink outline-none placeholder:text-muted"
        />
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send
            aria-label="Send message"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-action text-action-ink transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp aria-hidden className="size-4" />
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel
            aria-label="Stop"
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-strong bg-surface text-ink transition hover:border-ink"
          >
            <Square aria-hidden className="size-3.5 fill-current" />
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}

function ChatRuntime() {
  const [transport] = useState(() => new AssistantChatTransport({ api: "/api/chat" }));
  const runtime = useChatRuntime({ transport });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}

/** Right-side "Ask Fewer" drawer: assistant-ui Thread wired to POST /api/chat (Mastra agent). */
export function ChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [everOpened, setEverOpened] = useState(open);
  const panelRef = useRef<HTMLElement>(null);
  // Mount the chat runtime on first open and keep it mounted (state derived during render).
  if (open && !everOpened) setEverOpened(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside
      ref={panelRef}
      id="ask-fewer-drawer"
      role="complementary"
      aria-label="Ask Fewer chat"
      aria-hidden={!open}
      inert={!open}
      className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-line-strong bg-paper transition-transform duration-200 ${
        open ? "translate-x-0 shadow-[-24px_0_60px_-30px_rgba(27,31,35,0.35)]" : "translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Sparkles aria-hidden className="size-4 text-wildcard-accent" />
          Ask Fewer
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-line hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">{everOpened ? <ChatRuntime /> : null}</div>
    </aside>
  );
}
