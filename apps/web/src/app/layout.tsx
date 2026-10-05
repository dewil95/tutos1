import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCA CRM",
  description: "AI-native CRM for merchant cash advance brokers",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <strong>MCA CRM</strong>
          <nav>
            <a href="/">Deals</a>
            <a href="/api/health">Health</a>
          </nav>
        </header>
        <main className="content">{children}</main>
      </body>
    </html>
  );
}
