import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";

// The public-facing side of this app — home, Our Platform, About Us,
// Contact Us. Deliberately its own route group, sitting alongside
// (dashboard)/portal rather than nested under either: unlike those, these
// pages need no signed-in user at all (no getCurrentUser() call anywhere
// in this tree), so there's nothing here that could 401-redirect a
// first-time visitor straight to /login before they've even seen what the
// product is. "/" itself used to be the signed-in dashboard's own home —
// see (dashboard)/dashboard/page.tsx and app/actions/auth.ts's login
// action for where that moved.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
