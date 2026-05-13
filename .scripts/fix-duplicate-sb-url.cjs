// Removes the leftover `const SB_URL = "..."` declarations that the
// centralize codemod missed due to CRLF line endings.
// Idempotent: only fires when the file already imports SB_URL from @/lib/sb.
const fs = require("fs");
const path = require("path");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".") && !e.name.startsWith("_")) walk(p, out);
    } else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk("app/api");
const stats = { fixed: 0, alreadyOk: 0 };

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  // Only act on files that import SB_URL from @/lib/sb AND have a local declaration
  const importsLib = /from\s+["']@\/lib\/sb["']/.test(src);
  const localDecl = /^[ \t]*const\s+SB_URL\s*=\s*"https:\/\/uxxhbdqedazpmvbvaosh\.supabase\.co"\s*;[ \t]*\r?\n/m;

  if (!importsLib || !localDecl.test(src)) {
    stats.alreadyOk++;
    continue;
  }

  let after = src.replace(localDecl, "");
  // Collapse 3+ blank lines to 2
  after = after.replace(/\n{3,}/g, "\n\n");
  // Also remove any leftover empty SB_HEADERS-style helper that depended on SB_KEY/SB_URL inline
  // (we leave those alone — the constants are imported now)
  fs.writeFileSync(f, after, "utf8");
  stats.fixed++;
}

console.log(JSON.stringify(stats, null, 2));
