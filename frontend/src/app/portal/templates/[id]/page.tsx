import Link from "next/link";
import { notFound } from "next/navigation";

import { TemplatePreviewViewer } from "@/components/template-preview/template-preview-viewer";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated, Template, TemplateVersion } from "@/lib/types";

// The operative-facing "fill it out" page — mirrors portal/courses/[id]/
// page.tsx's published-only rule: only ever shows the published version,
// never a draft. If there isn't one, the template shouldn't have been
// reachable from the templates list (it renders as a disabled card there).
export default async function PortalTemplateFillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let template: Template;
  try {
    template = await djangoFetch<Template>(`/templates/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  const versions = await djangoFetch<Paginated<TemplateVersion>>(`/template-versions/?template=${id}`);
  const version = versions.results.find((v) => v.status === "published");

  if (!version) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <Link href="/portal/templates" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to templates
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{template.name}</h1>
      </div>

      {version.sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">This template doesn&apos;t have any sections yet.</p>
      ) : (
        <TemplatePreviewViewer sections={version.sections} mode="fill" />
      )}
    </div>
  );
}
