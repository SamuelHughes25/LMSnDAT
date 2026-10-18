import Link from "next/link";
import { BarChart3, ClipboardCheck, ShieldCheck, Users } from "lucide-react";

import { LoginDialog } from "@/components/marketing/login-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const WHY_IT_MATTERS = [
  {
    icon: ShieldCheck,
    title: "Compliance you can prove",
    body:
      "Safety, regulatory, and onboarding training only counts if you can show who completed it, when, and how well they did. A proper record trail turns training from a box-ticking exercise into real evidence.",
  },
  {
    icon: BarChart3,
    title: "Skills gaps are expensive",
    body:
      "Teams that don't keep their skills current fall behind quietly — in quality, in speed, in safety. Structured, repeatable training is one of the cheapest ways to close that gap before it becomes a real problem.",
  },
  {
    icon: Users,
    title: "Consistency across a growing team",
    body:
      "What one experienced employee knows informally doesn't scale. Turning that knowledge into a course means every new hire — and every existing one — gets the same grounding, not whatever they happened to pick up.",
  },
  {
    icon: ClipboardCheck,
    title: "Engagement, not just completion",
    body:
      "Training that's just a PDF nobody reads doesn't help anyone. Interactive, varied content — the kind people actually engage with — is what makes learning stick instead of just getting marked complete.",
  },
];

export default function MarketingHomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          A simple, effective learning management system for enterprise teams
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground text-balance">
          Build courses, organise your people, and keep a clear record of who&apos;s learned what —
          without the bloat most learning platforms carry around.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <LoginDialog render={<Button size="lg" />}>Login</LoginDialog>
          <Button variant="outline" size="lg" render={<Link href="/platform" />}>
            See our platform
          </Button>
        </div>
      </section>

      {/* Why L&D matters */}
      <section className="border-t border-border bg-muted/20">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight">Why learning &amp; development matters</h2>
            <p className="mt-3 text-muted-foreground">
              Enterprise training isn&apos;t just a compliance checkbox — done well, it&apos;s one of the
              highest-leverage things an organisation can invest in.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {WHY_IT_MATTERS.map(({ icon: Icon, title, body }) => (
              <Card key={title}>
                <CardHeader>
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="mt-2">{title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Platform teaser */}
      <section className="mx-auto max-w-5xl px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Built to stay out of your way</h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
          Author courses with a real visual builder, group your people to match how your organisation
          actually works, and keep everything in one place — with structured audit templates on the way.
        </p>
        <div className="mt-6">
          <Button variant="outline" render={<Link href="/platform" />}>
            Explore the platform
          </Button>
        </div>
      </section>
    </div>
  );
}
