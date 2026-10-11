import { notFound } from "next/navigation";

import { DjangoApiError, djangoFetch } from "@/lib/django";
import type { Template } from "@/lib/types";

// Mirrors courses/[id]/(detail)/settings/page.tsx exactly.
export default async function TemplateSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Only fetched to 404 on a nonexistent template — the layout already
  // fetched this template once for its own display, but Server Components
  // don't share fetch results across files without a shared cache() helper
  // (see lib/dal.ts for that pattern elsewhere), and nothing on this page
  // actually renders the template's own fields any more now that the
  // Danger zone card (the one thing that used to) is gone.
  try {
    await djangoFetch<Template>(`/templates/${id}/`);
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg border-2 border-border bg-card p-4 shadow-sm">
        <div className="font-medium">More settings</div>
        <p className="mt-1 text-sm text-muted-foreground">
          More settings — like default assignment recurrence — are coming here soon.
        </p>
      </div>
    </div>
  );
}
