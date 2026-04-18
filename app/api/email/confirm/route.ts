import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

interface BookingDetails {
  bookingId: string;
  hotelName: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
  amount: number;
  paymentId?: string;
  city?: string;
}

function buildEmailHtml(d: BookingDetails): string {
  const fmt = (s: string) => {
    try { return new Date(s).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" }); }
    catch { return s; }
  };
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#c9911a 0%,#f0b429 100%);padding:36px 32px;text-align:center;">
      <p style="margin:0 0 4px;color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Booking Confirmed</p>
      <h1 style="margin:0;color:#ffffff;font-size:32px;font-weight:300;letter-spacing:1px;">StayBid</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Your luxury stay is confirmed 🎉</p>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px;">

      <!-- Booking ID chip -->
      <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;padding:18px 24px;text-align:center;margin-bottom:28px;">
        <p style="margin:0 0 4px;color:#92400e;font-size:10px;letter-spacing:3px;text-transform:uppercase;">Booking ID</p>
        <p style="margin:0;color:#1c1917;font-size:22px;font-weight:700;font-family:monospace;letter-spacing:5px;">#${d.bookingId.toUpperCase()}</p>
        ${d.paymentId ? `<p style="margin:6px 0 0;color:#78716c;font-size:11px;">Payment: ${d.paymentId}</p>` : ""}
      </div>

      <!-- Details card -->
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:16px;padding:24px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:10px 0;color:#78716c;font-size:13px;border-bottom:1px solid #f0eeec;">🏨&nbsp; Hotel</td>
            <td style="padding:10px 0;color:#1c1917;font-weight:600;font-size:14px;text-align:right;border-bottom:1px solid #f0eeec;">${d.hotelName}</td>
          </tr>
          ${d.city ? `<tr>
            <td style="padding:10px 0;color:#78716c;font-size:13px;border-bottom:1px solid #f0eeec;">📍&nbsp; City</td>
            <td style="padding:10px 0;color:#1c1917;font-weight:600;font-size:14px;text-align:right;border-bottom:1px solid #f0eeec;">${d.city}</td>
          </tr>` : ""}
          <tr>
            <td style="padding:10px 0;color:#78716c;font-size:13px;border-bottom:1px solid #f0eeec;">🛏&nbsp; Room</td>
            <td style="padding:10px 0;color:#1c1917;font-weight:600;font-size:14px;text-align:right;border-bottom:1px solid #f0eeec;">${d.roomType}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#78716c;font-size:13px;border-bottom:1px solid #f0eeec;">📅&nbsp; Check-in</td>
            <td style="padding:10px 0;color:#1c1917;font-weight:600;font-size:14px;text-align:right;border-bottom:1px solid #f0eeec;">${fmt(d.checkIn)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#78716c;font-size:13px;border-bottom:1px solid #f0eeec;">📅&nbsp; Check-out</td>
            <td style="padding:10px 0;color:#1c1917;font-weight:600;font-size:14px;text-align:right;border-bottom:1px solid #f0eeec;">${fmt(d.checkOut)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#78716c;font-size:13px;border-bottom:1px solid #f0eeec;">🌙&nbsp; Duration</td>
            <td style="padding:10px 0;color:#1c1917;font-weight:600;font-size:14px;text-align:right;border-bottom:1px solid #f0eeec;">${d.nights} night${d.nights > 1 ? "s" : ""}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#78716c;font-size:13px;">👥&nbsp; Guests</td>
            <td style="padding:10px 0;color:#1c1917;font-weight:600;font-size:14px;text-align:right;">${d.guests} guest${d.guests > 1 ? "s" : ""}</td>
          </tr>
        </table>
      </div>

      <!-- Total paid -->
      <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;border-radius:14px;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;">
        <div>
          <p style="margin:0;color:#92400e;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Total Paid</p>
          <p style="margin:4px 0 0;color:#78350f;font-size:28px;font-weight:700;">&#8377;${d.amount.toLocaleString("en-IN")}</p>
        </div>
        <div style="width:56px;height:56px;background:linear-gradient(135deg,#c9911a,#f0b429);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;">✓</div>
      </div>

      <!-- Policy strip -->
      <div style="border-top:1px solid #e7e5e4;padding-top:20px;space-y:8px;">
        <p style="margin:0 0 8px;color:#78716c;font-size:13px;">🕐 Check-in from <strong>12:00 PM</strong> · Check-out by <strong>11:00 AM</strong></p>
        <p style="margin:0 0 8px;color:#78716c;font-size:13px;">🪪 Govt. issued photo ID mandatory at check-in</p>
        <p style="margin:0 0 8px;color:#78716c;font-size:13px;">✅ Free cancellation up to 24 hrs before check-in</p>
        <p style="margin:0;color:#78716c;font-size:13px;">⭐ Earn <strong>${Math.floor(d.amount / 100) * 5} StayPoints</strong> after checkout (₹${Math.floor(d.amount / 100) * 5} value)</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#fafaf9;border-top:1px solid #e7e5e4;padding:24px 32px;text-align:center;">
      <p style="margin:0 0 6px;color:#a8a29e;font-size:12px;">Questions? Email us at <a href="mailto:support@staybids.in" style="color:#c9911a;text-decoration:none;">support@staybids.in</a></p>
      <p style="margin:0;color:#d4c5b0;font-size:11px;">StayBid · Luxury Hotel Bidding Platform · staybids.in</p>
    </div>

  </div>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  const { to, bookingDetails }: { to: string; bookingDetails: BookingDetails } = await req.json();

  if (!to || !bookingDetails) {
    return NextResponse.json({ sent: false, reason: "Missing required fields" }, { status: 400 });
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // SMTP not configured — return success silently so booking is not blocked
    return NextResponse.json({ sent: false, reason: "SMTP not configured" });
  }

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"StayBid" <${user}>`,
    to,
    subject: `Booking Confirmed — ${bookingDetails.hotelName} · #${bookingDetails.bookingId.toUpperCase()}`,
    html: buildEmailHtml(bookingDetails),
  });

  return NextResponse.json({ sent: true });
}
