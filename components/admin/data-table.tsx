"use client";
import { useState } from "react";

interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  width?: string;
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  pageSize?: number;
  emptyMessage?: string;
}

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading,
  pageSize = 10,
  emptyMessage = "No data found",
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(data.length / pageSize);
  const slice = data.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "DM Sans, sans-serif" }}>
          <thead>
            <tr style={{ background: "#0F1117", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    padding: "12px 16px",
                    textAlign: "left",
                    fontSize: 12,
                    color: "#8A8FA8",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    width: col.width,
                    whiteSpace: "nowrap",
                    position: "sticky",
                    top: 0,
                    background: "#0F1117",
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} style={{ padding: "14px 16px" }}>
                      <div
                        style={{
                          height: 16,
                          background: "rgba(255,255,255,0.05)",
                          borderRadius: 6,
                          animation: "pulse 1.5s infinite",
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : slice.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{ padding: 40, textAlign: "center", color: "#8A8FA8", fontSize: 14 }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              slice.map((row, i) => (
                <tr
                  key={i}
                  style={{
                    background: i % 2 === 0 ? "#151820" : "#0F1117",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(212,175,55,0.05)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? "#151820" : "#0F1117";
                  }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        padding: "12px 16px",
                        color: "#E8EAF0",
                        fontSize: 14,
                        verticalAlign: "middle",
                      }}
                    >
                      {col.render ? col.render(row) : String(row[col.key] ?? "-")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 16,
            color: "#8A8FA8",
            fontSize: 13,
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          <span>
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, data.length)} of {data.length}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              style={{
                background: "#151820",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 8,
                color: page === 0 ? "#8A8FA8" : "#E8EAF0",
                cursor: page === 0 ? "default" : "pointer",
                padding: "6px 12px",
                fontSize: 13,
              }}
            >
              ← Prev
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
              const p = Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    background: p === page ? "#D4AF37" : "#151820",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 8,
                    color: p === page ? "#000" : "#E8EAF0",
                    cursor: "pointer",
                    padding: "6px 12px",
                    fontSize: 13,
                    fontWeight: p === page ? 700 : 400,
                  }}
                >
                  {p + 1}
                </button>
              );
            })}
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              style={{
                background: "#151820",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 8,
                color: page >= totalPages - 1 ? "#8A8FA8" : "#E8EAF0",
                cursor: page >= totalPages - 1 ? "default" : "pointer",
                padding: "6px 12px",
                fontSize: 13,
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
