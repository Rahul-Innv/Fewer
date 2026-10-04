import { createHash, randomBytes } from "node:crypto";
import { AgentMailClient } from "agentmail";
import { normalizeEmail } from "@/core";
import { allowSend, requireEnv } from "./env";

/**
 * AgentMail integration. All functions take inbox ids (an inbox id IS its email address,
 * e.g. fewer-xyz@agentmail.to).
 *
 * Verified against agentmail 0.5.x types:
 *  - messages.send / messages.reply take (inboxId, [messageId,] body, { idempotencyKey })
 *    -> sent as the `Idempotency-Key` header (BaseIdempotentRequestOptions).
 *  - Message.from is "Name <a@b>" or "a@b"; Message.timestamp is a Date.
 *  - client.websockets.connect({ waitForOpen, autoReconnect, reconnectAttempts }) resolves once OPEN;
 *    socket.on("message"|"close"|"error"), socket.sendSubscribe({ type: "subscribe", inboxIds, eventTypes }).
 */

export interface InboundMessage {
  inboxId: string;
  messageId: string;
  threadId: string;
  /** bare lowercased email of the sender */
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  /** extractedText ?? text ?? html-stripped (the new content, without quoted history) */
  replyText: string;
  /** text ?? html-stripped (whole message including quoted history) */
  fullText: string;
  /** ISO timestamp */
  receivedAt: string;
}

let _client: AgentMailClient | null = null;

export function mailClient(): AgentMailClient {
  if (!_client) {
    const { AGENTMAIL_API_KEY } = requireEnv("AGENTMAIL_API_KEY");
    const baseUrl = process.env.AGENTMAIL_BASE_URL?.trim(); // test hook only
    _client = new AgentMailClient({ apiKey: AGENTMAIL_API_KEY, ...(baseUrl ? { baseUrl } : {}) });
  }
  return _client;
}

// ---------- helpers ----------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Minimal HTML -> text (Gmail forwards can be HTML-only). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstNonEmpty(...vals: Array<string | null | undefined>): string {
  for (const v of vals) if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return "";
}

/** "Name <a@b>" -> { email: "a@b", name: "Name" }; bare address -> { email } */
export function parseFrom(raw: string): { email: string; name?: string } {
  const email = normalizeEmail(raw ?? "");
  const m = /^\s*"?([^"<]*?)"?\s*<[^<>]+>\s*$/.exec(raw ?? "");
  const name = m?.[1]?.trim();
  return name ? { email, name } : { email };
}

function toIso(d: unknown): string {
  const t = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
}

function dryRunId(seed: string | undefined, prefix = "dry-run"): string {
  const h = seed
    ? createHash("sha256").update(seed).digest("hex").slice(0, 16)
    : randomBytes(8).toString("hex");
  return `${prefix}-${h}`;
}

// ---------- send / reply ----------

export async function sendMail(o: {
  inboxId: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  idempotencyKey?: string;
}): Promise<{ messageId: string; threadId: string }> {
  if (!allowSend()) {
    const id = dryRunId(o.idempotencyKey);
    console.log(
      `[mail] DRY-RUN (FEWER_ALLOW_SEND=false) send from=${o.inboxId} to=${o.to.join(",")} subject=${JSON.stringify(o.subject)}`,
    );
    return { messageId: id, threadId: id };
  }
  const res = await mailClient().inboxes.messages.send(
    o.inboxId,
    { to: o.to, subject: o.subject, text: o.text, ...(o.html ? { html: o.html } : {}) },
    o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : undefined,
  );
  return { messageId: res.messageId, threadId: res.threadId };
}

export async function replyTo(o: {
  inboxId: string;
  messageId: string;
  text: string;
  html?: string;
  idempotencyKey?: string;
}): Promise<{ messageId: string; threadId: string }> {
  if (!allowSend()) {
    const id = dryRunId(o.idempotencyKey);
    console.log(
      `[mail] DRY-RUN (FEWER_ALLOW_SEND=false) reply inbox=${o.inboxId} to-message=${o.messageId}`,
    );
    return { messageId: id, threadId: id };
  }
  const res = await mailClient().inboxes.messages.reply(
    o.inboxId,
    o.messageId,
    { text: o.text, ...(o.html ? { html: o.html } : {}) },
    o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : undefined,
  );
  return { messageId: res.messageId, threadId: res.threadId };
}

