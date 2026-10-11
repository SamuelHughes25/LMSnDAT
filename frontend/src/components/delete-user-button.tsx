"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteUser } from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";

export function DeleteUserButton({
  userId,
  username,
  disableSelf,
}: {
  userId: number;
  username: string;
  // True for the viewer's own row in the Users list — the backend already
  // refuses this regardless (UserViewSet.destroy's own self-delete guard),
  // but a button that's clickable and then always fails reads as broken,
  // not as "not allowed." Greyed out instead, with a title explaining why,
  // same "disabled, not hidden" treatment as the move-up/move-down arrows
  // at a layer's own top/bottom in slide-layers-panel.tsx.
  disableSelf?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (disableSelf) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        disabled
        aria-label={`Can't delete your own account`}
        title="You can't delete your own account"
        className="text-muted-foreground"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${username}`}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Archive "${username}"?`}
        // "Archive," not "delete" — this now deactivates the account and
        // moves it to the Archive section rather than destroying anything;
        // see deleteUser's own comment in actions/users.ts.
        description="They'll be logged out and hidden from the Users list, but you can restore them anytime from the Archive section."
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        action={() => deleteUser(userId)}
      />
    </>
  );
}
