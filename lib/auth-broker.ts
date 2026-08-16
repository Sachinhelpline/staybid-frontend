export const AUTH_BROKER_ORIGIN = "https://auth.staybids.in";
export const AUTH_BROKER_OPENER_ORIGIN = "https://staybids.in";
export const AUTH_BROKER_MESSAGE = "staybid:auth-broker-result";
export const AUTH_BROKER_TTL_MS = 2 * 60 * 1000;

const STATE_RE = /^[A-Za-z0-9_-]{43}$/;

export type BrokerProvider = "google";

export type BrokerIdentity = {
  uid: string;
  email: string;
  name: string;
  phone: string;
};

export type BrokerCredential = {
  idToken: string;
  user: BrokerIdentity;
};

export type PendingBrokerAuth = {
  state: string;
  provider: BrokerProvider;
  createdAt: number;
};

type BrokerMessage = {
  type: typeof AUTH_BROKER_MESSAGE;
  state: string;
  idToken: string;
  user: BrokerIdentity;
};

export function configuredBrokerOrigin(raw: unknown): string | null {
  if (raw !== AUTH_BROKER_ORIGIN) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.origin !== AUTH_BROKER_ORIGIN ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAuthBrokerEnabled(configured: unknown, currentOrigin: unknown): boolean {
  return (
    configuredBrokerOrigin(configured) === AUTH_BROKER_ORIGIN &&
    currentOrigin === AUTH_BROKER_OPENER_ORIGIN
  );
}

export function createBrokerState(cryptoImpl: Pick<Crypto, "getRandomValues"> = crypto): string {
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function isValidBrokerState(value: unknown): value is string {
  return typeof value === "string" && STATE_RE.test(value);
}

export function buildBrokerUrl(
  configured: unknown,
  state: string,
  provider: BrokerProvider,
): string | null {
  const origin = configuredBrokerOrigin(configured);
  if (!origin || !isValidBrokerState(state) || provider !== "google") return null;
  const url = new URL("/auth/broker", origin);
  url.searchParams.set("state", state);
  url.searchParams.set("openerOrigin", AUTH_BROKER_OPENER_ORIGIN);
  url.searchParams.set("provider", provider);
  return url.toString();
}

export function validateBrokerRequest(
  currentOrigin: unknown,
  state: unknown,
  openerOrigin: unknown,
  provider: unknown,
): { state: string; openerOrigin: string; provider: BrokerProvider } | null {
  if (
    currentOrigin !== AUTH_BROKER_ORIGIN ||
    openerOrigin !== AUTH_BROKER_OPENER_ORIGIN ||
    provider !== "google" ||
    !isValidBrokerState(state)
  ) return null;
  return { state, openerOrigin, provider };
}

function isIdentity(value: unknown): value is BrokerIdentity {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.uid === "string" && user.uid.length > 0 && user.uid.length <= 256 &&
    typeof user.email === "string" && user.email.length <= 320 &&
    typeof user.name === "string" && user.name.length <= 256 &&
    typeof user.phone === "string" && user.phone.length <= 64
  );
}

export function validateBrokerMessage(
  eventOrigin: unknown,
  eventSource: unknown,
  expectedSource: unknown,
  data: unknown,
  pending: PendingBrokerAuth,
  now = Date.now(),
): BrokerCredential | null {
  if (
    eventOrigin !== AUTH_BROKER_ORIGIN ||
    !eventSource ||
    eventSource !== expectedSource ||
    !isValidBrokerState(pending.state) ||
    pending.provider !== "google" ||
    !Number.isFinite(pending.createdAt) ||
    now < pending.createdAt ||
    now - pending.createdAt > AUTH_BROKER_TTL_MS ||
    !data ||
    typeof data !== "object"
  ) return null;

  const message = data as Partial<BrokerMessage>;
  if (
    message.type !== AUTH_BROKER_MESSAGE ||
    message.state !== pending.state ||
    typeof message.idToken !== "string" ||
    message.idToken.length < 100 ||
    message.idToken.length > 20000 ||
    !isIdentity(message.user)
  ) return null;

  return { idToken: message.idToken, user: message.user };
}

export function brokerResultMessage(
  state: string,
  credential: BrokerCredential,
): BrokerMessage | null {
  if (
    !isValidBrokerState(state) ||
    typeof credential.idToken !== "string" ||
    credential.idToken.length < 100 ||
    credential.idToken.length > 20000 ||
    !isIdentity(credential.user)
  ) return null;
  return {
    type: AUTH_BROKER_MESSAGE,
    state,
    idToken: credential.idToken,
    user: credential.user,
  };
}
