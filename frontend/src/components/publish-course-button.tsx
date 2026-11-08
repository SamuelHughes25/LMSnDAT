"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { publishVersion } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";

export function PublishCourseButton({ courseId, versionId }: { courseId: string; versionId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await publishVersion(courseId, versionId);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          })
        }
      >
        {pending ? "Publishing…" : "Publish"}
      </Button>
      {error && <p className="max-w-xs text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}
