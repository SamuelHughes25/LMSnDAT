import { BookOpen, ClipboardList, Sparkles, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";

export const metadata = {
  title: "Our Platform — LMS",
};

export default function PlatformPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Our platform</h1>
        <p className="mt-4 text-muted-foreground">
          Simple enough to use without a manual. Capable enough for real enterprise training. Here&apos;s
          what&apos;s live today, and what&apos;s coming next.
        </p>
      </div>

      <div className="mt-14 space-y-10">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Courses</CardTitle>
              <Badge variant="outline" className="ml-auto">
                Available now
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Build courses with a freeform canvas that feels like PowerPoint, or start from a
              ready-made slide layout when you want to move fast. Mix in interactive and graded
              question slides, and learning stops feeling like a PDF nobody reads.
            </p>
            <Collapsible>
              <CollapsibleTrigger className="border-t border-border pt-3 text-foreground">
                See examples
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="space-y-2.5 pt-3 pb-1">
                  <p>
                    <span className="font-medium text-foreground">Assessments — e.g. Gas Safety:</span>{" "}
                    graded question slides score every learner automatically and keep a permanent
                    record of the result.
                  </p>
                  <p>
                    <span className="font-medium text-foreground">
                      Interactive courses — e.g. staff induction:
                    </span>{" "}
                    engaging interactive slides, assigned to the right people with a due date to hit.
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Lessons:</span> save a group of
                    slides once and reuse it across any course, so your core material only has to be
                    built a single time.
                  </p>
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Groups</CardTitle>
              <Badge variant="outline" className="ml-auto">
                Available now
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Structure your organisation once — a site, a department, a trade — then assign courses
              or templates to the whole group instead of one person at a time. Add someone to
              &quot;Warehouse Team&quot; and they inherit everything it already has.
            </p>
            <Collapsible>
              <CollapsibleTrigger className="border-t border-border pt-3 text-foreground">
                See examples
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="space-y-2.5 pt-3 pb-1">
                  <p>
                    <span className="font-medium text-foreground">
                      Groups — e.g. Gas Operatives, Electricians:
                    </span>{" "}
                    give every trade its own courses and templates, assigned to the whole group at once.
                  </p>
                  <p>
                    <span className="font-medium text-foreground">
                      Permission sets — e.g. Manager, Admin, Content Creator:
                    </span>{" "}
                    give each person exactly the dashboard access their role needs, nothing more.
                  </p>
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Templates</CardTitle>
              <Badge variant="secondary" className="ml-auto gap-1">
                <Sparkles className="h-3 w-3" />
                Coming soon
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Structured, repeatable checklists and audits — safety inspections, equipment checks,
              sign-off sheets — built once, filled out consistently. A failed check can automatically
              flag a corrective action, so it&apos;s someone&apos;s job, not just a form sitting
              somewhere. One platform to train your people and verify the work they do.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
