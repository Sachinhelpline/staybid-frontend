// v361 — Model 3: travel-agent sign-in resolver. Called with a Google/Firebase
// Bearer token. Returns the agent's registration + approval status so the UI can
// route: not-signed-in → sign in; signed-in-unregistered → register form;
// pending → "under review"; approved → full bid access.
import { NextResponse } from "next/server";
import { tradeAgentFromReq } from "@/lib/trade/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await tradeAgentFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in with Google first." }, { status: 401 });
  if (!auth.agent) {
    return NextResponse.json({ registered: false, user: { email: auth.user.email, name: auth.user.name } }, { status: 200 });
  }
  const a = auth.agent;
  return NextResponse.json({
    registered: true,
    approved: a.status === "approved",
    status: a.status,
    agent: {
      id: a.id, agency_name: a.agency_name, name: a.name, email: a.email,
      city: a.city, category: a.category, status: a.status,
    },
  });
}

// Convenience GET mirrors POST (some clients prefer GET for a status probe).
export async function GET(req: Request) {
  return POST(req);
}
