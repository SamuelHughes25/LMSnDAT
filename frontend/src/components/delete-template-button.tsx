"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteTemplate } from "@/app/actions/templates";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

// Mirrors delete-course-button.tsx exactly — used only from the Templates
// list now (admin-templates-view.tsx); the template's own Settings page
// used to have a second, labeled copy of this in its "Danger zone" card,
// redundant with the list's own trash icon plus the dedicated Archive
// page, so it was removed there.
export function DeleteTemplateButton({ templateId, templateName }: { templateId: string; templateName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${templateName}`}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Archive "${templateName}"?`}
        // "Archive," not "delete" — see delete-course-button.tsx's identical
        // comment; mirrors deleteTemplate's own comment in actions/templates.ts.
        description="It'll be hidden from the template list and the portal, but you can restore it anytime from the Archive section."
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        action={() => deleteTemplate(templateId)}
      />
    </>
  );
}
