import { AdminTemplatesView } from "@/components/admin-templates-view";
import { NewTemplateDialog } from "@/components/new-template-dialog";
import { getCurrentUser } from "@/lib/dal";
import { djangoFetch } from "@/lib/django";
import type { Paginated, Template } from "@/lib/types";

// Same strict owner/editor-only visibility as (dashboard)/courses/page.tsx
// — see its comments for the full reasoning. The Templates tab itself was
// NOT part of the sub-permission refinement (that's Users/Courses only,
// for now), so there's no equivalent can_edit_template_* split here — a
// plain editor on a template can already edit everything about it, same
// as before.
export default async function TemplatesPage() {
  const user = await getCurrentUser();
  const isSuperTier = user.is_superuser || user.is_platform_admin;
  const canAccessTemplatesTab = user.accessible_tabs.includes("templates");
  const data = await djangoFetch<Paginated<Template>>(isSuperTier ? "/templates/" : "/templates/?page_size=200");
  const templates = isSuperTier
    ? data.results
    : data.results.filter((t) => user.manageable_template_ids.includes(t.id));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>
        {canAccessTemplatesTab && <NewTemplateDialog />}
      </div>
      <div className="mt-4">
        <AdminTemplatesView templates={templates} />
      </div>
    </div>
  );
}
