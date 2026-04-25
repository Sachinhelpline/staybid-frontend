// Onboarding JWT — separate secret from customer/partner tokens so we can
// rotate independently. Falls back to a constant in dev (works without env).
import jwt from "jsonwebtoken";

const SECRET =
  process.env.ONBOARD_JWT_SECRET ||
  process.env.JWT_SECRET ||
  "staybid-onboarding-dev-secret-change-in-prod";

export type OnboardClaims = {
  sub: string;          // onboarding_users.id
  email?: string;
  phone?: string;
  role: "owner" | "agent" | "admin";
  emailVerified: boolean;
  phoneVerified: boolean;
};

export function signOnboardToken(claims: OnboardClaims, expiresIn = "30d"): string {
  return jwt.sign(claims, SECRET, { expiresIn } as any);
}

export function verifyOnboardToken(token: string): OnboardClaims {
  return jwt.verify(token, SECRET) as OnboardClaims;
}

export function readBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  return h.replace(/^Bearer\s+/i, "").trim() || null;
}

export function requireOnboardUser(req: Request): OnboardClaims {
  const t = readBearer(req);
  if (!t) throw new Error("UNAUTHORIZED");
  return verifyOnboardToken(t);
}
