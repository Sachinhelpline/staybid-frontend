import type { ReactNode } from "react";

// v456b — Trade dark-mode wrapper. Scopes the --trd-* token family (globals.css)
// to every Trade route so the browse / tour / my-bids / review pages read
// var(--trd-*) from their inline styles + styled-jsx and flip under
// [data-theme="dark"]. Purely a token scope — no layout/chrome of its own.
export default function TradeLayout({ children }: { children: ReactNode }) {
  return <div className="trd-root">{children}</div>;
}
