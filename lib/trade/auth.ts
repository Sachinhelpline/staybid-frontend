// ============================================================================
// v361 — Model 3 travel-agent auth resolver (server-only).
//
// Travel agents sign in with GOOGLE (Firebase) — phone OTP is disabled for now.
// The Firebase RS256 token carries { sub/user_id, email, name }. We resolve the
// `trade_agents` row by that auth id (primary) or email (fallback), using the
// shared social-auth helper so BOTH Firebase and backend tokens work.
//
// NAMESPACE: distinct from the customer-SUPPORT `/agent` + `sb_agent_*` panel.
// Travel agents live under `sb_trade_*` + this table.
//
// GATING CONTRACT (per product decision):
//   • BROWSE  — open to everyone (no agent row needed).
//   • BID     — requires an APPROVED trade_agents row (requireApprovedAgent).
// ============================================================================
import { SB_URL, SB_READ } from "@/lib/sb";
import { socialUserFromReq, type SocialAuthUser } from "@/lib/social/auth-helper";

export type TradeAgent = {
  id: string;
  user_id: string;
  email?: string | null;
  name?: string | null;
  agency_name?: string | null;
  city?: string | null;
  category?: string | null;
  status: string; // pending | approved | rejected | suspended
  [k: string]: any;
};

export type TradeAuth = {
  user: SocialAuthUser;    // the signed-in Google/backend identity
  agent: TradeAgent | null; // the trade_agents row, or null if not registered
};

// Resolve the trade_agents row for the signed-in user. Returns null only when
// there is NO valid token at all. When authenticated-but-unregistered, returns
// { user, agent: null } so the caller can route to the register form.
export async function tradeAgentFromReq(req: Request): Promise<TradeAuth | null> {
  const user = socialUserFromReq(req);
  if (!user?.id) return null;
  const agent = await lookupTradeAgent(user.id, user.email);
  return { user, agent };
}

// Look up by canonical auth id first, then case-insensitive email (covers the
// same human signing in via a different provider row). No FK / embed joins.
export async function lookupTradeAgent(userId: string, email?: string | null): Promise<TradeAgent | null> {
  try {
    const byId = await fetch(
      `${SB_URL}/rest/v1/trade_agents?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (byId.ok) {
      const [row] = await byId.json();
      if (row) return row as TradeAgent;
    }
    if (email) {
      const byEmail = await fetch(
        `${SB_URL}/rest/v1/trade_agents?email=ilike.${encodeURIComponent(email)}&select=*&order=created_at.asc&limit=1`,
        { headers: SB_READ, cache: "no-store" },
      );
      if (byEmail.ok) {
        const [row] = await byEmail.json();
        if (row) return row as TradeAgent;
      }
    }
  } catch { /* fall through */ }
  return null;
}

export function isApprovedAgent(agent: TradeAgent | null): boolean {
  return !!agent && agent.status === "approved";
}

// Guard for BID-side routes. Returns the approved agent, or an error shape the
// route turns into a 401/403 (browse stays open — never call this on read routes).
export async function requireApprovedAgent(
  req: Request,
): Promise<{ ok: true; auth: TradeAuth } | { ok: false; status: number; error: string; registered?: boolean }> {
  const auth = await tradeAgentFromReq(req);
  if (!auth) return { ok: false, status: 401, error: "Sign in with Google first." };
  if (!auth.agent) return { ok: false, status: 403, error: "Register as a travel agent to bid.", registered: false };
  if (auth.agent.status !== "approved") {
    return { ok: false, status: 403, error: `Your agent account is ${auth.agent.status}. Approval needed to bid.`, registered: true };
  }
  return { ok: true, auth };
}
