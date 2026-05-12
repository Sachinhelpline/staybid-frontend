"use client";
// ═══════════════════════════════════════════════════════════════════════════
// lib/theme-store.tsx — Single-toggle Light ⇄ Dark theme system (v90)
//
// Goals:
//   • One source of truth for theme state (localStorage `sb_theme`)
//   • Sets `data-theme="dark"` on <html> so every CSS-variable-driven
//     surface flips in one go (defined in app/globals.css)
//   • No FOUC: a tiny inline script in app/layout.tsx runs BEFORE first
//     paint to apply the saved theme; this provider just keeps React state
//     in sync and exposes a setter.
//   • Default: respects `prefers-color-scheme` on first visit, then
//     persists whatever the user explicitly picks.
//
// Usage:
//   const { theme, toggle, setTheme } = useTheme();
//   <button onClick={toggle}>{theme === "dark" ? "🌙" : "☀"}</button>
// ═══════════════════════════════════════════════════════════════════════════
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

type ThemeCtx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const Ctx = createContext<ThemeCtx>({
  theme: "light",
  setTheme: () => {},
  toggle: () => {},
});

const LS_KEY = "sb_theme";

/** Read the resolved theme from <html data-theme> set by the no-FOUC
    bootstrap script in app/layout.tsx. Falls back to "light". */
function readResolved(): Theme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initial state matches whatever the no-FOUC script already painted.
  const [theme, setThemeState] = useState<Theme>("light");

  // Hydrate on mount (we can't read document during SSR).
  useEffect(() => {
    setThemeState(readResolved());
  }, []);

  const apply = useCallback((t: Theme) => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", t);
    // Also update the meta theme-color so Android Chrome / iOS PWA chrome
    // matches the new background instantly.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", t === "dark" ? "#0F0C08" : "#FAF5EB");
    }
    try { localStorage.setItem(LS_KEY, t); } catch {}
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    apply(t);
  }, [apply]);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      apply(next);
      return next;
    });
  }, [apply]);

  // Cross-tab sync — if the user toggles theme in another tab, mirror here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_KEY) return;
      const next = e.newValue === "dark" ? "dark" : "light";
      setThemeState(next);
      apply(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [apply]);

  return (
    <Ctx.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
