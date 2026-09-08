import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function enabled(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === "true";
}

export async function GET() {
  const writer = enabled(process.env.MEDIA_SECURE_WRITER_ENABLED);
  if (!writer) {
    return NextResponse.json(
      { mode: "legacy" },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const prereqs =
    enabled(process.env.MEDIA_UPLOAD_SESSION_ENABLED) &&
    enabled(process.env.MEDIA_UPLOAD_OBSERVATION_ENABLED);

  return NextResponse.json(
    { mode: prereqs ? "secure" : "blocked" },
    { headers: { "cache-control": "no-store" } },
  );
}
