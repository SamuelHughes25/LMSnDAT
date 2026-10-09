"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { deleteUser } from "@/app/actions/users";
import { Button } from "@/components/ui/button";

export function DeleteUserButton({ userId, username }: { userId: number; username: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!window.confirm(`Delete "${username}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteUser(userId);
      if (!result.ok) {
        // A blocking alert, not inline text: this cell is a single icon
        // button with no room of its own (unlike course-access-cell.tsx's
        // wider Members-table cell), and failure here — the user still
        // has course/attempt history on record — is rare enough that a
        // plain alert is fine, consistent with the confirm() just above.
        window.alert(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      onClick={handleClick}
      aria-label={`Delete ${username}`}
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
