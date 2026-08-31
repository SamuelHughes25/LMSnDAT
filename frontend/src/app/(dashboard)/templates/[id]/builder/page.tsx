import { notFound } from "next/navigation";

import { TemplateBuilder } from "@/components/builder/template-builder";
import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Paginated, Template, TemplateVersion } from "@/lib/types";

export default async function TemplateBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let template: Template;
  try {
    template = await djangoFetch<Template>(`/templates/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  const versions = await djangoFetch<Paginated<TemplateVersion>>(`/template-versions/?template=${id}`);
  const draft = versions.results.find((v) => v.status === "draft");

  if (!draft) {
    // No draft to edit — nothing for the builder to show. Send them back to
    // create one from the detail page rather than a bare 404.
    notFound();
  }

  return <TemplateBuilder template={template} initialVersion={draft} />;
}
