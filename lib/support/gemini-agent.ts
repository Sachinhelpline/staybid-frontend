// Gemini API integration — support chat brain (v153 / Option A).
//
// FREE tier: ~15 requests/min, ~1000 requests/day, no credit card.
// Get key at: https://aistudio.google.com → "Get API key".
// Add to Vercel as GEMINI_CHAT_API_KEY.
//
// IMPORTANT — uses a SEPARATE key (GEMINI_CHAT_API_KEY) from the
// verification vision engine (GEMINI_API_KEY). Gemini's free quota is
// PER-PROJECT, so the support key lives in its own AI Studio project to
// keep its ~1000/day quota independent of verification. Falls back to
// GEMINI_API_KEY only if the chat key isn't set (shared-quota mode).
//
// JSON output: Gemini's generateContent supports
// `responseMimeType: "application/json"` → guaranteed parseable JSON,
// same contract as the Groq agent.

import type { AIResponse, SupportMessage } from "./types";
import { SUPPORT_KB } from "./knowledge";
import { detectMessageLang, langInstructionForAI } from "./lang-detect";

const GEMINI_MODEL =
  process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Prefer the dedicated chat key (separate project → independent quota);
// fall back to the verification key so the agent still works if only one
// Gemini key is configured.
function geminiChatKey(): string {
  return (process.env.GEMINI_CHAT_API_KEY || process.env.GEMINI_API_KEY || "").trim();
}

export function isGeminiSupportEnabled(): boolean {
  return !!geminiChatKey();
}

type UserContext = {
  userId: string | null;
  name?: string | null;
  tier?: string | null;
  bookingCount?: number;
  activeBidCount?: number;
  walletBalance?: number;
};

export async function respondViaGemini(opts: {
  conversation: { id: string; status: string };
  history: SupportMessage[];
  newMessage: string;
  userContext: UserContext;
}): Promise<AIResponse> {
  const { history, newMessage, userContext } = opts;
  const key = geminiChatKey();
  if (!key) throw new Error("GEMINI_CHAT_API_KEY not set");

  // System instruction = KB + per-user context + reply-language hint, plus an
  // explicit JSON-shape instruction (mirrors the Groq prompt contract).
  const userContextBlock = buildUserContextBlock(userContext);
  const langHint = langInstructionForAI(detectMessageLang(newMessage));
  const systemText =
    `${SUPPORT_KB}\n\n${userContextBlock}\n\n# Reply language\n${langHint}\n\n` +
    `# Output format\nReturn STRICT JSON only, no prose, exactly this shape:\n` +
    `{"reply":string,"confidence":number(0..1),"shouldEscalate":boolean,"escalationReason":string|null}`;

  // Gemini `contents` = alternating user/model turns. Agent messages are
  // surfaced as a user-role system note so the model doesn't impersonate a
  // human agent on the next turn (same handling as Groq/Anthropic).
  const contents: Array<{ role: "user" | "model"; parts: { text: string }[] }> = [];
  for (const m of history) {
    if (m.sender === "user") {
      contents.push({ role: "user", parts: [{ text: m.body }] });
    } else if (m.sender === "ai") {
      contents.push({ role: "model", parts: [{ text: m.body }] });
    } else if (m.sender === "agent") {
      contents.push({
        role: "user",
        parts: [{ text: `[system: a human agent replied: "${m.body}". You are now not in control of this conversation.]` }],
      });
    }
  }
  contents.push({ role: "user", parts: [{ text: newMessage }] });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const json: any = await resp.json();
  const text = (json?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("\n");
  const parsed = parseJsonReply(text);

  return {
    reply: parsed.reply,
    confidence: parsed.confidence,
    shouldEscalate: parsed.shouldEscalate,
    escalationReason: parsed.escalationReason as any,
    model: `gemini:${GEMINI_MODEL}`,
    tokensIn: json?.usageMetadata?.promptTokenCount || 0,
    tokensOut: json?.usageMetadata?.candidatesTokenCount || 0,
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
    // Gemini honours responseMimeType:json, but strip any stray fences just in case.
    const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
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
