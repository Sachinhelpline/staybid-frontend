import { NextResponse } from "next/server";
import crypto from "crypto";
import jwt from "jsonwebtoken";

// TEMPORARY diagnostic — remove after debugging.
export async function GET() {
  const SECRET =
    process.env.ONBOARD_JWT_SECRET ||
    process.env.JWT_SECRET ||
    "staybid-onboarding-dev-secret-change-in-prod";
  const hash = crypto.createHash("sha256").update(SECRET).digest("hex").slice(0, 12);
  // Try signing + verifying inside the same request to confirm round-trip
  let roundTrip = "fail";
  try {
    const t = jwt.sign({ sub: "diag" }, SECRET, { expiresIn: "60s" } as any);
    const v = jwt.verify(t, SECRET) as any;
    if (v.sub === "diag") roundTrip = "ok";
  } catch (e: any) { roundTrip = `err: ${e.message}`; }
  return NextResponse.json({
    secretLen: SECRET.length,
    secretHash12: hash,
    hasOnboardEnv: !!process.env.ONBOARD_JWT_SECRET,
    hasJwtEnv: !!process.env.JWT_SECRET,
    roundTrip,
    nodeEnv: process.env.NODE_ENV,
  });
}
