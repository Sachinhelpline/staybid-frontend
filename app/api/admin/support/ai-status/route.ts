import { NextRequest, NextResponse } from "next/server";
import { agentFromReq } from "@/lib/support/agent-auth";
import { isAIEnabled, isAnthropicEnabled } from "@/lib/support/ai-agent";
import { isGroqEnabled } from "@/lib/support/groq-agent";

export const dynamic = "force-dynamic";

// GET /api/admin/support/ai-status
// Returns which AI provider(s) are configured + which one will be used.
// Agents use this to verify their env var setup is live.
export async function GET(req: NextRequest) {
  const agent = await agentFromReq(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const groq = isGroqEnabled();
  const anthropic = isAnthropicEnabled();
  const anyAI = isAIEnabled();

  const preferEnv = (process.env.SUPPORT_AI_PREFER || "").toLowerCase();
  const preferAnthropic = preferEnv === "anthropic";
  let activeProvider: "groq" | "anthropic" | "fallback_only" = "fallback_only";
  let activeModel: string | null = null;

  if (anyAI) {
    if (preferAnthropic && anthropic) {
      activeProvider = "anthropic";
      activeModel = "claude-haiku-4-5-20251001";
    } else if (groq) {
      activeProvider = "groq";
      activeModel = "llama-3.3-70b-versatile";
    } else if (anthropic) {
      activeProvider = "anthropic";
      activeModel = "claude-haiku-4-5-20251001";
    }
  }

  return NextResponse.json({
    enabled: anyAI,
    activeProvider,
    activeModel,
    providers: {
      groq: { configured: groq, model: groq ? "llama-3.3-70b-versatile" : null },
      anthropic: { configured: anthropic, model: anthropic ? "claude-haiku-4-5-20251001" : null },
    },
    preferOverride: preferEnv || null,
    fallbackBotAlwaysAvailable: true,
  });
}
