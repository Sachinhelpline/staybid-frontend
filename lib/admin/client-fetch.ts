"use client";

export type AdminApiFailure = {
  status: number;
  path: string;
};

type AdminFetchHooks = {
  onUnauthorized?: () => void;
  onFailure?: (failure: AdminApiFailure) => void;
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Returns the request path only for this site's protected admin API.
 * External URLs and lookalike paths such as /api/administrator are rejected,
 * so the admin token can never be forwarded outside the intended boundary.
 */
export function adminRequestPath(input: RequestInfo | URL, origin: string): string | null {
  try {
    const url = new URL(requestUrl(input), origin);
    const isAdminApi = url.pathname === "/api/admin" || url.pathname.startsWith("/api/admin/");
    return url.origin === origin && isAdminApi ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

/**
 * Installs one tightly-scoped fetch wrapper while the authenticated admin
 * layout is mounted. It preserves every caller option/header and adds the
 * verified admin token only to same-origin /api/admin requests.
 */
export function installAdminFetchInterceptor(hooks: AdminFetchHooks = {}): () => void {
  if (typeof window === "undefined") return () => {};

  const previousFetchReference = window.fetch;
  const previousFetch = window.fetch.bind(window) as typeof window.fetch;
  let unauthorizedHandled = false;

  const adminFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = adminRequestPath(input, window.location.origin);
    if (!path) return previousFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    const token = window.localStorage.getItem("sb_admin_token");
    if (token) headers.set("x-admin-token", token);

    const response = input instanceof Request
      ? await previousFetch(new Request(input, { ...init, headers }))
      : await previousFetch(input, { ...init, headers });

    if (response.status === 401 && !unauthorizedHandled) {
      unauthorizedHandled = true;
      // Admin cleanup is intentionally narrower than full logout: a stale
      // admin session must not destroy an unrelated customer session.
      window.localStorage.removeItem("sb_admin_token");
      window.localStorage.removeItem("sb_admin_user");
      hooks.onUnauthorized?.();
    } else if (!response.ok && response.status !== 401) {
      hooks.onFailure?.({ status: response.status, path });
    }

    return response;
  }) as typeof window.fetch;

  window.fetch = adminFetch;
  return () => {
    if (window.fetch === adminFetch) window.fetch = previousFetchReference;
  };
}
