"use client";

import { usePathname } from "next/navigation";

const icons = {
  deals: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="1.75" y="2.75" width="3.5" height="10.5" rx="1" />
      <rect x="6.25" y="2.75" width="3.5" height="7" rx="1" />
      <rect x="10.75" y="2.75" width="3.5" height="4.5" rx="1" />
    </svg>
  ),
  new: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 5v6M5 8h6" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" />
      <circle cx="11" cy="4.5" r="1.5" />
      <circle cx="5" cy="11.5" r="1.5" />
    </svg>
  ),
};

const LINKS = [
  {
    href: "/",
    label: "Deals",
    icon: icons.deals,
    match: (p: string) => p === "/" || (p.startsWith("/deals/") && p !== "/deals/new"),
  },
  {
    href: "/deals/new",
    label: "New deal",
    icon: icons.new,
    match: (p: string) => p === "/deals/new",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: icons.settings,
    match: (p: string) => p.startsWith("/settings"),
  },
];

export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>
          {l.icon}
          <span>{l.label}</span>
        </a>
      ))}
    </nav>
  );
}
