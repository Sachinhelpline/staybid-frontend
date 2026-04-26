import { NextResponse } from "next/server";
import { buildSuggestions } from "@/lib/pricing/suggest";

// GET /api/pricing/suggestion/:hotel_id — hotel-owner panel data
export async function GET(_req: Request, { params }: { params: { hotel_id: string } }) {
  try {
    const s = await buildSuggestions(params.hotel_id);
    return NextResponse.json(s);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "suggestion failed" }, { status: 500 });
  }
}
