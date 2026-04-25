import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";

// GET /api/verify/list?role=customer|partner&id=...
// role=customer  → all requests where customer_id=id
// role=partner   → all requests where hotel_id IN (the partner's hotel ids)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const role = url.searchParams.get("role");
    const id = url.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ requests: [] });
    let q = "";
    if (role === "customer") q = `customer_id=eq.${id}&order=created_at.desc&limit=100`;
    else if (role === "partner") {
      // id is comma-separated list of hotel ids
      const hotelIds = id.split(",").filter(Boolean).join(",");
      q = `hotel_id=in.(${hotelIds})&order=created_at.desc&limit=100`;
    } else return NextResponse.json({ error: "role required" }, { status: 400 });

    const requests = await sbSelect<any>("vp_requests", q);
    return NextResponse.json({ requests });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "list failed" }, { status: 500 });
  }
}
