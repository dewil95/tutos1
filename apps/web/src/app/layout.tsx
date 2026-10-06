import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ascend CRM",
  description: "Deal tracking and one-click lender submissions for Ascend Fund",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <strong>Ascend CRM</strong>
          <nav>
            <a href="/">Deals</a>
            <a href="/deals/new">New deal</a>
            <a href="/settings">Settings</a>
            <form action="/auth/signout" method="post" className="inline">
              <button type="submit" className="link">
                Sign out
              </button>
            </form>
          </nav>
        </header>
        <main className="content">{children}</main>
      </body>
    </html>
  );
}