// ---------- read ----------

export async function getMessage(inboxId: string, messageId: string): Promise<InboundMessage> {
  const m = await mailClient().inboxes.messages.get(inboxId, messageId);
  const { email, name } = parseFrom(m.from);
  const htmlText = htmlToText(firstNonEmpty(m.extractedHtml, m.html));
  const fullHtmlText = htmlToText(firstNonEmpty(m.html, m.extractedHtml));
  const replyText = firstNonEmpty(m.extractedText, m.text, htmlText, m.preview);
  const fullText = firstNonEmpty(m.text, fullHtmlText, m.extractedText, replyText);
  return {
    inboxId,
    messageId: m.messageId,
    threadId: m.threadId,
    from: email,
    ...(name ? { fromName: name } : {}),
    to: (m.to ?? []).map((t) => normalizeEmail(t)),
    subject: m.subject ?? "",
    replyText,
    fullText,
    receivedAt: toIso(m.timestamp ?? m.createdAt),
  };
}

export async function addLabels(inboxId: string, messageId: string, labels: string[]): Promise<void> {
  if (labels.length === 0) return;
  await mailClient().inboxes.messages.update(inboxId, messageId, { addLabels: labels });
}

// ---------- listen (WebSocket + poll fallback) ----------

type Ref = { inboxId: string; messageId: string; threadId: string };

const POLL_MS = 5_000;
const PROCESSED_LABEL = "fewer-processed";
const REPLAY_WINDOW_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;
const SKIP_LABELS = new Set(["sent", "draft", "spam", "blocked", "unauthenticated", "trash"]);

/** Errors from the SDK socket can be ErrorEvent-like objects, not Error instances. */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Subscribe to message.received on one inbox via WebSocket (reconnect with backoff, resubscribe on
 * every connection) AND poll messages.list every 5s as a fallback. Dedupes by messageId. On start,
 * inbound messages from the last REPLAY_WINDOW_MS without the "fewer-processed" label are replayed
 * (they arrived while the worker was down); older or already-processed ones are skipped. Replay is
 * safe: asks dedupe on inbox_message_id, approval codes are single-use, check-ins are gated.
 * onMessage calls are serialized. A handler that throws is retried (next poll) up to 3 times.
 * Never subscribes to spam / blocked / unauthenticated events.
 */
