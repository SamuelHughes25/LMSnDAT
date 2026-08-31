"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { deleteCourse } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";

// Two call sites need different post-delete behavior: the course list just
// needs the row to disappear (revalidatePath + router.refresh handles that
// in place), while a course's own page (builder header, settings) would 404
// after its own deletion, so it needs to navigate away first.
export function DeleteCourseButton({
  courseId,
  courseName,
  redirectAfter,
  label,
}: {
  courseId: string;
  courseName: string;
  redirectAfter?: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!window.confirm(`Delete "${courseName}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteCourse(courseId);
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
      aria-label={`Delete ${courseName}`}
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
