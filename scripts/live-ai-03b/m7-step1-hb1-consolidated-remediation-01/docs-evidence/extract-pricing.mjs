#!/usr/bin/env node
// Deterministic extractor: parses the embedded pricing rows for gpt-5.6-terra out of the RAW official
// pricing HTML (docs-evidence/pricing.html, sha256 pinned below) and the verbatim service-tier /
// prompt-caching sentences from the raw API-reference / guide HTML. OFFLINE; reads local files only.
import fs from "node:fs"; import { createHash } from "node:crypto"; import path from "node:path"; import { fileURLToPath } from "node:url";
const D = path.dirname(fileURLToPath(import.meta.url));
const sha = (f) => createHash("sha256").update(fs.readFileSync(path.join(D, f))).digest("hex");
const html = fs.readFileSync(path.join(D, "pricing.html"), "utf8").replace(/&quot;/g, '"');
const rows = [...html.matchAll(/\[1,\[\[0,"gpt-5\.6-terra"\],\[0,([0-9.]+)\],\[0,([0-9.]+)\],\[0,([0-9.]+)\],\[0,([0-9.]+)\]/g)].map((m) => m.slice(1).map(Number));
const txt = (f) => fs.readFileSync(path.join(D, f), "utf8");
const find = (f, re) => { const m = txt(f).match(re); return m ? m[0] : null; };
const out = {
  pricing_html_sha256: sha("pricing.html"),
  terra_embedded_rows_in_document_order: rows.map(([i, c, w, o]) => ({ input_usd_per_1m: i, cached_input_usd_per_1m: c, cache_writes_usd_per_1m: w, output_usd_per_1m: o })),
  standard_short_row_present: rows.some((r) => r.join() === "2,0.2,2.5,12"),
  fast_short_row_present: rows.some((r) => r.join() === "4,0.4,5,24"),
  batch_or_flex_short_row_present: rows.some((r) => r.join() === "1,0.1,1.25,6"),
  service_tier_default_sentence: find("create.txt", /If set to ‘default’, then the request will be processed with the standard pricing and performance for the selected model\./),
  service_tier_auto_sentence: find("create.txt", /If set to ‘auto’, then the request will be processed with the service tier configured in the Project settings\./),
  service_tier_omitted_sentence: find("create.txt", /When not set, the default behavior is ‘auto’\./),
  project_fast_default_sentence: find("priority-processing.txt", /Requests that don’t specify a service_tier then default to Fast mode\./),
  cache_write_sentence: find("prompt-caching.txt", /For GPT-5\.6 and later, cache writes cost 1\.25× the standard, uncached input-token rate\./),
  caching_default_sentence: find("prompt-caching.txt", /Prompt caching is enabled by default for supported OpenAI models\./),
  raw_html_sha256: Object.fromEntries(["create.html", "flex-processing.html", "priority-processing.html", "prompt-caching.html", "pricing.html"].map((f) => [f, sha(f)])),
};
const okAll = out.standard_short_row_present && out.service_tier_default_sentence && out.service_tier_omitted_sentence && out.cache_write_sentence && out.caching_default_sentence;
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
process.exit(okAll ? 0 : 1);
