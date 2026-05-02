import { NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

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
