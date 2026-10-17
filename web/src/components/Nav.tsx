"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Board", match: (p: string) => p === "/" || p.startsWith("/legislator") },
  { href: "/bills", label: "Bills", match: (p: string) => p.startsWith("/bills") || p.startsWith("/bill/") },
  { href: "/method", label: "Method", match: (p: string) => p.startsWith("/method") },
];

// Rendered in the static shell before the pathname is known; Nav replaces it once it streams in.
export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="nav">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} aria-current={pathname && link.match(pathname) ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function Nav() {
  return <NavLinks pathname={usePathname()} />;
}
