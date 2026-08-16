"use client";
import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { peekPendingIntent } from "@/lib/auth-intent";
import { TriangleAlert, ArrowLeft, Gavel, BadgePercent, ShieldCheck } from "lucide-react";
import {
  safeReturnRoute,
  isAdminIntentRoute,
  clearAdminSessionKeys,
  ADMIN_EXCHANGE_FAILED_MSG,
} from "@/lib/auth-return";
import {
  AUTH_BROKER_TTL_MS,
  buildBrokerUrl,
  createBrokerState,
  isAuthBrokerEnabled,
  validateBrokerMessage,
  type BrokerCredential,
  type BrokerIdentity,
  type PendingBrokerAuth,
} from "@/lib/auth-broker";

const API = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";

// v132.12 — Firebase Phone-Auth gate.
// ─────────────────────────────────────────────────────────────────────────
// Firebase's signInWithPhoneNumber requires an enabled billing plan. Until
// the user upgrades the Firebase project, every send-OTP attempt returns
// `auth/billing-not-enabled` and the customer is left staring at an error
// they can't act on.
//
// Sachin (2026-06): "abhi hmara mobile otp kaam nhi kar raha hai — abhi ke
// liye gmail verification ko hi login ke liye access dedo, future ke liye
// mobile otp ko rakhlo." So Mobile OTP is HARD-DISABLED in code right now
// (Google/Gmail is the primary path; WhatsApp OTP + Facebook remain as
// alternatives). The entire Firebase phone-auth flow below — sendFirebaseOtp
// + verify screens + reCAPTCHA setup — is preserved verbatim.
//
// TO RE-ENABLE IN THE FUTURE: change the line below back to
//   const PHONE_OTP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PHONE_OTP === "1";
// and set NEXT_PUBLIC_ENABLE_PHONE_OTP=1 in Vercel, once Firebase phone
// billing is active. No other refactor needed.
const PHONE_OTP_ENABLED = false;

type Screen = "options" | "phone" | "phone-otp" | "whatsapp" | "whatsapp-otp";

// ── SVG Icons ──────────────────────────────────────────────────────────────
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#b0becc" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const FacebookIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#1877F2">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const WhatsAppIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#25D366">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const PhoneIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
  </svg>
);

// v241.3 — useSearchParams() triggers Next 14 static-prerender bailout
// unless wrapped in Suspense. Same pattern as /hotels, /flash-deals,
// /my-bids, /me/posts, /u/[username]/posts (per CLAUDE.md v194 era).
export default function AuthPageRoot() {
  return (
    <Suspense fallback={null}>
      <AuthPage />
    </Suspense>
  );
}

