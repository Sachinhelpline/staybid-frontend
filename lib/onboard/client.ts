// Client-side helpers for the onboarding panel.
// Uses localStorage keys distinct from customer (`sb_token`) and partner
// (`sb_partner_token`) to avoid collisions across tabs.

export const ONB_TOKEN_KEY = "sb_onboard_token";
export const ONB_USER_KEY  = "sb_onboard_user";
export const ONB_DRAFT_KEY = "sb_onboard_draft";

export type OnboardUser = {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  role: "owner" | "agent" | "admin";
  emailVerified: boolean;
  phoneVerified: boolean;
  agentCode?: string;
};

export function saveOnboardSession(token: string, user: OnboardUser) {
  localStorage.setItem(ONB_TOKEN_KEY, token);
  localStorage.setItem(ONB_USER_KEY, JSON.stringify(user));
}

export function loadOnboardSession(): { token: string | null; user: OnboardUser | null } {
  if (typeof window === "undefined") return { token: null, user: null };
  const token = localStorage.getItem(ONB_TOKEN_KEY);
  const raw = localStorage.getItem(ONB_USER_KEY);
  return { token, user: raw ? (JSON.parse(raw) as OnboardUser) : null };
}

export function clearOnboardSession() {
  localStorage.removeItem(ONB_TOKEN_KEY);
  localStorage.removeItem(ONB_USER_KEY);
  localStorage.removeItem(ONB_DRAFT_KEY);
}

export async function onbFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = loadOnboardSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as any),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { ...init, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`);
  return j as T;
}
