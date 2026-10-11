"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteGroup } from "@/app/actions/groups";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

export function DeleteGroupButton({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${groupName}`}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete "${groupName}"?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        destructive
        action={() => deleteGroup(groupId)}
      />
    </>
  );
}
