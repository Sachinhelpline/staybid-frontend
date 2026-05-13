import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";



export async function GET() {
  const [users, complaints] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/users?select=id,phone,status`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    }).then((r) => (r.ok ? r.json() : [])),
    fetch(`${SB_URL}/rest/v1/complaints?select=*&priority=eq.high`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    }).then((r) => (r.ok ? r.json() : [])),
  ]);

  // Detect duplicate accounts (same phone with/without +91)
  const phoneMap: Record<string, string[]> = {};
  (users as any[]).forEach((u: any) => {
    const norm = u.phone?.replace(/^\+91/, "");
    if (!norm) return;
    if (!phoneMap[norm]) phoneMap[norm] = [];
    phoneMap[norm].push(u.id);
  });
  const duplicates = Object.entries(phoneMap).filter(([_, ids]) => ids.length > 1);

  const banned = (users as any[]).filter((u: any) => u.status === "banned");

  return NextResponse.json({
    flags: {
      highPriorityComplaints: (complaints as any[]).length,
      duplicateAccounts: duplicates.length,
      bannedUsers: banned.length,
    },
    duplicates: duplicates.map(([phone, ids]) => ({ phone, ids })),
    bannedUsers: banned,
  });
}
