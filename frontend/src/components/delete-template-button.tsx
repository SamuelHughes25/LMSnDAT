"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { deleteTemplate } from "@/app/actions/templates";
import { Button } from "@/components/ui/button";

// Mirrors delete-course-button.tsx exactly: the template list just needs the
// row to disappear (revalidatePath + router.refresh), while a template's own
// page (settings) would 404 after its own deletion, so it needs to navigate
// away first.
export function DeleteTemplateButton({
  templateId,
  templateName,
  redirectAfter,
  label,
}: {
  templateId: string;
  templateName: string;
  redirectAfter?: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!window.confirm(`Delete "${templateName}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteTemplate(templateId);
      if (redirectAfter) {
        router.push(redirectAfter);
      } else {
        router.refresh();
      }
    });
  }

  if (label) {
    return (
      <Button
        variant="outline"
        disabled={pending}
        onClick={handleClick}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="mr-1.5 h-4 w-4" />
        {pending ? "Deleting…" : label}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      onClick={handleClick}
      aria-label={`Delete ${templateName}`}
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
