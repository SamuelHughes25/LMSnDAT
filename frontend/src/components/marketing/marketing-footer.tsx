import Link from "next/link";

import { LoginDialog } from "@/components/marketing/login-dialog";

const FOOTER_LINKS = [
  { href: "/platform", label: "Our Platform" },
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <span>© {new Date().getFullYear()} LMS. All rights reserved.</span>
        <nav className="flex flex-wrap items-center justify-center gap-5">
          {FOOTER_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
          <LoginDialog className="cursor-pointer transition-colors hover:text-foreground">
            Login
          </LoginDialog>
        </nav>
      </div>
    </footer>
  );
}
