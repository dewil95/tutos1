import type { ReactNode } from "react";

/** The frame around the merchant's application pages (no company name, only the language switch). */
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
        <span />
        {corner}
      </header>
      <section className={`apply-card${wide ? " wide" : ""}`}>{children}</section>
    </div>
  );
}
