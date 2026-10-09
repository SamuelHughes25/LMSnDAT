import Link from "next/link";

import { TemplatePreviewViewer } from "@/components/template-preview/template-preview-viewer";
import { djangoFetch } from "@/lib/django";
import type { Paginated, TemplateVersion } from "@/lib/types";

// Mirrors courses/[id]/(detail)/preview/page.tsx: template existence/404 is
// already handled by the (detail) layout, which fetches the template itself
// — this page only needs the version list.
export default async function TemplatePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // page_size=200 — see courses/[id]/builder/page.tsx's identical fetch.
  const versions = await djangoFetch<Paginated<TemplateVersion>>(`/template-versions/?template=${id}&page_size=200`);
  const sorted = [...versions.results].sort((a, b) => b.version_number - a.version_number);
  const version = sorted.find((v) => v.status === "published") ?? sorted.find((v) => v.status === "draft");

  if (!version || version.sections.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">No content yet — open the builder to add sections.</p>
        <Link href={`/templates/${id}/builder`} className="mt-2 text-sm font-medium text-primary hover:underline">
          Open builder
        </Link>
      </div>
    );
  }

  return <TemplatePreviewViewer sections={version.sections} />;
}
