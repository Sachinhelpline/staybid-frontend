"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AUTH_BROKER_OPENER_ORIGIN,
  AUTH_BROKER_ORIGIN,
  brokerResultMessage,
  validateBrokerRequest,
} from "@/lib/auth-broker";

const SESSION_KEY = "sb_auth_broker_request";

type StoredRequest = {
  state: string;
  openerOrigin: string;
  provider: "google";
};

export default function AuthBrokerPageRoot() {
  return (
    <Suspense fallback={null}>
      <AuthBrokerPage />
    </Suspense>
  );
}

function AuthBrokerPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Preparing secure Google sign-in…");

  useEffect(() => {
    let cancelled = false;

    const fail = (message: string) => {
      if (!cancelled) setStatus(message);
    };

    (async () => {
      const request = validateBrokerRequest(
        window.location.origin,
        searchParams.get("state"),
        searchParams.get("openerOrigin"),
        searchParams.get("provider"),
      );
      if (!request || window.location.origin !== AUTH_BROKER_ORIGIN) {
        fail("This authentication request is not valid.");
        return;
      }

      const { firebaseAuth } = await import("@/lib/firebase");
      const { getRedirectResult, GoogleAuthProvider, signInWithRedirect } =
        await import("firebase/auth");

      let stored: StoredRequest | null = null;
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        stored = raw ? JSON.parse(raw) : null;
      } catch {}

      if (stored) {
        try { sessionStorage.removeItem(SESSION_KEY); } catch {}
        if (
          stored.state !== request.state ||
          stored.openerOrigin !== AUTH_BROKER_OPENER_ORIGIN ||
          stored.provider !== "google"
        ) {
          fail("The authentication request expired. Please close this window and try again.");
          return;
        }

        const result = await getRedirectResult(firebaseAuth).catch(() => null);
        try { await firebaseAuth.authStateReady(); } catch {}
        const user = result?.user || firebaseAuth.currentUser;
        if (!user) {
          fail("Google sign-in did not complete. Please close this window and try again.");
          return;
        }
        if (!window.opener) {
          fail("StayBid is no longer available. Please close this window and try again.");
          return;
        }

        const message = brokerResultMessage(request.state, {
          idToken: await user.getIdToken(),
          user: {
            uid: user.uid,
            email: user.email || "",
            name: user.displayName || "",
            phone: user.phoneNumber || "",
          },
        });
        if (!message) {
          fail("Google sign-in could not be verified. Please close this window and try again.");
          return;
        }
        window.opener.postMessage(message, AUTH_BROKER_OPENER_ORIGIN);
        if (!cancelled) {
          setStatus("Sign-in complete. Returning to StayBid…");
          window.close();
        }
        return;
      }

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(request));
      } catch {
        fail("Secure browser storage is unavailable. Please close this window and try again.");
        return;
      }
      setStatus("Opening Google account chooser…");
      await signInWithRedirect(firebaseAuth, provider).catch(() => {
        try { sessionStorage.removeItem(SESSION_KEY); } catch {}
        fail("Google sign-in could not start. Please close this window and try again.");
      });
    })().catch(() => fail("Google sign-in could not start. Please close this window and try again."));

    return () => { cancelled = true; };
  }, [searchParams]);

  return (
    <main className="min-h-screen bg-[#FAF5EB] flex items-center justify-center p-6">
      <section className="w-full max-w-sm rounded-3xl border border-[#d8c7aa] bg-white p-7 text-center shadow-xl">
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-[#111827] text-white grid place-items-center text-xl">SB</div>
        <h1 className="text-xl font-semibold text-[#1f2937]">StayBid secure sign-in</h1>
        <p className="mt-3 text-sm leading-6 text-[#667085]" aria-live="polite">{status}</p>
      </section>
    </main>
  );
}
