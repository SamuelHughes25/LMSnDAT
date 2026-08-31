"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { createDraft } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";

export function CreateCourseDraftButton({ courseId }: { courseId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await createDraft(courseId);
          router.refresh();
        })
      }
    >
      {pending ? "Creating…" : "Create draft"}
    </Button>
  );
}
