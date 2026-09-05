import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { djangoFetch } from "@/lib/django";
import type { Paginated, Template, TemplateVersion } from "@/lib/types";

// Mirrors portal/courses/page.tsx exactly: every operative sees every
// template (no assignment-by-job-role yet), but only ones with a published
// version are fillable — an in-progress draft shows as a disabled card
// instead of being hidden or linked.
export default async function PortalTemplatesPage() {
  const [templates, versions] = await Promise.all([
    djangoFetch<Paginated<Template>>("/templates/"),
    djangoFetch<Paginated<TemplateVersion>>("/template-versions/"),
  ]);

  const publishedTemplateIds = new Set(
    versions.results.filter((v) => v.status === "published").map((v) => v.template),
  );

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="mt-1 text-muted-foreground">Pick an audit to fill out.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.results.map((template) => {
          const isFillable = publishedTemplateIds.has(template.id);
          const card = (
            <Card className={isFillable ? "h-full transition-colors hover:bg-muted/40" : "h-full opacity-60"}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{template.name}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-2 text-sm text-muted-foreground">{template.description || " "}</p>
                {!isFillable && (
                  <Badge variant="outline" className="mt-2">
                    Not yet published
                  </Badge>
                )}
              </CardContent>
            </Card>
          );

          return isFillable ? (
            <Link key={template.id} href={`/portal/templates/${template.id}`}>
              {card}
            </Link>
          ) : (
            <div key={template.id}>{card}</div>
          );
        })}
        {templates.results.length === 0 && (
          <p className="text-sm text-muted-foreground">No templates have been created yet.</p>
        )}
      </div>
    </div>
  );
}
