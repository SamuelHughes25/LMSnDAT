import Link from "next/link";

import { DeleteTemplateButton } from "@/components/delete-template-button";
import { NewTemplateDialog } from "@/components/new-template-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <div className="mt-4 rounded-lg border-2 border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.results.map((template) => (
              <TableRow key={template.id}>
                <TableCell>
                  <Link href={`/templates/${template.id}`} className="font-medium hover:underline">
                    {template.name}
                  </Link>
                </TableCell>
                <TableCell>{template.description || "—"}</TableCell>
                <TableCell>{new Date(template.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <DeleteTemplateButton templateId={template.id} templateName={template.name} />
                </TableCell>
              </TableRow>
            ))}
            {data.results.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No templates yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
