#!/usr/bin/env node

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-auth-broker-"));
const config = path.join(TMP, "tsconfig.json");
fs.writeFileSync(config, JSON.stringify({
  compilerOptions: {
    module: "commonjs",
    target: "es2020",
    lib: ["es2020", "dom"],
    skipLibCheck: true,
    rootDir: REPO,
    outDir: TMP,
  },
  files: [path.join(REPO, "lib/auth-broker.ts")],
}));
cp.execFileSync(path.join(REPO, "node_modules/.bin/tsc"), ["-p", config], {
  cwd: REPO,
  stdio: "pipe",
});
const broker = require(path.join(TMP, "lib/auth-broker.js"));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const state = "A".repeat(43);
const source = {};
const credential = {
  idToken: "t".repeat(200),
  user: { uid: "firebase-uid", email: "owner@example.test", name: "Owner", phone: "" },
};

describe("dedicated auth broker origin boundary (actual lib/auth-broker.ts)", () => {
  it("enables only the exact audited broker and opener origins", () => {
    assert.equal(
      broker.isAuthBrokerEnabled("https://auth.staybids.in", "https://staybids.in"),
      true,
    );
    for (const configured of [
      undefined,
      "http://auth.staybids.in",
      "https://auth.staybids.in.evil.test",
      "https://auth.staybids.in/path",
      "https://staybids.in",
    ]) {
      assert.equal(broker.isAuthBrokerEnabled(configured, "https://staybids.in"), false);
    }
    assert.equal(
      broker.isAuthBrokerEnabled("https://auth.staybids.in", "https://preview.example.test"),
      false,
    );
  });

  it("builds a fixed broker URL without accepting arbitrary return origins", () => {
    const url = new URL(broker.buildBrokerUrl("https://auth.staybids.in", state, "google"));
    assert.equal(url.origin, "https://auth.staybids.in");
    assert.equal(url.pathname, "/auth/broker");
    assert.equal(url.searchParams.get("state"), state);
    assert.equal(url.searchParams.get("openerOrigin"), "https://staybids.in");
    assert.equal(url.searchParams.get("provider"), "google");
  });

  it("creates a 256-bit base64url state using Web Crypto only", () => {
    const generated = broker.createBrokerState({
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
        return bytes;
      },
    });
    assert.match(generated, /^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects a broker page request from every wrong origin or malformed state", () => {
    assert.deepEqual(
      broker.validateBrokerRequest(
        "https://auth.staybids.in",
        state,
        "https://staybids.in",
        "google",
      ),
      { state, openerOrigin: "https://staybids.in", provider: "google" },
    );
    assert.equal(broker.validateBrokerRequest("https://evil.test", state, "https://staybids.in", "google"), null);
    assert.equal(broker.validateBrokerRequest("https://auth.staybids.in", "weak", "https://staybids.in", "google"), null);
    assert.equal(broker.validateBrokerRequest("https://auth.staybids.in", state, "https://evil.test", "google"), null);
  });
});

describe("broker result validation and replay boundary (actual lib/auth-broker.ts)", () => {
  const createdAt = 1_000_000;
  const pending = { state, provider: "google", createdAt };
  const message = broker.brokerResultMessage(state, credential);

  it("accepts the exact origin, popup source, state, TTL and credential shape", () => {
    assert.deepEqual(
      broker.validateBrokerMessage(
        "https://auth.staybids.in",
        source,
        source,
        message,
        pending,
        createdAt + 1000,
      ),
      credential,
    );
  });

  it("rejects wrong origin, wrong window source and wrong nonce", () => {
    assert.equal(broker.validateBrokerMessage("https://evil.test", source, source, message, pending, createdAt), null);
    assert.equal(broker.validateBrokerMessage("https://auth.staybids.in", {}, source, message, pending, createdAt), null);
    assert.equal(
      broker.validateBrokerMessage(
        "https://auth.staybids.in",
        source,
        source,
        { ...message, state: "B".repeat(43) },
        pending,
        createdAt,
      ),
      null,
    );
  });

  it("rejects expired/future requests and malformed tokens", () => {
    assert.equal(
      broker.validateBrokerMessage(
        "https://auth.staybids.in",
        source,
        source,
        message,
        pending,
        createdAt + broker.AUTH_BROKER_TTL_MS + 1,
      ),
      null,
    );
    assert.equal(
      broker.validateBrokerMessage(
        "https://auth.staybids.in",
        source,
        source,
        message,
        pending,
        createdAt - 1,
      ),
      null,
    );
    assert.equal(
      broker.validateBrokerMessage(
        "https://auth.staybids.in",
        source,
        source,
        { ...message, idToken: "short" },
        pending,
        createdAt,
      ),
      null,
    );
  });
});
