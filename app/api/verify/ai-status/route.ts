import { NextResponse } from "next/server";
import { AI_PROVIDER } from "@/lib/verify/ai";

// GET /api/verify/ai-status
// Safe, key-free health check so we can confirm WHICH verification AI
// provider is active after setting env vars — without ever exposing the
// key value itself. Returns only booleans (key present?) + the resolved
// provider string.
export const dynamic = "force-dynamic";

export async function GET() {
  const present = (v?: string) => !!(v || "").trim();
  return NextResponse.json({
    provider: AI_PROVIDER, // "gemini" | "claude" | "google" | "aws" | "openai" | "mock"
    real_vision_active: AI_PROVIDER === "gemini" || AI_PROVIDER === "claude",
    keys: {
      gemini: present(process.env.GEMINI_API_KEY),
      anthropic: present(process.env.ANTHROPIC_API_KEY),
    },
    forced_override: process.env.AI_VERIFY_PROVIDER || null,
    gemini_model: process.env.GEMINI_VERIFY_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash (default)",
    note:
      AI_PROVIDER === "gemini"
        ? "✅ Gemini free vision is LIVE — verification videos are genuinely analysed."
        : AI_PROVIDER === "claude"
        ? "✅ Anthropic vision is LIVE."
        : "⚠️ Running on mock (metadata-only). Set GEMINI_API_KEY in Vercel + redeploy to activate real vision.",
  });
}
