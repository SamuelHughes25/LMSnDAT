"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { createDraft } from "@/app/actions/templates";
import { Button } from "@/components/ui/button";

export function CreateDraftButton({ templateId }: { templateId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await createDraft(templateId);
          router.refresh();
        })
      }
    >
      {pending ? "Creating…" : "Create draft"}
    </Button>
  );
}
