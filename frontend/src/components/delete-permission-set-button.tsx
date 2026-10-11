"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { deletePermissionSet } from "@/app/actions/permission-sets";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

export function DeletePermissionSetButton({ permissionSetId, name }: { permissionSetId: string; name: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${name}`}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete "${name}"?`}
        description="Anyone currently assigned this permission set loses the dashboard access it granted — they aren't deleted themselves, just left without it."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        destructive
        action={() => deletePermissionSet(permissionSetId)}
      />
    </>
  );
}
