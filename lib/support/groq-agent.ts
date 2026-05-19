// Groq API integration — Llama 3.3 70B via OpenAI-compatible endpoint.
//
// Free tier: 30 requests/minute, no credit card needed.
// Get key at: https://console.groq.com → API Keys → Create Key
// Add to Vercel as GROQ_API_KEY.
//
// Quality is comparable to Claude Sonnet for general support queries;
// not as nuanced as Claude Opus but more than enough for FAQ + intent.
// Speed is excellent (Groq's LPU runs ~500 tokens/sec).
//
// JSON output: Groq supports `response_format: {type: "json_object"}`
// which guarantees parseable JSON, avoiding the prompt-engineered
// "respond with JSON" pattern Anthropic uses.

import type { AIResponse, SupportMessage } from "./types";
import { SUPPORT_KB } from "./knowledge";
import { detectMessageLang, langInstructionForAI } from "./lang-detect";

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

export function isGroqEnabled(): boolean {
  return !!(process.env.GROQ_API_KEY || "").trim();
}

type UserContext = {
  userId: string | null;
  name?: string | null;
  tier?: string | null;
  bookingCount?: number;
  activeBidCount?: number;
  walletBalance?: number;
};

export async function respondViaGroq(opts: {
  conversation: { id: string; status: string };
  history: SupportMessage[];
  newMessage: string;
  userContext: UserContext;
}): Promise<AIResponse> {
  const { history, newMessage, userContext } = opts;

  // OpenAI-format messages array: system prompt + alternating user/assistant
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  // Combined system message — Groq doesn't have prompt caching so we
  // append per-user context to the KB system prompt.
  // v157 — also inject a language-match instruction based on the
  // user's current message script + word heuristic. Llama 3.3 defaults
  // to English unless explicitly told otherwise, even when the KB
  // says "reply in user's language".
  const userContextBlock = buildUserContextBlock(userContext);
  const langHint = langInstructionForAI(detectMessageLang(newMessage));
  messages.push({
    role: "system",
    content: `${SUPPORT_KB}\n\n${userContextBlock}\n\n# Reply language\n${langHint}`,
  });

  for (const m of history) {
    if (m.sender === "user") {
      messages.push({ role: "user", content: m.body });
    } else if (m.sender === "ai") {
      messages.push({ role: "assistant", content: m.body });
    } else if (m.sender === "agent") {
      messages.push({
        role: "user",
        content: `[system: a human agent replied: "${m.body}". You are now not in control of this conversation.]`,
      });
    }
  }
  messages.push({ role: "user", content: newMessage });

  const body = {
    model: MODEL,
    max_tokens: 800,
    temperature: 0.4, // Slightly creative but grounded
    response_format: { type: "json_object" }, // Guaranteed JSON
    messages,
  };

  const resp = await fetch(GROQ_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Groq API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const json: any = await resp.json();
  const text = json?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonReply(text);

  return {
    reply: parsed.reply,
    confidence: parsed.confidence,
    shouldEscalate: parsed.shouldEscalate,
    escalationReason: parsed.escalationReason as any,
    model: MODEL,
    tokensIn: json?.usage?.prompt_tokens || 0,
    tokensOut: json?.usage?.completion_tokens || 0,
  };
}

function buildUserContextBlock(ctx: UserContext): string {
  if (!ctx.userId) {
    return `# Current guest\nAnonymous (not signed in). Cannot look up their bookings/bids/wallet. If they need account-specific help, ask them to sign in first.`;
  }
  const lines: string[] = [`# Current guest`, `Signed-in: yes`];
  if (ctx.name) lines.push(`Name: ${ctx.name}`);
  if (ctx.tier) lines.push(`Tier: ${ctx.tier}`);
  if (typeof ctx.bookingCount === "number") lines.push(`Past bookings: ${ctx.bookingCount}`);
  if (typeof ctx.activeBidCount === "number") lines.push(`Active bids: ${ctx.activeBidCount}`);
  if (typeof ctx.walletBalance === "number") lines.push(`Wallet balance: ₹${ctx.walletBalance}`);
  return lines.join("\n");
}

function parseJsonReply(text: string): {
  reply: string;
  confidence: number;
  shouldEscalate: boolean;
  escalationReason: string | null;
} {
  try {
    const parsed = JSON.parse(text);
    return {
      reply: String(parsed.reply || "").trim() || "Sorry, kuch problem ho gayi. Phir try kijiye.",
      confidence: clamp01(Number(parsed.confidence)) || 0.5,
      shouldEscalate: !!parsed.shouldEscalate,
      escalationReason: parsed.escalationReason || null,
    };
  } catch {
    return {
      reply: text || "Sorry, kuch problem ho gayi.",
      confidence: 0.3,
      shouldEscalate: true,
      escalationReason: "low_confidence",
    };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
