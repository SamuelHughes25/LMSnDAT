import { redirect } from "next/navigation";

// This page's own content (the operative welcome screen) moved to "/" —
// see (dashboard)/page.tsx's OperativeDashboard, now reached by every
// account through the same unified "Dashboard" nav item (app-shell.tsx).
// This route stays only as a redirect, for anyone with an old bookmark or
// a stray link still pointing at "/portal" specifically.
export default function PortalIndexRedirect() {
  redirect("/");
}
