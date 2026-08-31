"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { publishVersion } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";

export function PublishCourseButton({ courseId, versionId }: { courseId: string; versionId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await publishVersion(courseId, versionId);
          router.refresh();
        })
      }
    >
      {pending ? "Publishing…" : "Publish"}
    </Button>
  );
}
