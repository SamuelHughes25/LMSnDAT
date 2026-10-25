import { AdminTemplatesView } from "@/components/admin-templates-view";
import { NewTemplateDialog } from "@/components/new-template-dialog";
import { getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import type { Paginated, Template } from "@/lib/types";

export default async function TemplatesPage() {
  const user = await getCurrentUser();
  // Same scoped-visibility shape as (dashboard)/courses/page.tsx — see its
  // comments for the full reasoning.
  const hasFullAccess = user.accessible_tabs.includes("templates");
  const data = await djangoFetch<Paginated<Template>>(hasFullAccess ? "/templates/" : "/templates/?page_size=200");
  const templates = hasFullAccess
    ? data.results
    : data.results.filter((t) => user.manageable_template_ids.includes(t.id));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>
        {hasFullAccess && <NewTemplateDialog />}
      </div>
      <div className="mt-4">
        <AdminTemplatesView templates={templates} />
      </div>
    </div>
  );
}
