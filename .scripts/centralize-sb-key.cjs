// One-off codemod to centralise the anon-key literal.
// Replaces the v101 inline wrapper with an import from @/lib/sb.
// Safe: only touches files where the exact v101 wrapper is present.
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
const stats = { centralized: 0, alreadyImport: 0, urlRemoved: 0, skipped: [] };

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");

  // The v101 wrapper exact string (multi-line)
  const v101Pattern = /\/\/ v101 — auto-graduate to service-role when env var set, anon otherwise\nconst SB_KEY(\s*=\s*\n?\s+)?(\s*=\s*)?(\s*process\.env\.SUPABASE_SERVICE_ROLE_KEY \|\|\s*\n?\s+)?"eyJ[A-Za-z0-9_.-]+";/;
  const simpleMatch = src.match(v101Pattern);
  if (!simpleMatch) continue;

  let after = src;

  // Remove the v101 inline declaration
  after = after.replace(v101Pattern, "");

  // Remove the SB_URL declaration line too if present
  const urlPattern = /^const SB_URL\s*=\s*"https:\/\/uxxhbdqedazpmvbvaosh\.supabase\.co";\n/m;
  if (urlPattern.test(after)) {
    after = after.replace(urlPattern, "");
    stats.urlRemoved++;
  }

  // Check if @/lib/sb is already imported
  if (/from\s+["']@\/lib\/sb["']/.test(after)) {
    // Add SB_URL + SB_KEY to existing import if missing
    after = after.replace(
      /import\s*\{([^}]+)\}\s*from\s+["']@\/lib\/sb["']/,
      (m, members) => {
        const m2 = members.split(",").map((s) => s.trim()).filter(Boolean);
        if (!m2.includes("SB_URL")) m2.push("SB_URL");
        if (!m2.includes("SB_KEY")) m2.push("SB_KEY");
        return `import { ${m2.join(", ")} } from "@/lib/sb"`;
      }
    );
    stats.alreadyImport++;
  } else {
    // Add a fresh import after the last existing import statement
    const imports = [...after.matchAll(/^import\s+.+?;$/gm)];
    const importLine = `import { SB_URL, SB_KEY } from "@/lib/sb";`;
    if (imports.length) {
      const last = imports[imports.length - 1];
      const idx = (last.index || 0) + last[0].length;
      after = after.slice(0, idx) + "\n" + importLine + after.slice(idx);
    } else {
      after = importLine + "\n" + after;
    }
  }

  // Collapse runs of blank lines (≥3) to single blank
  after = after.replace(/\n{3,}/g, "\n\n");

  fs.writeFileSync(f, after, "utf8");
  stats.centralized++;
}

console.log(JSON.stringify(stats, null, 2));
