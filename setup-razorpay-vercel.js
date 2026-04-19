/**
 * One-time script: adds Razorpay env vars to Vercel project
 * Usage: node setup-razorpay-vercel.js YOUR_VERCEL_TOKEN
 *
 * Get your token: https://vercel.com/account/tokens
 */
const https = require("https");

const TOKEN   = process.argv[2];
const PROJECT = "prj_xp1BlcRqfrAL1RSGD8eV81FYOMJD"; // staybid-customer-frontend
const TEAM    = "team_ulUk1IYy4DFl2C1rJ5WU3kUm";

if (!TOKEN) {
  console.error("Usage: node setup-razorpay-vercel.js YOUR_VERCEL_TOKEN");
  console.error("Get token from: https://vercel.com/account/tokens");
  process.exit(1);
}

const ENVS = [
  { key: "RAZORPAY_KEY_ID",            value: "rzp_live_SfFAsbYjbHfztd",     type: "encrypted", target: ["production","preview","development"] },
  { key: "RAZORPAY_KEY_SECRET",        value: "dv3xFGG44R2FSqlshkDVY2Gn",    type: "encrypted", target: ["production","preview","development"] },
  { key: "NEXT_PUBLIC_RAZORPAY_KEY_ID",value: "rzp_live_SfFAsbYjbHfztd",     type: "plain",     target: ["production","preview","development"] },
];

async function addEnv(env) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(env);
    const opts = {
      hostname: "api.vercel.com",
      path: `/v10/projects/${PROJECT}/env?teamId=${TEAM}`,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        const json = JSON.parse(data);
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
  console.log("Adding Razorpay env vars to Vercel staybid-customer-frontend...\n");
  for (const env of ENVS) await addEnv(env);
  console.log("\n✅ Done! Trigger a redeploy from Vercel dashboard for changes to take effect.");
  console.log("   Or run: npx vercel --prod --yes\n");
})();