export function listenInbox(
  inboxId: string,
  onMessage: (m: Ref) => Promise<void>,
): { stop(): void } {
  const client = mailClient();
  const abort = new AbortController();
  const seen = new Set<string>();
  const attempts = new Map<string, number>();
  const ownAddress = inboxId.includes("@") ? inboxId.toLowerCase() : null;
  let chain: Promise<void> = Promise.resolve();
  let seeded = false;
  let currentSocket: { close(): void } | null = null;

  const isInbound = (labels: string[] | undefined, from: string | undefined): boolean => {
    if (labels?.some((l) => SKIP_LABELS.has(l.toLowerCase()))) return false;
    if (ownAddress && from && normalizeEmail(from) === ownAddress) return false;
    return true;
  };

  const enqueue = (ref: Ref): void => {
    if (abort.signal.aborted || seen.has(ref.messageId)) return;
    seen.add(ref.messageId);
    chain = chain.then(async () => {
      if (abort.signal.aborted) return;
      try {
        await onMessage(ref);
        attempts.delete(ref.messageId);
        // Durable marker so a restart never re-delivers this message.
        void addLabels(inboxId, ref.messageId, [PROCESSED_LABEL]).catch(() => {});
      } catch (err) {
        const n = (attempts.get(ref.messageId) ?? 0) + 1;
        attempts.set(ref.messageId, n);
        console.error(`[mail] handler failed for ${ref.messageId} (attempt ${n}/${MAX_ATTEMPTS}):`, err);
        // Let the next poll pick it up again, unless we've tried enough.
        if (n < MAX_ATTEMPTS) seen.delete(ref.messageId);
      }
    });
  };

  // ----- poll fallback -----
  const pollLoop = async (): Promise<void> => {
    while (!abort.signal.aborted) {
      try {
        const res = await client.inboxes.messages.list(inboxId, { limit: seeded ? 25 : 100 });
        const items = res.messages ?? [];
        if (!seeded) {
          const cutoff = Date.now() - REPLAY_WINDOW_MS;
          let replay = 0;
          for (const it of items) {
            const recent = new Date(it.timestamp).getTime() >= cutoff;
            const done = it.labels?.some((l) => l.toLowerCase() === PROCESSED_LABEL);
            if (recent && !done && isInbound(it.labels, it.from)) replay += 1;
            else seen.add(it.messageId);
          }
          seeded = true;
          console.log(`[mail] poll seeded with ${items.length} existing message(s) for ${inboxId}; replaying ${replay} unprocessed from the last ${REPLAY_WINDOW_MS / 60_000} min`);
        }
        {
          const fresh = items
            .filter((it) => !seen.has(it.messageId) && isInbound(it.labels, it.from))
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          for (const it of fresh) {
            enqueue({ inboxId, messageId: it.messageId, threadId: it.threadId });
          }
          // Messages we skipped (sent by us etc.) should not be re-examined forever.
          for (const it of items) if (!isInbound(it.labels, it.from)) seen.add(it.messageId);
        }
      } catch (err) {
        console.warn(`[mail] poll failed: ${errMsg(err)}`);
      }
      await sleep(POLL_MS, abort.signal);
    }
  };

  // ----- websocket with reconnect + backoff -----
  const wsLoop = async (): Promise<void> => {
    let backoff = 1_000;
    while (!abort.signal.aborted) {
      let closed: () => void = () => {};
      const closedPromise = new Promise<void>((resolve) => {
        closed = resolve;
      });
      try {
        // agentmail >= 0.5.3x wraps connect(): waitForOpen (default true) resolves only once the
        // socket is OPEN, and autoReconnect (default true) reconnects + resubscribes by itself.
        // We run our own reconnect/backoff loop instead, so switch the SDK ones off and subscribe
        // right away (an "open" event can no longer be observed after connect() resolves).
        const socket = await client.websockets.connect({
          waitForOpen: true,
          autoReconnect: false,
          reconnectAttempts: 0,
        });
        currentSocket = socket;
        const subscribe = (): void => {
          try {
            socket.sendSubscribe({
              type: "subscribe",
              inboxIds: [inboxId],
              eventTypes: ["message.received"],
            });
            backoff = 1_000;
          } catch (err) {
            console.warn(`[mail] subscribe failed: ${errMsg(err)}`);
            closed();
          }
        };
        socket.on("message", (event) => {
          if (event.type === "subscribed") {
            console.log(`[mail] websocket subscribed: ${(event.inboxIds ?? []).join(",")}`);
          } else if (event.type === "event" && event.eventType === "message.received") {
            const msg = event.message;
            if (!isInbound(msg.labels, msg.from)) return;
            enqueue({ inboxId, messageId: msg.messageId, threadId: msg.threadId });
          }
        });
        socket.on("error", (err) => {
          console.warn(`[mail] websocket error: ${errMsg(err)}`);
          closed();
        });
        socket.on("close", () => closed());
        socket.on("open", subscribe); // harmless if the SDK ever reports a (re)open
        subscribe();
        await Promise.race([closedPromise, new Promise<void>((r) => abort.signal.addEventListener("abort", () => r(), { once: true }))]);
        try {
          socket.close();
        } catch {
          /* already closed */
        }
      } catch (err) {
        console.warn(`[mail] websocket connect failed: ${errMsg(err)}`);
      }
      currentSocket = null;
      if (abort.signal.aborted) break;
      console.log(`[mail] websocket down; reconnecting in ${backoff}ms (poll fallback active)`);
      await sleep(backoff, abort.signal);
      backoff = Math.min(backoff * 2, 30_000);
    }
  };

  void pollLoop();
  void wsLoop();

  return {
    stop() {
      abort.abort();
      try {
        currentSocket?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
