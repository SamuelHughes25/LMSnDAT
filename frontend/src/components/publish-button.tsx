"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { publishVersion } from "@/app/actions/templates";
import { Button } from "@/components/ui/button";

export function PublishButton({ templateId, versionId }: { templateId: string; versionId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await publishVersion(templateId, versionId);
          router.refresh();
        })
      }
    >
      {pending ? "Publishing…" : "Publish"}
    </Button>
  );
}
