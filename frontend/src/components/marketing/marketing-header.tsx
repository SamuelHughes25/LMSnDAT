import Link from "next/link";

import { LoginDialog } from "@/components/marketing/login-dialog";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

// Deliberately a server component with plain <Link>s, not a client-side
// active-route highlighter — app-shell.tsx's own nav (the authenticated
// app) doesn't bother with that either (see its own TOP_LINKS/MANAGE_LINKS
// comment), and these four public pages are few enough that a visitor
// never needs an "you are here" indicator to find their way around. No
// mobile hamburger menu for the same "keep this genuinely simple" reason —
// four links plus one button wrap cleanly on their own at small widths.
const NAV_LINKS = [
  { href: "/platform", label: "Our Platform" },
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
];

export function MarketingHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        {/* Same bare "LMS" wordmark app-shell.tsx uses for the signed-in
            app's own sidebar — no logo mark, no colour, nothing a future
            white-labelled client portal would need to fight to override.
            That's the deliberate "brandless" look this was asked for. */}
        <Link href="/" className="text-lg font-semibold tracking-tight">
          LMS
        </Link>
        <nav className="flex flex-wrap items-center gap-6">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LoginDialog render={<Button size="sm" />}>Login</LoginDialog>
        </div>
      </div>
    </header>
  );
}
