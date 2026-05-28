import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

const RAILWAY = "https://staybid-live-production.up.railway.app";

const SB_H    = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

// POST /api/partner/bids/:id — body: { action: "accept"|"counter"|"reject", counterAmount?, message? }
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { action, counterAmount, message } = await req.json();
  const bidId = params.id;

  // Validate inputs early — better errors than a generic "Action failed".
  if (!["accept", "counter", "reject"].includes(action)) {
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  }
  if (action === "counter") {
    const amt = parseFloat(counterAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: "Counter price must be greater than 0" }, { status: 400 });
    }
  }

  // Try Railway first
  let railwayErr = "";
  try {
    const endpoint = action === "accept" ? "accept" : action === "counter" ? "counter" : "reject";
    const body = action === "counter"
      ? JSON.stringify({ counterAmount: parseFloat(counterAmount), message })
      : message ? JSON.stringify({ message }) : "{}";

    const res = await fetch(`${RAILWAY}/api/bids/${bidId}/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return NextResponse.json(await res.json());
    // Capture Railway's error body so the Supabase fallback can include it
    // in the final error response if Supabase also fails.
    railwayErr = (await res.text().catch(() => "")) || `Railway ${res.status}`;
  } catch (e: any) {
    railwayErr = e?.message || "Railway unreachable";
  }

  // Fallback: Supabase direct update — works even when Railway is cold.
  const statusMap: Record<string, string> = { accept: "ACCEPTED", counter: "COUNTER", reject: "REJECTED" };
  const updateData: Record<string, any> = { status: statusMap[action] || "PENDING" };
  if (action === "counter" && counterAmount) updateData.counterAmount = parseFloat(counterAmount);
  if (message) updateData.hotelMessage = message;

  const res = await fetch(`${SB_URL}/rest/v1/bids?id=eq.${bidId}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify(updateData),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "Update failed", supabase: errBody, railway: railwayErr, status: res.status },
      { status: 500 },
    );
  }
  const updated = await res.json().catch(() => []);
  return NextResponse.json({ bid: updated[0] || { id: bidId, ...updateData }, ok: true });
}
