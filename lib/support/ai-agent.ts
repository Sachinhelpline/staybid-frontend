// Anthropic Claude API integration for the support bot.
//
// Implemented as a native fetch (no @anthropic-ai/sdk dependency) — keeps
// the bundle small and matches CLAUDE.md's "no new dependencies" rule.
//
// Graceful degradation: if ANTHROPIC_API_KEY is missing, isAIEnabled()
// returns false and every customer message routes straight to the agent
// queue. The bot never blocks the user flow.
//
// Prompt caching: the long system prompt (knowledge base) is marked
// cache_control: ephemeral so repeat conversations only pay for the
// dynamic prefix (user context + history). 5-min TTL is Anthropic
// default for ephemeral cache breakpoints.

import type { AIResponse, SupportMessage } from "./types";
import { SUPPORT_KB } from "./knowledge";
import { isGroqEnabled, respondViaGroq } from "./groq-agent";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

// v152 — AI is enabled when EITHER provider is configured. Router below
// picks the right one: Groq (free tier) is preferred if set; Anthropic
// (paid, premium quality) takes over only when Groq is OFF.
//
// To switch preference: set SUPPORT_AI_PREFER=anthropic to force
// Anthropic-first when both keys are set. Default = Groq-first because
// most users set Groq (free) and may have Anthropic as a backup.
export function isAnthropicEnabled(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || "").trim();
}

export function isAIEnabled(): boolean {
  return isGroqEnabled() || isAnthropicEnabled();
}

type UserContext = {
  userId: string | null;
  name?: string | null;
  tier?: string | null;
  bookingCount?: number;
  activeBidCount?: number;
  walletBalance?: number;
};

// v152 — Provider router. Picks the right AI backend based on which
// env vars are set + SUPPORT_AI_PREFER override. Always tries the
// preferred provider first; if it fails AND the alternate is available,
// falls back. If everything fails, throws — caller (messages route)
// handles via fallback bot.
export async function respondToMessage(opts: {
  conversation: { id: string; status: string };
  history: SupportMessage[];
  newMessage: string;
  userContext: UserContext;
}): Promise<AIResponse> {
  const prefer = (process.env.SUPPORT_AI_PREFER || "").toLowerCase();
  const groqOn = isGroqEnabled();
  const anthropicOn = isAnthropicEnabled();

  // Default: Groq-first (free tier). User can force Anthropic-first by
  // setting SUPPORT_AI_PREFER=anthropic.
  const preferAnthropic = prefer === "anthropic";
  const order: Array<"groq" | "anthropic"> = preferAnthropic
    ? ["anthropic", "groq"]
    : ["groq", "anthropic"];

  let lastErr: any = null;
  for (const provider of order) {
    if (provider === "groq" && !groqOn) continue;
    if (provider === "anthropic" && !anthropicOn) continue;
    try {
      if (provider === "groq") {
        return await respondViaGroq(opts);
      }
      return await respondViaAnthropic(opts);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("No AI provider configured");
}

async function respondViaAnthropic(opts: {
  conversation: { id: string; status: string };
  history: SupportMessage[];
  newMessage: string;
  userContext: UserContext;
}): Promise<AIResponse> {
  const { history, newMessage, userContext } = opts;

  // Build the AI history. AI sees user messages and previous AI replies;
  // agent replies are surfaced as "system note" so the AI doesn't
  // impersonate an agent on the next turn.
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
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

  const userContextBlock = buildUserContextBlock(userContext);

  const body = {
    model: MODEL,
    max_tokens: 800,
    system: [
      // Cached: long KB. Repeat conversations from this user (and any
      // other user) reuse the same cached prefix.
      {
        type: "text",
        text: SUPPORT_KB,
        cache_control: { type: "ephemeral" },
      },
      // Not cached: per-user context. Recomputed each call so changes
      // (new bookings, new bids) show up immediately.
      {
        type: "text",
        text: userContextBlock,
      },
    ],
    messages,
  };

  const resp = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const json: any = await resp.json();
  const textPart =
    Array.isArray(json?.content)
      ? json.content.find((p: any) => p?.type === "text")?.text
      : "";

  const parsed = parseAIJsonReply(textPart || "");

  return {
    reply: parsed.reply,
    confidence: parsed.confidence,
    shouldEscalate: parsed.shouldEscalate,
    escalationReason: parsed.escalationReason as any,
    model: MODEL,
    tokensIn: json?.usage?.input_tokens || 0,
    tokensOut: json?.usage?.output_tokens || 0,
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

// AI sometimes wraps JSON in fences or adds preamble despite the prompt.
// We strip both before parsing. If parsing still fails, treat the entire
// text as a low-confidence reply and let the escalation engine decide.
function parseAIJsonReply(text: string): {
  reply: string;
  confidence: number;
  shouldEscalate: boolean;
  escalationReason: string | null;
} {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    return {
      reply: String(parsed.reply || "").trim() || "Sorry, kuch problem ho gayi. Phir try kijiye.",
      confidence: clamp01(Number(parsed.confidence)) || 0.5,
      shouldEscalate: !!parsed.shouldEscalate,
      escalationReason: parsed.escalationReason || null,
    };
  } catch {
    return {
      reply: stripped || "Sorry, kuch problem ho gayi.",
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

// Cheap heuristic gates that run BEFORE we even call the API.
// These short-circuit obvious cases and save tokens.
const ESCALATION_KEYWORDS = [
  "agent", "human", "person", "manager",
  "kisi se baat", "insaan", "real person",
  "refund", "chargeback", "fraud", "scam", "cheat",
  "police", "court", "legal",
  "emergency", "injury", "hurt", "poisoning",
];

export function shouldShortCircuitEscalate(text: string): {
  escalate: boolean;
  reason?: "user_request" | "specific_intent";
} {
  const t = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (t.includes(kw)) {
      if (kw === "refund" || kw === "chargeback" || kw === "fraud" || kw === "scam" || kw === "cheat" ||
          kw === "police" || kw === "court" || kw === "legal") {
        return { escalate: true, reason: "specific_intent" };
      }
      return { escalate: true, reason: "user_request" };
    }
  }
  return { escalate: false };
}
