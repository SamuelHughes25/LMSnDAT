"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { DeleteTemplateButton } from "@/components/delete-template-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ViewToggle } from "@/components/view-toggle";
import { useViewMode } from "@/lib/use-view-mode";
import type { Template } from "@/lib/types";

const VIEW_STORAGE_KEY = "admin-templates-view";

// Mirrors admin-courses-view.tsx exactly, for templates — see that file's
// own comment. Templates have no thumbnail field (unlike Course), so the
// Normal view's picture slot always shows the same placeholder icon.
export function AdminTemplatesView({ templates }: { templates: Template[] }) {
  const [view, setView] = useViewMode(VIEW_STORAGE_KEY);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ViewToggle view={view} onChange={setView} />
      </div>
      {view === "compact" ? <CompactTable templates={templates} /> : <NormalList templates={templates} />}
    </div>
  );
}

function CompactTable({ templates }: { templates: Template[] }) {
  return (
    <div className="rounded-lg border-2 border-border bg-card shadow-sm">
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
          {templates.map((template) => (
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
          {templates.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No templates yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function NormalList({ templates }: { templates: Template[] }) {
  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No templates yet.</p>;
  }
  return (
    <div className="space-y-3">
      {templates.map((template) => (
        <div
          key={template.id}
          className="flex items-center gap-4 rounded-lg border-2 border-border bg-card p-4 shadow-sm"
        >
          <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
          </div>

          <div className="min-w-0 flex-1">
            <Link href={`/templates/${template.id}`} className="truncate text-lg font-semibold hover:underline">
              {template.name}
            </Link>
            <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{template.description || "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Created {new Date(template.created_at).toLocaleDateString()}
            </p>
          </div>

          <DeleteTemplateButton templateId={template.id} templateName={template.name} />
        </div>
      ))}
    </div>
  );
}
