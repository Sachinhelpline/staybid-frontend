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
