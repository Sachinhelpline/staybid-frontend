import { NextRequest, NextResponse } from "next/server";
import { agentFromReq } from "@/lib/support/agent-auth";
import { isGroqEnabled } from "@/lib/support/groq-agent";
import { isAnthropicEnabled } from "@/lib/support/ai-agent";

export const dynamic = "force-dynamic";

// GET /api/admin/support/ai-test
// Performs a LIVE test call to whichever provider is configured and
// returns the actual response or error. Admins use this to diagnose
// "AI not replying" issues. v156 — was missing visibility into WHY
// AI calls were failing in production.
//
// Returns:
//   { ok: true, provider, latency_ms, sample_reply }
//   { ok: false, provider, error: <full error string>, status_hint }
export async function GET(req: NextRequest) {
  const agent = await agentFromReq(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const groqOn = isGroqEnabled();
  const anthropicOn = isAnthropicEnabled();

  if (!groqOn && !anthropicOn) {
    return NextResponse.json({
      ok: false,
      configured: { groq: false, anthropic: false },
      error: "No AI provider configured",
      hint:
        "Add GROQ_API_KEY (free at console.groq.com) or ANTHROPIC_API_KEY to Vercel env vars + REDEPLOY (env var changes don't take effect until a fresh deploy).",
    });
  }

  // Test the preferred provider first
  const preferEnv = (process.env.SUPPORT_AI_PREFER || "").toLowerCase();
  const preferAnthropic = preferEnv === "anthropic";
  const testProvider = preferAnthropic && anthropicOn ? "anthropic" : groqOn ? "groq" : "anthropic";

  const start = Date.now();
  try {
    if (testProvider === "groq") {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 50,
          messages: [
            {
              role: "user",
              content:
                "Reply with exactly one short sentence confirming the connection works. No JSON.",
            },
          ],
        }),
      });
      const latency = Date.now() - start;
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        return NextResponse.json({
          ok: false,
          provider: "groq",
          latency_ms: latency,
          http_status: r.status,
          error: errText.slice(0, 500),
          hint: groqHint(r.status, errText),
        });
      }
      const j: any = await r.json();
      return NextResponse.json({
        ok: true,
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        latency_ms: latency,
        sample_reply: j?.choices?.[0]?.message?.content || "",
        usage: j?.usage,
      });
    }

    // Anthropic test
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: "Reply with exactly one short sentence confirming the connection works.",
          },
        ],
      }),
    });
    const latency = Date.now() - start;
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return NextResponse.json({
        ok: false,
        provider: "anthropic",
        latency_ms: latency,
        http_status: r.status,
        error: errText.slice(0, 500),
        hint: anthropicHint(r.status, errText),
      });
    }
    const j: any = await r.json();
    return NextResponse.json({
      ok: true,
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      latency_ms: latency,
      sample_reply: Array.isArray(j?.content) ? j.content.find((p: any) => p.type === "text")?.text : "",
      usage: j?.usage,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      provider: testProvider,
      latency_ms: Date.now() - start,
      error: String(e?.message || e),
      hint: "Network error reaching provider — check Vercel function logs for stack trace.",
    });
  }
}

function groqHint(status: number, body: string): string {
  if (status === 401) return "GROQ_API_KEY is INVALID. Generate a fresh key at console.groq.com → API Keys → Create Key, paste into Vercel env vars EXACTLY (no spaces, no quotes), then REDEPLOY.";
  if (status === 429) return "Rate limit hit. Groq free tier = 30 requests/minute. Wait 60s or upgrade.";
  if (status === 404 && body.includes("model")) return "Model name issue — Groq deprecated 'llama-3.3-70b-versatile'. Update model name.";
  if (status === 400 && body.includes("decommissioned")) return "Model decommissioned. Update model name to latest Groq Llama variant.";
  return `Groq returned HTTP ${status}. Inspect error body for details.`;
}

function anthropicHint(status: number, body: string): string {
  if (status === 401) return "ANTHROPIC_API_KEY is INVALID. Generate fresh key at console.anthropic.com.";
  if (status === 429) return "Anthropic rate limit. Free tier is limited; add credit at console.anthropic.com.";
  if (status === 400 && body.includes("credit")) return "Anthropic account has no credit balance. Add funds at console.anthropic.com → Settings → Billing.";
  return `Anthropic returned HTTP ${status}. Inspect error body for details.`;
}
