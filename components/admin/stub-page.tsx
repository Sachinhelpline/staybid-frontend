export default function StubPage({ title, description, icon }: { title: string; description: string; icon: string }) {
  return (
    <div style={{ fontFamily: "DM Sans, sans-serif" }}>
      <h1 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", fontSize: 28, margin: "0 0 20px" }}>
        {title}
      </h1>
      <div
        style={{
          background: "#151820",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 14,
          padding: "60px 40px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 56, marginBottom: 16 }}>{icon}</div>
        <h2 style={{ fontFamily: "Syne, sans-serif", color: "#D4AF37", fontSize: 22, margin: "0 0 8px" }}>
          Coming in Session 2
        </h2>
        <p style={{ color: "#8A8FA8", fontSize: 14, maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
          {description}
        </p>
        <div
          style={{
            display: "inline-block",
            marginTop: 20,
            padding: "8px 18px",
            background: "rgba(212,175,55,0.1)",
            border: "1px solid rgba(212,175,55,0.3)",
            borderRadius: 10,
            color: "#D4AF37",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Scaffold ready · API stub active
        </div>
      </div>
    </div>
  );
}
