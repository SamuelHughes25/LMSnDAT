import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TemplateDetailNav } from "@/components/template-detail-nav";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Template } from "@/lib/types";

// Mirrors courses/[id]/(detail)/layout.tsx exactly — scoped to
// templates/[id]/(detail)/* via the route group so templates/[id]/builder/
// (which sits outside this group) doesn't get this sub-nav on top of its
// own rail and the app's global sidebar.
export default async function TemplateDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let template: Template;
  try {
    template = await djangoFetch<Template>(`/templates/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div>
      <Link
        href="/templates"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to templates
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{template.name}</h1>
        {template.description && <p className="mt-1 text-muted-foreground">{template.description}</p>}
      </div>

      <div className="flex items-start gap-6">
        <TemplateDetailNav templateId={id} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
