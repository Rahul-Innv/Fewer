"use client";

import { useEffect, useRef, useState } from "react";
import { X, ArrowUp, MessageSquareText, Square, Sparkles, TriangleAlert } from "lucide-react";
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AgentStatus } from "@/components/assistant-ui/elements/agent-status";

const SUGGESTIONS = ["Why did you say no to the panel?", "What does my week look like?", "Which yes matters most?"];

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
          <ErrorPrimitive.Root className="mt-1 flex items-start gap-2 rounded-md bg-warn-bg px-2.5 py-1.5 text-[13px] text-warn-fg">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              <ErrorPrimitive.Message />
              <span className="block">The Desk still works.</span>
            </span>
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
          <div role="status" className="px-1">
            <AgentStatus state="working" label="Reading the Desk" trailing={null} />
          </div>
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

/** "Ask Fewer" floating chat panel (assistant-ui Assistant modal pattern): Thread wired to POST /api/chat (Mastra agent). */
export function ChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [everOpened, setEverOpened] = useState(open);
  const panelRef = useRef<HTMLElement>(null);
  // Mount the chat runtime on first open and keep it mounted (state derived during render).
  if (open && !everOpened) setEverOpened(true);

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const t = setTimeout(() => {
      const input = panelRef.current?.querySelector<HTMLElement>("textarea, button");
      (input ?? panelRef.current)?.focus();
    }, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      // Keep focus inside the open panel.
      if (e.key === "Tab" && panelRef.current) {
        const items = [...panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, [href], [tabindex]:not([tabindex='-1'])")];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  return (
    <aside
      ref={panelRef}
      id="ask-fewer-drawer"
      role="dialog"
      aria-modal={open}
      aria-label="Ask Fewer chat"
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      className={`fixed inset-0 z-50 flex flex-col overflow-hidden bg-paper outline-none transition-[opacity,transform] duration-200 motion-reduce:transition-none sm:inset-auto sm:bottom-[calc(96px+env(safe-area-inset-bottom))] sm:right-[calc(24px+env(safe-area-inset-right))] sm:h-[min(560px,calc(100vh-128px))] sm:w-[400px] sm:rounded-[20px] sm:border sm:border-line-strong ${
        open
          ? "translate-y-0 opacity-100 shadow-[0_24px_60px_-24px_rgba(27,31,35,0.5)]"
          : "pointer-events-none translate-y-3 opacity-0"
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
          className="grid size-11 place-items-center rounded-xl text-muted transition hover:bg-line hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">{everOpened ? <ChatRuntime /> : null}</div>
    </aside>
  );
}

/** Bottom-right launcher for the chat: an ink circle, with an "Ask Fewer" pill beside it on wider screens. */
export function ChatLauncher({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? "Close Ask Fewer" : "Ask Fewer"}
      aria-expanded={open}
      aria-controls="ask-fewer-drawer"
      title="Ask Fewer"
      className="fixed bottom-[calc(24px+env(safe-area-inset-bottom))] right-[calc(24px+env(safe-area-inset-right))] z-50 inline-flex items-center gap-2 rounded-full transition-transform duration-100 active:scale-[0.96] motion-reduce:transition-none"
    >
      <span className="hidden rounded-full border border-line-strong bg-surface px-3.5 py-2 text-[14px] font-semibold text-ink shadow-[0_8px_24px_-12px_rgba(27,31,35,0.45)] 2xl:inline">
        Ask Fewer
      </span>
      <span className="grid size-14 place-items-center rounded-full bg-action text-action-ink shadow-[0_12px_32px_-12px_rgba(27,31,35,0.7)] hover:bg-black">
        {open ? <X aria-hidden className="size-6" /> : <MessageSquareText aria-hidden className="size-6" />}
      </span>
    </button>
  );
}
