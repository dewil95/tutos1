import type { Metadata } from "next";
import type { ReactNode } from "react";
import { currentUser } from "@/server/auth";
import { emailDryRun } from "@/server/env";
import { NavLinks } from "./NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ascend CRM",
  description: "Deal tracking and one-click lender submissions for Ascend Fund",
};

async function signedInUser() {
  try {
    return await currentUser();
  } catch {
    return null; // Supabase not configured yet: render pages without the shell
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await signedInUser();
  const dryRun = emailDryRun();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        {user ? (
          <div className="shell">
            <aside className="sidebar">
              <a className="brand" href="/">
                <span className="brand-mark">A</span>
                <span className="brand-name">
                  Ascend CRM
                  <small>Ascend Fund</small>
                </span>
              </a>
              <NavLinks />
              <div className="sidebar-foot">
                <span
                  className={`mode ${dryRun ? "" : "live"}`}
                  title={
                    dryRun
                      ? "MCA_EMAIL_DRY_RUN is on: emails go to the timeline"
                      : "Emails are sent"
                  }
                >
                  {dryRun ? "Test mode" : "Live sending"}
                </span>
                <span>{user.name}</span>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="link">
                    Sign out
                  </button>
                </form>
              </div>
            </aside>
            <main className="content">{children}</main>
          </div>
        ) : (
          <main className="content">{children}</main>
        )}
      </body>
    </html>
  );
}
