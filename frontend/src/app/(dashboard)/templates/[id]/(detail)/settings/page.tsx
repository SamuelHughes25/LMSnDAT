import { notFound } from "next/navigation";

import { DeleteTemplateButton } from "@/components/delete-template-button";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Template } from "@/lib/types";

// Mirrors courses/[id]/(detail)/settings/page.tsx exactly.
export default async function TemplateSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The layout already fetched this template once, but Server Components
  // don't share fetch results across files without a shared cache() helper
  // (see lib/dal.ts for that pattern elsewhere) — a second no-store fetch
  // here is the simplest correct option, and it's cheap.
  let template: Template;
  try {
    template = await djangoFetch<Template>(`/templates/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <div className="font-medium">More settings</div>
        <p className="mt-1 text-sm text-muted-foreground">
          More settings — like archiving and default assignment recurrence — are coming here soon.
        </p>
      </div>

      <div className="rounded-lg border-2 border-destructive/30 bg-card p-4 shadow-sm">
        <div className="font-medium text-destructive">Danger zone</div>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Permanently delete this template and all of its content. This cannot be undone.
        </p>
        <DeleteTemplateButton
          templateId={template.id}
          templateName={template.name}
          redirectAfter="/templates"
          label="Delete template"
        />
      </div>
    </div>
  );
}
