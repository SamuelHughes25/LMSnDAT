import { PortalTemplatesView, type PortalTemplateCardData } from "@/components/portal-templates-view";
import { djangoFetch } from "@/lib/django";
import { getVisibleTemplateIds } from "@/lib/role-access";
import type { Paginated, Template, TemplateVersion } from "@/lib/types";

// Mirrors portal/courses/page.tsx exactly: a template only shows here if
// it's in the assigned role's `templates` list (see role-access.ts) — a
// member with no role sees none, not every template that exists. Only
// ones with a published version are fillable — an in-progress draft shows
// as a disabled card instead of being hidden or linked.
export default async function PortalTemplatesPage() {
  const [templates, versions, visibleIds] = await Promise.all([
    djangoFetch<Paginated<Template>>("/templates/"),
    djangoFetch<Paginated<TemplateVersion>>("/template-versions/"),
    getVisibleTemplateIds(),
  ]);

  const publishedTemplateIds = new Set(
    versions.results.filter((v) => v.status === "published").map((v) => v.template),
  );

  const visibleTemplates =
    visibleIds === null ? templates.results : templates.results.filter((template) => visibleIds.has(template.id));

  const items: PortalTemplateCardData[] = visibleTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    href: publishedTemplateIds.has(template.id) ? `/portal/templates/${template.id}` : null,
  }));

  return (
    // No max-w cap — same "use the full width main actually has" fix as
    // portal/courses/page.tsx.
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="mt-1 text-muted-foreground">Pick an audit to fill out.</p>
      </div>

      <PortalTemplatesView
        items={items}
        emptyMessage={
          templates.results.length === 0
            ? "No templates have been created yet."
            : "No templates have been assigned to your role yet."
        }
      />
    </div>
  );
}
