import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveVerifiedMediaCustomer,
  createMediaCustomerAuthority,
} from "@/lib/auth/media-customer-authority";
import { isMediaSessionId, secureMediaPath } from "@/lib/social/secure-media-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const mediaAuthority = createMediaCustomerAuthority();

function serviceClient() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function POST(req: Request) {
  const who = await resolveVerifiedMediaCustomer(req, mediaAuthority).catch(() => null);
  if (!who?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const sessionId = body?.sessionId;
  if (!isMediaSessionId(sessionId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const sb = serviceClient();
  if (!sb) {
    return NextResponse.json(
      { error: "media_status_service_unavailable" },
      { status: 503 },
    );
  }

  const { data, error } = await sb
    .from("media_upload_sessions")
    .select("id,owner_user_id,status,processed_bucket,processed_object_key")
    .eq("id", sessionId)
    .eq("owner_user_id", who.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "media_status_service_unavailable" },
      { status: 503 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "media_session_not_available" }, { status: 404 });
  }

  if (
    data.status === "ready" &&
    data.processed_bucket === "social-media-processed" &&
    typeof data.processed_object_key === "string" &&
    data.processed_object_key.startsWith(`sessions/${sessionId}/processed/`)
  ) {
    const mediaUrl = secureMediaPath(sessionId, data.owner_user_id);
    if (!mediaUrl) {
      return NextResponse.json(
        { error: "media_status_service_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { status: "ready", mediaUrl },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (data.status === "rejected" || data.status === "expired") {
    return NextResponse.json(
      { status: data.status },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { status: String(data.status || "processing") },
    { headers: { "cache-control": "no-store" } },
  );
}
