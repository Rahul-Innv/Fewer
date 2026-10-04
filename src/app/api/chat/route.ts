import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { toAISdkStream } from "@mastra/ai-sdk";
import { jsonError, requireJson, safeMessage } from "../_lib/http";
import { buildDesk, deskContextText } from "../desk/read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user"; content: string } | { role: "assistant"; content: string };

/** assistant-ui (AI SDK UIMessage) -> plain role/content pairs. Tool/data parts are dropped. */
function toPlainMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-16)) {
    if (!m || typeof m !== "object") continue;
    const msg = m as { role?: unknown; content?: unknown; parts?: unknown };
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    let text = "";
    if (typeof msg.content === "string") text = msg.content;
    else if (Array.isArray(msg.parts)) {
      text = msg.parts
        .map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
        .join("");
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
        .join("");
    }
    text = text.trim().slice(0, 4000);
    if (text) out.push(msg.role === "user" ? { role: "user", content: text } : { role: "assistant", content: text });
  }
  return out;
}

/**
 * POST /api/chat: streams `fewerAgent` (Mastra) to assistant-ui.
 * Mastra agent.stream(...) -> toAISdkStream(..., { from: "agent", version: "v7" }) -> createUIMessageStream.
 * Stateless: the client sends the thread, and the Desk snapshot is injected as context so the
 * agent can explain real decisions. Email text never reaches this route.
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  let body: { messages?: unknown } = {};
  try {
    body = (await req.json()) as { messages?: unknown };
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const messages = toPlainMessages(body.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return jsonError(400, "Send a user message.");
  }

  try {
    const { fewerAgent } = await import("@/server/llm");

    let context = "";
    try {
      context = deskContextText(await buildDesk());
    } catch {
      context = "";
    }

    const result = await fewerAgent.stream(messages, {
      ...(context ? { context: [{ role: "system" as const, content: context }] } : {}),
    });

    // Model errors surface in the thread as a short, safe sentence (no stack traces, no env values).
    const onError = (e: unknown) => safeMessage(e, "The model could not answer just now.");

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.merge(toAISdkStream(result, { from: "agent", version: "v7", onError }) as never);
      },
      onError,
    });

    return createUIMessageStreamResponse({ stream });
  } catch (e) {
    return jsonError(503, safeMessage(e, "Chat isn't available yet. The model isn't configured."));
  }
}
