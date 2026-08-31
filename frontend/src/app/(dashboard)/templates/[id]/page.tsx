import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateDraftButton } from "@/components/create-draft-button";
import { PublishButton } from "@/components/publish-button";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated, Template, TemplateVersion } from "@/lib/types";

const STATUS_VARIANT: Record<TemplateVersion["status"], "default" | "secondary" | "outline"> = {
  draft: "secondary",
  published: "default",
  archived: "outline",
};

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let template: Template;
  try {
    template = await djangoFetch<Template>(`/templates/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  const versions = await djangoFetch<Paginated<TemplateVersion>>(`/template-versions/?template=${id}`);
  const sorted = [...versions.results].sort((a, b) => b.version_number - a.version_number);
  const draft = sorted.find((v) => v.status === "draft");
  const published = sorted.find((v) => v.status === "published");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{template.name}</h1>
        {template.description && <p className="mt-1 text-muted-foreground">{template.description}</p>}
      </div>

      <div className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <div>
          <div className="font-medium">Draft</div>
          <div className="text-sm text-muted-foreground">
            {draft ? `Version ${draft.version_number}` : "No draft in progress."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draft ? (
            <>
              <Button variant="outline" size="sm" render={<Link href={`/templates/${id}/builder`} />}>
                Open builder
              </Button>
              <PublishButton templateId={id} versionId={draft.id} />
            </>
          ) : (
            <CreateDraftButton templateId={id} />
          )}
        </div>
      </div>

      <div className="rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <div className="font-medium">Published</div>
        <div className="text-sm text-muted-foreground">
          {published
            ? `Version ${published.version_number}${published.published_at ? ` · published ${new Date(published.published_at).toLocaleDateString()}` : ""}`
            : "Not published yet."}
        </div>
      </div>

      {sorted.length > 0 && (
        <div>
          <div className="mb-2 font-medium">All versions</div>
          <ul className="space-y-1.5">
            {sorted.map((version) => (
              <li key={version.id} className="flex items-center gap-2 text-sm">
                <span>v{version.version_number}</span>
                <Badge variant={STATUS_VARIANT[version.status]}>{version.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
