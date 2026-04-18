/**
 * One-time setup endpoint — hit once after deploy to add flashFloorPrice column.
 * POST /api/admin/setup
 * Safe: uses "ADD COLUMN IF NOT EXISTS" so it won't fail if column already exists
 * and won't wipe any data.
 */
import { NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "sb_publishable_N2tMgg386VuuZcuy-Tpi8A_FLRK_-eE";

export async function POST() {
  // Use Supabase SQL API to add the column safely
  const res = await fetch(`${SB_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "flashFloorPrice" DOUBLE PRECISION;`,
    }),
  });

  if (res.ok) {
    return NextResponse.json({ done: true, message: "flashFloorPrice column added (or already existed)" });
  }

  // Supabase anon key may not allow raw SQL — log and return graceful response
  const err = await res.text();
  return NextResponse.json({
    done: false,
    message: "Could not run migration automatically. Run this SQL in Supabase SQL Editor:",
    sql: `ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "flashFloorPrice" DOUBLE PRECISION;`,
    supabaseError: err,
  });
}

export async function GET() {
  return NextResponse.json({
    message: "Send POST to this endpoint to add flashFloorPrice column to Room table.",
    sql: `ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "flashFloorPrice" DOUBLE PRECISION;`,
    supabaseUrl: "https://supabase.com/dashboard/project/uxxhbdqedazpmvbvaosh/sql/new",
  });
}
