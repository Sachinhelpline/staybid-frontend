// CSV export utility for admin tables
export function toCSV(rows: any[], columns: { key: string; label: string; map?: (v: any, row: any) => any }[]) {
  if (!rows.length) return columns.map((c) => quote(c.label)).join(",") + "\n";
  const header = columns.map((c) => quote(c.label)).join(",");
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const raw = c.map ? c.map(r[c.key], r) : r[c.key];
          return quote(raw == null ? "" : String(raw));
        })
        .join(",")
    )
    .join("\n");
  return header + "\n" + body + "\n";
}

function quote(s: string) {
  if (s == null) return "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportRows(filename: string, rows: any[], columns: { key: string; label: string; map?: (v: any, row: any) => any }[]) {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCSV(`${filename}-${stamp}.csv`, toCSV(rows, columns));
}

// v126.2 — PDF export. Renders the dataset as a printable HTML page in a
// hidden iframe and triggers the browser's "Save as PDF" via window.print().
// Pure-CSS solution: no external PDF library, works offline.
export function toPrintableHTML(
  title: string,
  rows: any[],
  columns: { key: string; label: string; map?: (v: any, row: any) => any }[],
): string {
  const headerHtml = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
  const bodyHtml = rows
    .map((r) => {
      const cells = columns
        .map((c) => {
          const raw = c.map ? c.map(r[c.key], r) : r[c.key];
          return `<td>${escapeHtml(raw == null ? "—" : String(raw))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — StayBid Admin</title>
<style>
  @page { size: A4 landscape; margin: 14mm 10mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; margin: 0; padding: 0; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { font-size: 13px; color: #b8871a; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; }
  h1 { margin: 4px 0 0; font-size: 22px; font-weight: 700; }
  .meta { color: #6b7280; font-size: 11px; text-align: right; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f5f1e6; color: #4a3208; text-align: left; padding: 8px 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #c9911a; }
  td { padding: 6px 10px; border-bottom: 1px solid #f0ebe1; vertical-align: top; word-break: break-word; }
  tr:nth-child(even) td { background: #fafaf7; }
  .ftr { margin-top: 18px; color: #6b7280; font-size: 10px; display: flex; justify-content: space-between; border-top: 1px solid #f0ebe1; padding-top: 8px; }
  @media print { .no-print { display: none } }
</style>
</head>
<body>
  <div class="hdr">
    <div>
      <div class="brand">StayBid Admin</div>
      <h1>${escapeHtml(title)}</h1>
    </div>
    <div class="meta">
      Generated ${escapeHtml(new Date().toLocaleString("en-IN"))}<br/>
      ${rows.length.toLocaleString("en-IN")} rows · ${columns.length} columns
    </div>
  </div>
  <table>
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${bodyHtml || `<tr><td colspan="${columns.length}" style="text-align:center;padding:24px;color:#6b7280">No data</td></tr>`}</tbody>
  </table>
  <div class="ftr">
    <span>StayBid · staybids.in</span>
    <span>Confidential — internal use only</span>
  </div>
</body>
</html>`;
}

function escapeHtml(s: any): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

export function exportPDF(
  filename: string,
  title: string,
  rows: any[],
  columns: { key: string; label: string; map?: (v: any, row: any) => any }[],
) {
  if (typeof window === "undefined") return;
  const html = toPrintableHTML(title, rows, columns);
  // Use a hidden iframe so the print dialog targets the report, not the
  // surrounding admin page. The user picks "Save as PDF" in the system
  // print dialog → file saved with the suggested filename.
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "-10000px";
  iframe.style.bottom = "-10000px";
  iframe.style.width = "1024px";
  iframe.style.height = "768px";
  iframe.style.border = "0";
  iframe.title = filename;
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  // Wait for the iframe's stylesheet to settle before printing.
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {}
    // Clean up a few seconds later — give Chrome time to render the preview.
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch {}
    }, 1500);
  }, 250);
}

// v126.2 — Share API. Falls back to clipboard + WhatsApp/email deep-link if
// the browser doesn't support navigator.share or it's invoked outside a
// user gesture.
export async function shareRows(opts: {
  filename: string;
  title: string;
  description?: string;
  rows: any[];
  columns: { key: string; label: string; map?: (v: any, row: any) => any }[];
  format?: "csv" | "pdf";
}): Promise<{ ok: boolean; via: string }> {
  if (typeof window === "undefined") return { ok: false, via: "ssr" };
  const stamp = new Date().toISOString().slice(0, 10);
  const ext = opts.format === "pdf" ? "pdf" : "csv";
  const name = `${opts.filename}-${stamp}.${ext}`;
  const csvText = toCSV(opts.rows, opts.columns);
  // Try Web Share Level 2 (file share) — Android Chrome, iOS Safari 15+
  try {
    const blob = new Blob([(ext === "csv" ? "﻿" : "") + csvText], { type: ext === "csv" ? "text/csv" : "text/html" });
    const file = new File([blob], name, { type: blob.type });
    if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
      await (navigator as any).share({ files: [file], title: opts.title, text: opts.description || "" });
      return { ok: true, via: "share-file" };
    }
    // Level 1 share (text only) — pass a snippet
    if (typeof (navigator as any).share === "function") {
      const snippet = `${opts.title}\n${opts.description || ""}\n${opts.rows.length} rows`;
      await (navigator as any).share({ title: opts.title, text: snippet });
      // Trigger download alongside so user has the file too
      downloadCSV(name, csvText);
      return { ok: true, via: "share-text+download" };
    }
  } catch {
    // user cancelled or share rejected — fall through to manual share row
  }
  // No native share — download + open a chooser
  downloadCSV(name, csvText);
  return { ok: true, via: "download-only" };
}

// Build platform-specific share URLs (called by Reports UI for the share menu).
export function shareLinks(title: string, description = ""): {
  whatsapp: string;
  email: string;
  telegram: string;
  copy: string;
} {
  const text = `${title}\n${description}`;
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(description)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent("https://staybids.in")}&text=${encodeURIComponent(text)}`,
    copy: text,
  };
}
