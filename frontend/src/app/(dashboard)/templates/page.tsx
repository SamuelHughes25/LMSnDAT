import { AdminTemplatesView } from "@/components/admin-templates-view";
import { NewTemplateDialog } from "@/components/new-template-dialog";
import { djangoFetch } from "@/lib/django";
import type { Paginated, Template } from "@/lib/types";

export default async function TemplatesPage() {
  const data = await djangoFetch<Paginated<Template>>("/templates/");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <NewTemplateDialog />
      </div>
      <div className="mt-4">
        <AdminTemplatesView templates={data.results} />
      </div>
    </div>
  );
}
