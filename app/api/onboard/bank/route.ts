import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { encryptString, last4 } from "@/lib/onboard/crypto";

// GET  /api/onboard/bank?hotelId=...
// POST /api/onboard/bank
export async function GET(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const hotelId = new URL(req.url).searchParams.get("hotelId");
    let q = `user_id=eq.${claims.sub}&order=updated_at.desc&limit=1`;
    if (hotelId) q = `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(hotelId)}&order=updated_at.desc&limit=1`;
    const rows = await sbSelect<any>("bank_details", q);
    const b = rows[0];
    if (!b) return NextResponse.json({ bank: null });
    // Never return the encrypted blob — only safe fields
    return NextResponse.json({
      bank: {
        id: b.id,
        account_holder: b.account_holder,
        account_last4: b.account_last4,
        ifsc: b.ifsc,
        bank_name: b.bank_name,
        branch: b.branch,
        account_type: b.account_type,
        upi_vpa: b.upi_vpa,
        cancelled_cheque_url: b.cancelled_cheque_url,
        verified: b.verified,
      },
    });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "bank fetch failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    const acct = String(body.account_number || "").replace(/\D/g, "");
    if (!body.account_holder || !acct || !body.ifsc) {
      return NextResponse.json({ error: "Account holder, account number and IFSC are required" }, { status: 400 });
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(String(body.ifsc).trim())) {
      return NextResponse.json({ error: "Invalid IFSC format" }, { status: 400 });
    }
    if (acct.length < 6 || acct.length > 20) {
      return NextResponse.json({ error: "Invalid account number length" }, { status: 400 });
    }

    const row: any = {
      user_id: claims.sub,
      hotel_id: body.hotel_id || null,
      account_holder: body.account_holder,
      account_number_enc: encryptString(acct),
      account_last4: last4(acct),
      ifsc: String(body.ifsc).toUpperCase().trim(),
      bank_name: body.bank_name || null,
      branch: body.branch || null,
      account_type: body.account_type || "savings",
      upi_vpa: body.upi_vpa || null,
      cancelled_cheque_url: body.cancelled_cheque_url || null,
      verified: false,
      updated_at: new Date().toISOString(),
    };

    const existing = await sbSelect<any>(
      "bank_details",
      `user_id=eq.${claims.sub}${body.hotel_id ? `&hotel_id=eq.${encodeURIComponent(body.hotel_id)}` : ""}&order=updated_at.desc&limit=1`
    );
    let bank;
    if (existing[0]) {
      const upd = await sbUpdate("bank_details", `id=eq.${existing[0].id}`, row);
      bank = Array.isArray(upd) ? upd[0] : upd;
    } else {
      bank = await sbInsert("bank_details", row);
    }
    return NextResponse.json({
      bank: {
        id: bank.id,
        account_holder: bank.account_holder,
        account_last4: bank.account_last4,
        ifsc: bank.ifsc,
        bank_name: bank.bank_name,
        verified: bank.verified,
      },
    });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "bank save failed" }, { status: 500 });
  }
}
