/**
 * One-time helper: adds the Razorpay env vars to the Vercel project.
 *
 * SAFETY (hotfix v621): this script contains NO credentials. The values are
 * read from YOUR shell environment — NEVER hardcode a secret in this file.
 * Razorpay credentials are environment-only across the app; a committed secret
 * is forbidden.
 *
 * Usage:
 *   RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... NEXT_PUBLIC_RAZORPAY_KEY_ID=... \
 *     node setup-razorpay-vercel.js YOUR_VERCEL_TOKEN
 *
 * Get a Vercel token: https://vercel.com/account/tokens
 */
const https = require("https");

const TOKEN = process.argv[2];
const PROJECT = "prj_xp1BlcRqfrAL1RSGD8eV81FYOMJD"; // staybid-customer-frontend
const TEAM = "team_ulUk1IYy4DFl2C1rJ5WU3kUm";

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const PUBLIC_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || KEY_ID;

if (!TOKEN) {
  console.error("Usage: node setup-razorpay-vercel.js YOUR_VERCEL_TOKEN");
  console.error("Get a token from: https://vercel.com/account/tokens");
  process.exit(1);
}
if (!KEY_ID || !KEY_SECRET) {
  console.error(
    "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your environment before running — " +
      "this script never hardcodes secrets."
  );
  process.exit(1);
}

const ENVS = [
  { key: "RAZORPAY_KEY_ID", value: KEY_ID, type: "encrypted", target: ["production", "preview", "development"] },
  { key: "RAZORPAY_KEY_SECRET", value: KEY_SECRET, type: "encrypted", target: ["production", "preview", "development"] },
  { key: "NEXT_PUBLIC_RAZORPAY_KEY_ID", value: PUBLIC_KEY_ID, type: "plain", target: ["production", "preview", "development"] },
];

async function addEnv(env) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(env);
    const opts = {
      hostname: "api.vercel.com",
      path: `/v10/projects/${PROJECT}/env?teamId=${TEAM}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        const json = JSON.parse(data || "{}");
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log(`✅ ${env.key} added`);
          resolve(json);
        } else if (json.error?.code === "ENV_ALREADY_EXISTS") {
          console.log(`⚡ ${env.key} already exists — skipped`);
          resolve(json);
        } else {
          console.error(`❌ ${env.key} failed: ${JSON.stringify(json.error)}`);
          resolve(json);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  for (const env of ENVS) {
    // eslint-disable-next-line no-await-in-loop
    await addEnv(env);
  }
})();
