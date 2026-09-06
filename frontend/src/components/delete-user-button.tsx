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
      await deleteUser(userId);
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