function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  // v241.3 — pending-intent return route. Falls back to "/" when neither
  // the ?return query param nor a stored intent is present (legacy
  // direct-to-/auth visits). Intent's `route` wins over ?return so the
  // saved deep-link with picker payload survives even if the URL got
  // sanitized along the way.
  //
  // v622 — the raw value is ALWAYS passed through safeReturnRoute() before
  // navigation: external / protocol-relative / scheme'd ?return= values
  // collapse to "/" (open-redirect guard), and the sanitized route is what
  // decides admin sign-in intent below.
  const returnRoute = (() => {
    try {
      const fromQuery = searchParams?.get("return");
      if (fromQuery) return safeReturnRoute(fromQuery);
      const intent = peekPendingIntent();
      if (intent?.route) return safeReturnRoute(intent.route);
    } catch {}
    return "/";
  });
  const [screen, setScreen] = useState<Screen>("options");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<any>(null);
  const recaptchaRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (recaptchaRef.current) {
        try { recaptchaRef.current.clear(); } catch {}
        recaptchaRef.current = null;
      }
    };
  }, []);

  // ── After Firebase auth: try backend sync, then fall back to Firebase user ─
  // v622 — ADMIN INTENT FAILS CLOSED. When the (sanitized) return route is an
  // admin destination, the verified backend exchange MUST succeed: on any
  // failure we store NO token at all (neither sb_token nor sb_admin_token),
  // show a clear error, and stay on /auth signed out of admin. A Firebase
  // RS256 token can never pass /api/admin/check-role, and widening the
  // customer fallback to admin flows would be an admin-session bypass.
  // The customer fallback below is UNCHANGED for non-admin destinations.
  const completeLogin = async (idToken: string, identity: BrokerIdentity) => {
    const dest = returnRoute(); // already sanitized (safeReturnRoute)
    const adminIntent = isAdminIntentRoute(dest);
    try {
      // Always use Vercel proxy — avoids ISP/Jio blocks on direct Railway URL.
      // v622 — CLAIM MINIMIZATION: the body carries ONLY the verified idToken.
      // The backend derives every identity fact from the token's verified
      // claims; sending uid/email/name/phone/provider would be dead weight the
      // server ignores, and — critically — a rollback to the old insecure
      // backend that trusted those fields must FAIL CLOSED, not silently trust
      // client-supplied identity. With only idToken present, the old backend
      // rejects (it required `uid`) instead of minting a spoofable session.
      const res = await fetch("/api/proxy/api/auth/social-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          login(data.token, data.user, "backend");
          // v241.3 — return to the deep-link the user was on before
          // the auth gate, not the home page.
          router.push(dest);
          return;
        }
      }
    } catch {}

    if (adminIntent) {
      // Fail closed: no Firebase-token fallback for an admin sign-in intent,
      // and NO new session token is written. We proactively clear ONLY the
      // admin-session keys (sb_admin_token / sb_admin_user) so a failed
      // exchange can never leave a stale admin session behind. An existing
      // CUSTOMER session (sb_token / sb_user / sb_token_type) is deliberately
      // PRESERVED — a failed admin sign-in must not sign a customer out.
      clearAdminSessionKeys();
      setError(ADMIN_EXCHANGE_FAILED_MSG);
      return;
    }

    // Fallback: store Firebase token — tagged "firebase" so booking actions show inline phone verify
    login(idToken, {
      id: identity.uid,
      name: identity.name || identity.phone || "Guest",
      email: identity.email,
      phone: identity.phone,
      role: "customer",
    }, "firebase");
    router.push(dest);
  };

  const syncAndLogin = async (firebaseUser: any, _provider: string) => {
    await completeLogin(await firebaseUser.getIdToken(), {
      uid: firebaseUser.uid,
      name: firebaseUser.displayName || "",
      email: firebaseUser.email || "",
      phone: firebaseUser.phoneNumber || "",
    });
  };

  const runBrokerGoogleSignIn = async (): Promise<BrokerCredential> => {
    const configured = process.env.NEXT_PUBLIC_AUTH_BROKER_ORIGIN;
    if (!isAuthBrokerEnabled(configured, window.location.origin)) {
      throw new Error("broker-disabled");
    }
    const state = createBrokerState();
    const url = buildBrokerUrl(configured, state, "google");
    if (!url) throw new Error("broker-invalid");

    const pending: PendingBrokerAuth = { state, provider: "google", createdAt: Date.now() };
    const popup = window.open(
      url,
      "staybid-auth-broker",
      "popup=yes,width=520,height=720,resizable=yes,scrollbars=yes",
    );
    if (!popup) throw new Error("broker-popup-blocked");

    return await new Promise<BrokerCredential>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, credential?: BrokerCredential) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timeout);
        window.clearInterval(closedCheck);
        try { if (!popup.closed) popup.close(); } catch {}
        if (credential) resolve(credential);
        else reject(error || new Error("broker-failed"));
      };
      const onMessage = (event: MessageEvent) => {
        const credential = validateBrokerMessage(
          event.origin,
          event.source,
          popup,
          event.data,
          pending,
        );
        if (credential) finish(undefined, credential);
      };
      window.addEventListener("message", onMessage);
      const timeout = window.setTimeout(
        () => finish(new Error("broker-timeout")),
        AUTH_BROKER_TTL_MS,
      );
      const closedCheck = window.setInterval(() => {
        try {
          if (popup.closed) finish(new Error("broker-closed"));
        } catch {}
      }, 500);
    });
  };

  // ── v620 — Bulletproof provider sign-in ────────────────────────────────────
  // Diagnosis of the field reports ("Please wait… stuck" / "cookies popup" /
  // "first attempt fails, second works"):
  //   • authDomain is the CROSS-ORIGIN staybid-6feb7.firebaseapp.com. The
  //     popup flow hands the result back through an iframe on that domain;
  //     Chrome's third-party-storage partitioning both (a) shows users the
  //     confusing cookies permission prompt and (b) makes the first handoff
  //     flaky — a cold auth iframe throws network-request-failed/internal-error
  //     or never resolves. Second attempt: Google session is warm → instant.
  //     (The 100% kill for the cookies prompt is the same-origin auth proxy —
  //     see lib/firebase.ts + docs/PENDING-GOOGLE-AUTH-SAME-ORIGIN.md.)
  //   • The old code had NO timeout around signInWithPopup → a lost popup
  //     result (common in the installed TWA/PWA, where the popup opens a
  //     Custom Tab) left the page on "Please wait…" forever.
  //   • There was NO getRedirectResult handler, no retry, and raw Firebase
  //     error strings were shown to customers.
  // This helper fixes all of it: 25s timeout → popup can never hang; ONE
  // automatic quick retry on transient first-attempt errors (the "do baar
  // karna padta hai" becomes automatic); popup-impossible environments
  // (in-app browsers, popup-blocked, timeout) fall back to a full-page
  // signInWithRedirect whose result is completed by the mount effect below;
  // and errors are mapped to clean human copy.
  const POPUP_TIMEOUT_MS = 25000;

  const isInAppBrowser = () => {
    // Instagram / Facebook / WhatsApp / Line in-app webviews (Android marker
    // "; wv"). Google blocks OAuth popups in these — go straight to redirect.
    // (The installed TWA is real Chrome and does NOT match these markers.)
    try {
      const ua = navigator.userAgent || "";
      return /FBAN|FBAV|Instagram|Line\/|WhatsApp|; wv\)/i.test(ua);
    } catch { return false; }
  };

  const friendlyAuthError = (code: string, label: string) => {
    if (code === "auth/account-exists-with-different-credential")
      return "This email is already registered with a different sign-in method — please try Google.";
    if (code === "auth/network-request-failed")
      return "Network issue — please check your connection and tap the button once more.";
    if (code === "auth/too-many-requests")
      return "Too many attempts — please wait a minute and try again.";
    if (code === "auth/unauthorized-domain")
      return "Sign-in isn't allowed from this address. Please open staybids.in and try again.";
    return `${label} sign-in didn't complete. Please tap the button once more.`;
  };

  const runProviderSignIn = async (kind: "google" | "facebook") => {
    setLoading(true);
    setError("");
    const label = kind === "google" ? "Google" : "Facebook";
    try {
      const brokerConfigured =
        kind === "google" &&
        isAuthBrokerEnabled(process.env.NEXT_PUBLIC_AUTH_BROKER_ORIGIN, window.location.origin);
      if (brokerConfigured) {
        try {
          const credential = await runBrokerGoogleSignIn();
          await completeLogin(credential.idToken, credential.user);
        } catch {
          setError("Secure Google sign-in did not complete. Please close any sign-in window and try again.");
        }
        return;
      }

      const { firebaseAuth } = await import("@/lib/firebase");
      const { signInWithPopup, signInWithRedirect, GoogleAuthProvider, FacebookAuthProvider } =
        await import("firebase/auth");
      const provider = kind === "google" ? new GoogleAuthProvider() : new FacebookAuthProvider();

      // v622 — For an ADMIN sign-in intent, force the Google account chooser
      // (prompt=select_account). Otherwise a browser already warm with a
      // personal customer Google session signs the owner straight back into
      // the WRONG account with no chance to pick the admin one, and the admin
      // exchange then fails. Google-only; ignored by Facebook.
      if (kind === "google" && isAdminIntentRoute(returnRoute())) {
        try { (provider as any).setCustomParameters?.({ prompt: "select_account" }); } catch {}
      }

      const doRedirect = async () => {
        // Flag survives the round-trip so the mount effect knows to finish it.
        try { sessionStorage.setItem("sb_auth_redirect", kind); } catch {}
        await signInWithRedirect(firebaseAuth, provider);
      };

      if (isInAppBrowser()) { await doRedirect(); return; }

      // Popup with a hard timeout — it must never hang the screen forever.
      const attempt = () =>
        Promise.race([
          signInWithPopup(firebaseAuth, provider),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(Object.assign(new Error("popup timeout"), { code: "sb/popup-timeout" })), POPUP_TIMEOUT_MS)
          ),
        ]);

      try {
        const result = await attempt();
        await syncAndLogin(result.user, kind);
        return;
      } catch (e: any) {
        let code = e?.code || "";
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
          // User dismissed it (or superseded it with a second tap) — silent.
          return;
        }
        if (code === "auth/network-request-failed" || code === "auth/internal-error") {
          // Transient cold-iframe failure — retry once automatically, fast
          // enough to stay inside the browser's transient-activation window.
          await new Promise((r) => setTimeout(r, 450));
          try {
            const result = await attempt();
            await syncAndLogin(result.user, kind);
            return;
          } catch (e2: any) { code = e2?.code || code; }
        }
        if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment" || code === "sb/popup-timeout") {
          // This environment can't do popups — full-page redirect instead.
          try { await doRedirect(); return; } catch {}
        }
        setError(friendlyAuthError(code, label));
      }
    } catch {
      setError(friendlyAuthError("", label));
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = () => runProviderSignIn("google");
  const signInWithFacebook = () => runProviderSignIn("facebook");

  // ── v620 — Complete a redirect round-trip (the popup fallback path). ───────
  // Without this, any signInWithRedirect result was silently DROPPED on
  // return. The sessionStorage flag written before redirecting tells us a
  // trip is in flight; authStateReady() waits for Firebase to restore the
  // session even when getRedirectResult itself returns null (the partitioned-
  // storage browsers where the handoff cookie was lost).
  useEffect(() => {
    let pending = "";
    try { pending = sessionStorage.getItem("sb_auth_redirect") || ""; } catch {}
    if (pending !== "google" && pending !== "facebook") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { firebaseAuth } = await import("@/lib/firebase");
        const { getRedirectResult } = await import("firebase/auth");
        const result = await getRedirectResult(firebaseAuth).catch(() => null);
        try { sessionStorage.removeItem("sb_auth_redirect"); } catch {}
        if (cancelled) return;
        if (result?.user) { await syncAndLogin(result.user, pending); return; }
        // Fallback: the session may still have been restored locally.
        try { await (firebaseAuth as any).authStateReady?.(); } catch {}
        if (!cancelled && firebaseAuth.currentUser) {
          await syncAndLogin(firebaseAuth.currentUser, pending);
        }
      } catch {
        try { sessionStorage.removeItem("sb_auth_redirect"); } catch {}
        if (!cancelled) setError(friendlyAuthError("", pending === "google" ? "Google" : "Facebook"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Send OTP via Firebase (Mobile) ─────────────────────────────────────────
  const sendFirebaseOtp = async () => {
    // v132.12 — Defensive gate. The button rendering this handler is
    // already hidden when PHONE_OTP_ENABLED is false, but a stale URL
    // hash / deep link / dev-tools poke could still land a user on the
    // phone screen. Surface a clean message instead of letting Firebase
    // throw `auth/billing-not-enabled`.
    if (!PHONE_OTP_ENABLED) {
      setError("Mobile OTP is unavailable. Please continue with Google, Facebook, or WhatsApp OTP.");
      setScreen("options");
      return;
    }
    if (phone.length < 10) return setError("Please enter a 10-digit number.");
    setLoading(true);
    setError("");
    try {
      const { firebaseAuth } = await import("@/lib/firebase");
      const { signInWithPhoneNumber, RecaptchaVerifier } = await import("firebase/auth");
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", { size: "invisible" });
      }
      const result = await signInWithPhoneNumber(firebaseAuth, `+91${phone}`, recaptchaRef.current);
      setConfirmationResult(result);
      setScreen("phone-otp");
    } catch (e: any) {
      setError(e.message || "Failed to send OTP. Please try again.");
      recaptchaRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  // ── Verify Firebase OTP ────────────────────────────────────────────────────
  const verifyFirebaseOtp = async () => {
    if (otp.length < 6) return setError("Please enter the 6-digit OTP.");
    if (!confirmationResult) return setError("OTP session expired — please resend.");
    setLoading(true);
    setError("");
    try {
      const result = await confirmationResult.confirm(otp);
      await syncAndLogin(result.user, "phone");
    } catch {
      setError("Incorrect or expired OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Send OTP via Backend (WhatsApp) ────────────────────────────────────────
  const sendWhatsAppOtp = async () => {
    if (phone.length < 10) return setError("Please enter a 10-digit number.");
    setLoading(true);
    setError("");
    try {
      await api.sendOtp(phone.startsWith("+91") ? phone : `+91${phone}`);
      setScreen("whatsapp-otp");
    } catch (e: any) {
      setError(e.message || "Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Verify Backend OTP (WhatsApp) ──────────────────────────────────────────
  const verifyWhatsAppOtp = async () => {
    if (otp.length < 4) return setError("Please enter your OTP.");
    setLoading(true);
    setError("");
    try {
      const data = await api.verifyOtp(phone.startsWith("+91") ? phone : `+91${phone}`, otp);
      login(data.token || data.accessToken, data.user);
      // v241.3 — return to the deep-link / pending-intent route.
      router.push(returnRoute());
    } catch (e: any) {
      setError(e.message || "Incorrect OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setError("");
    setOtp("");
    if (screen === "phone-otp") { setScreen("phone"); setConfirmationResult(null); }
    else if (screen === "whatsapp-otp") setScreen("whatsapp");
    else { setScreen("options"); setPhone(""); }
  };

  const ErrorBox = () => error ? (
    <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
      <TriangleAlert size={16} strokeWidth={2.4} aria-hidden className="text-red-400 mt-0.5 shrink-0" />
      <p className="text-sm text-red-600 leading-relaxed">{error}</p>
    </div>
  ) : null;

  const Brand = ({ subtitle }: { subtitle: string }) => (
    <div className="text-center mb-8">
      {/* v495 — official StayBid gold monogram + metallic serif wordmark. */}
      <div className="flex justify-center mb-5">
        <span className="sb-logo-mark" style={{ width: 64, height: 64 }} aria-hidden>
          <img src="/brand/staybid-mark.png" alt="StayBid" width={64} height={64} decoding="async" />
        </span>
      </div>
      <h1 className="sb-wordmark text-4xl mb-1.5">StayBid</h1>
      <p className="text-luxury-400 text-sm tracking-wide">{subtitle}</p>
    </div>
  );

  return (
    <div className="auth-root lux-bg min-h-[88vh] flex items-stretch">
      <div id="recaptcha-container" />
      {/* v693 — desktop split-screen: a brand pane fills the empty desktop space
          beside the form (was a lonely ~480px centred column on a 1440–1920px
          screen). Hidden below lg; the form pane stays centred on mobile exactly
          as before. Presentation only — NO auth logic touched. */}
      <aside className="auth-brandpane" aria-hidden="true">
        <div className="auth-brandpane-inner">
          <div className="auth-brandpane-logo">StayBid</div>
          <h2 className="auth-brandpane-tag">Name your price.<br />Hotels compete.</h2>
          <p className="auth-brandpane-sub">India&apos;s first reverse-auction hotel platform — bid on premium stays and let hotels compete for your booking.</p>
          <ul className="auth-brandpane-list">
            <li><Gavel size={18} aria-hidden /><span>Place a bid — hotels counter in real time</span></li>
            <li><BadgePercent size={18} aria-hidden /><span>Save up to 40% vs public rates</span></li>
            <li><ShieldCheck size={18} aria-hidden /><span>Secure payments · instant confirmation</span></li>
          </ul>
        </div>
      </aside>
      <div className="auth-formpane">
      <div className="w-full max-w-sm">

        {/* ── OPTIONS SCREEN ── */}
        {screen === "options" && (
          <>
            <Brand subtitle="Sign in to your account" />
            <div className="au-card rounded-3xl p-6 space-y-3">

              {/* Primary login — Google (Gmail). Mobile OTP is temporarily
                  unavailable, so Google is the fastest, recommended way in.
                  Rendered as the gold hero CTA so it reads as THE path. */}
              <button onClick={signInWithGoogle} disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-4 rounded-2xl bg-white border-2 border-gold-300 shadow-gold hover:bg-gold-50 transition-all duration-200 text-sm font-semibold text-luxury-900 disabled:opacity-50">
                <GoogleIcon />
                <span>Continue with Google</span>
              </button>
              <p className="text-center text-[11px] text-luxury-400 -mt-1">
                Fastest & recommended — sign in with your Gmail
              </p>

              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-luxury-100" />
                <span className="text-xs text-luxury-300 tracking-wider">OR</span>
                <div className="flex-1 h-px bg-luxury-100" />
              </div>

              <button onClick={signInWithFacebook} disabled={loading}
                className="w-full flex items-center gap-3 px-4 py-3.5 border border-luxury-200 rounded-2xl hover:bg-blue-50 transition-all duration-200 text-sm font-medium text-luxury-800 disabled:opacity-50">
                <FacebookIcon />
                <span className="flex-1 text-left">Continue with Facebook</span>
              </button>

              <button onClick={() => { setError(""); setPhone(""); setScreen("whatsapp"); }} disabled={loading}
                className="w-full flex items-center gap-3 px-4 py-3.5 border border-green-200 bg-green-50 rounded-2xl hover:bg-green-100 transition-all duration-200 text-sm font-medium text-green-800 disabled:opacity-50">
                <WhatsAppIcon />
                <span className="flex-1 text-left">Login with WhatsApp OTP</span>
              </button>

              {/* v132.12 — Mobile OTP button rendered only when
                  NEXT_PUBLIC_ENABLE_PHONE_OTP=1. The Firebase project
                  needs a paid billing plan for signInWithPhoneNumber to
                  work; until then this button stays hidden so users
                  don't hit `auth/billing-not-enabled` errors. The
                  WhatsApp OTP button above remains the phone-based
                  fallback (routes through Railway, not Firebase). */}
              {PHONE_OTP_ENABLED && (
                <button onClick={() => { setError(""); setPhone(""); setScreen("phone"); }} disabled={loading}
                  className="w-full flex items-center gap-3 px-4 py-3.5 btn-luxury rounded-2xl text-sm font-medium text-white disabled:opacity-50">
                  <PhoneIcon />
                  <span className="flex-1 text-left">Login with Mobile OTP</span>
                </button>
              )}

              {loading && <p className="text-center text-xs text-luxury-400 pt-1">Please wait…</p>}
              <ErrorBox />
            </div>
            <p className="text-center text-xs text-luxury-300 mt-6 tracking-wide">
              By continuing, you agree to StayBid's Terms of Service.
            </p>
          </>
        )}

        {/* ── MOBILE OTP — ENTER PHONE ── */}
        {screen === "phone" && (
          <>
            <Brand subtitle="Enter your mobile number" />
            <div className="au-card rounded-3xl p-6">
              <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-luxury-400 hover:text-luxury-700 mb-5 transition-colors">
                <ArrowLeft size={13} strokeWidth={2.4} aria-hidden /> Back
              </button>
              <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gold-50 border border-gold-200 mb-5 mx-auto">
                <PhoneIcon />
              </div>
              <h2 className="text-center font-display text-xl text-luxury-800 mb-1">Mobile OTP</h2>
              <p className="text-center text-xs text-luxury-400 mb-5">We'll send a one-time code via SMS</p>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">Mobile Number</label>
              <div className="flex gap-2 mb-5">
                <span className="px-3 py-3 bg-luxury-50 border border-luxury-200 rounded-xl text-sm font-medium text-luxury-600 shrink-0">+91</span>
                <input type="tel" value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit number" className="input-luxury text-sm"
                  maxLength={10} inputMode="numeric" autoFocus />
              </div>
              <button onClick={sendFirebaseOtp} disabled={loading || phone.length < 10}
                className="btn-luxury w-full py-3.5 rounded-2xl text-sm disabled:opacity-40">
                {loading ? "Sending OTP…" : "Send OTP"}
              </button>
              <ErrorBox />
            </div>
          </>
        )}

        {/* ── MOBILE OTP — VERIFY ── */}
        {screen === "phone-otp" && (
          <>
            <Brand subtitle={`OTP sent to +91 ${phone}`} />
            <div className="au-card rounded-3xl p-6">
              <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-luxury-400 hover:text-luxury-700 mb-5 transition-colors">
                <ArrowLeft size={13} strokeWidth={2.4} aria-hidden /> Change number
              </button>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">Enter 6-Digit OTP</label>
              <input type="text" value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="• • • • • •"
                className="input-luxury text-center text-2xl tracking-[0.5em] font-bold mb-5"
                maxLength={6} inputMode="numeric" autoFocus />
              <button onClick={verifyFirebaseOtp} disabled={loading || otp.length < 6}
                className="btn-luxury w-full py-3.5 rounded-2xl text-sm disabled:opacity-40 mb-3">
                {loading ? "Verifying…" : "Verify & Login"}
              </button>
              <button onClick={goBack} className="w-full py-2 text-sm text-luxury-400 hover:text-luxury-700 transition-colors">
                Didn't receive OTP? Resend
              </button>
              <ErrorBox />
            </div>
          </>
        )}

        {/* ── WHATSAPP OTP — ENTER PHONE ── */}
        {screen === "whatsapp" && (
          <>
            <Brand subtitle="Enter your WhatsApp number" />
            <div className="au-card rounded-3xl p-6">
              <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-luxury-400 hover:text-luxury-700 mb-5 transition-colors">
                <ArrowLeft size={13} strokeWidth={2.4} aria-hidden /> Back
              </button>
              <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-green-50 border border-green-200 mb-5 mx-auto">
                <WhatsAppIcon />
              </div>
              <h2 className="text-center font-display text-xl text-green-700 mb-1">WhatsApp OTP</h2>
              <p className="text-center text-xs text-luxury-400 mb-5">We'll send a one-time code to your WhatsApp</p>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">WhatsApp Number</label>
              <div className="flex gap-2 mb-5">
                <span className="px-3 py-3 bg-green-50 border border-green-200 rounded-xl text-sm font-medium text-green-700 shrink-0 flex items-center gap-1">
                  <WhatsAppIcon /> +91
                </span>
                <input type="tel" value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit number" className="input-luxury text-sm"
                  maxLength={10} inputMode="numeric" autoFocus />
              </div>
              <button onClick={sendWhatsAppOtp} disabled={loading || phone.length < 10}
                className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white transition-all duration-200 disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #25D366, #128C7E)" }}>
                {loading ? "Sending OTP…" : "Send WhatsApp OTP"}
              </button>
              <ErrorBox />
            </div>
          </>
        )}

        {/* ── WHATSAPP OTP — VERIFY ── */}
        {screen === "whatsapp-otp" && (
          <>
            <Brand subtitle={`OTP sent to +91 ${phone}`} />
            <div className="au-card rounded-3xl p-6">
              <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-luxury-400 hover:text-luxury-700 mb-5 transition-colors">
                <ArrowLeft size={13} strokeWidth={2.4} aria-hidden /> Change number
              </button>
              <div className="flex items-center justify-center gap-2 mb-5">
                <WhatsAppIcon />
                <span className="text-sm text-green-700 font-medium">Check your WhatsApp for the OTP</span>
              </div>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">Enter OTP</label>
              <input type="text" value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="• • • • • •"
                className="input-luxury text-center text-2xl tracking-[0.5em] font-bold mb-5"
                maxLength={6} inputMode="numeric" autoFocus />
              <button onClick={verifyWhatsAppOtp} disabled={loading || otp.length < 4}
                className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white mb-3 transition-all duration-200 disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #25D366, #128C7E)" }}>
                {loading ? "Verifying…" : "Verify & Login"}
              </button>
              <button onClick={goBack} className="w-full py-2 text-sm text-luxury-400 hover:text-luxury-700 transition-colors">
                Didn't receive OTP? Resend
              </button>
              <ErrorBox />
            </div>
          </>
        )}

      </div>
      </div>
    </div>
  );
}
