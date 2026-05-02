"use client";
import React from "react";

export default function Modal({
  children,
  onClose,
  width = 520,
}: {
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        className="admin-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#151820",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16,
          padding: 28,
          width: "100%",
          maxWidth: width,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          fontFamily: "DM Sans, sans-serif",
          color: "#E8EAF0",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Field({ label, value }: { label: string; value: any }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        gap: 12,
      }}
    >
      <span style={{ color: "#8A8FA8", fontSize: 13 }}>{label}</span>
      <span style={{ color: "#E8EAF0", fontSize: 13, fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}
