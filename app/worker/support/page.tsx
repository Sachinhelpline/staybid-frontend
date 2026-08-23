"use client";

// Worker Support — raise a ticket + 2-way chat with StayBid HQ (unified HQ Support Desk).
import Link from "next/link";
import SupportDeskPanel from "@/components/support/SupportDeskPanel";

export default function SupportPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px 96px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Link href="/worker/dashboard" style={{ fontSize: 20, color: "#888", textDecoration: "none" }} aria-label="Back">←</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#222", margin: 0 }}>Support</h1>
      </div>
      <SupportDeskPanel
        apiBase="/api/worker/support"
        tokenKey="sb_worker_token"
        accent="#1d4ed8"
        intro="Koi bhi problem yahan ticket raise karein — StayBid HQ team seedha yahin reply karegi."
      />
    </div>
  );
}
