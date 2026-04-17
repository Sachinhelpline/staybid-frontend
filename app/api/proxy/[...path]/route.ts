import { NextRequest, NextResponse } from "next/server";

const BACKEND = "https://staybid-live-production.up.railway.app";

async function handler(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = (await params).path.join("/");
  const target = `${BACKEND}/${path}${req.nextUrl.search}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const auth = req.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;

  const body =
    req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      // 10-second timeout via AbortSignal
      signal: AbortSignal.timeout(10000),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 503 });
  }
}

export const GET     = handler;
export const POST    = handler;
export const PUT     = handler;
export const DELETE  = handler;
export const PATCH   = handler;
