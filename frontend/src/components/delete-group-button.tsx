"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { deleteGroup } from "@/app/actions/groups";
import { Button } from "@/components/ui/button";

export function DeleteGroupButton({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!window.confirm(`Delete "${groupName}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteGroup(groupId);
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      onClick={handleClick}
      aria-label={`Delete ${groupName}`}
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
