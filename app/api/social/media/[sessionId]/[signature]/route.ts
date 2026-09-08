import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isMediaRefSignature,
  isMediaSessionId,
  verifySecureMediaRef,
} from "@/lib/social/secure-media-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const PROCESSED_BUCKET = "social-media-processed";
const PUBLIC_MODERATION = ["APPROVED", "AUTO_APPROVED"];

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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string; signature: string }> },
) {
  const { sessionId, signature } = await ctx.params;
  if (!isMediaSessionId(sessionId) || !isMediaRefSignature(signature)) {
    return new NextResponse(null, { status: 404 });
  }

  const sb = serviceClient();
  if (!sb) return new NextResponse(null, { status: 503 });

  const { data: session, error: sessionError } = await sb
    .from("media_upload_sessions")
    .select("id,owner_user_id,status,processed_bucket,processed_object_key")
    .eq("id", sessionId)
    .limit(1)
    .maybeSingle();

  if (
    sessionError ||
    !session ||
    !verifySecureMediaRef(sessionId, session.owner_user_id, signature) ||
    session.status !== "ready" ||
    session.processed_bucket !== PROCESSED_BUCKET ||
    typeof session.processed_object_key !== "string" ||
    !session.processed_object_key.startsWith(`sessions/${sessionId}/processed/`)
  ) {
    return new NextResponse(null, { status: 404 });
  }

  // A READY object is still private until an approved social post actually
  // references this exact signed media path. Community PENDING_ADMIN_REVIEW
  // uploads therefore remain non-public even after media processing succeeds.
  const mediaRef = `/api/social/media/${sessionId}/${signature}`;
  const { data: published, error: postError } = await sb
    .from("social_posts")
    .select("id")
    .in("moderation_status", PUBLIC_MODERATION)
    .or(
      `media_url.eq.${mediaRef},thumbnail_url.eq.${mediaRef},sound_url.eq.${mediaRef}`,
    )
    .limit(1);

  if (postError) return new NextResponse(null, { status: 503 });
  if (!Array.isArray(published) || published.length === 0) {
    return new NextResponse(null, { status: 404 });
  }

  const signed = await sb.storage
    .from(PROCESSED_BUCKET)
    .createSignedUrl(session.processed_object_key, 60);

  if (signed.error || !signed.data?.signedUrl) {
    return new NextResponse(null, { status: 503 });
  }

  const res = NextResponse.redirect(signed.data.signedUrl, 302);
  res.headers.set("cache-control", "private, no-store, max-age=0");
  res.headers.set("x-content-type-options", "nosniff");
  return res;
}
