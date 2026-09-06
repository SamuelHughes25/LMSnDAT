"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { deleteRole } from "@/app/actions/roles";
import { Button } from "@/components/ui/button";

export function DeleteRoleButton({ roleId, roleName }: { roleId: string; roleName: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!window.confirm(`Delete "${roleName}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteRole(roleId);
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      onClick={handleClick}
      aria-label={`Delete ${roleName}`}
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
