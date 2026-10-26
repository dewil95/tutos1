import type { ReactNode } from "react";

/** Ascend Fund's frame around the merchant's application pages. */
export function ApplyShell({
  lang,
  corner,
  wide,
  children,
}: {
  lang: "en" | "es";
  corner?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="apply-page" lang={lang}>
      <header className="apply-head">
        <span className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">Ascend Fund</span>
        </span>
        {corner}
      </header>
      <section className={`apply-card${wide ? " wide" : ""}`}>{children}</section>
    </div>
  );
}
