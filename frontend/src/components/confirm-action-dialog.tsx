"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ActionResult = { ok: true } | { ok: false; error: string };

// A proper in-app confirm dialog — replaces the browser's native
// window.confirm()/window.alert() (the "localhost says" popups) used
// throughout the admin UI's trash/restore/purge buttons. One reusable
// component rather than copy-pasting this open/pending/error state
// machine into every button: confirm → pending → either closes on
// success (and refreshes, or calls a custom onSuccess) or stays open
// showing the failure instead of a second, separate alert() popup.
//
// `action` may resolve to an {ok,error} result object (the shape every
// archive/restore/purge/delete action in this app already returns) OR
// void (delete-group-button.tsx's deleteGroup, which still just throws on
// failure — an unhandled throw here propagates to the dashboard error
// boundary exactly as it did before, unrelated pre-existing behavior this
// dialog doesn't change).
export function ConfirmActionDialog<TResult extends ActionResult>({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive,
  action,
  onSuccess,
  renderError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  action: () => Promise<TResult | void>;
  // Defaults to router.refresh() — pass this for call sites that need to
  // navigate away instead (e.g. deleting a course from its own settings
  // page, which would otherwise 404 on refresh).
  onSuccess?: () => void;
  // Custom rendering for a failed result — e.g. listing the actual
  // courses/templates that need reassigning, with links to go fix them,
  // instead of just the plain error string. Defaults to that plain string.
  renderError?: (result: Extract<TResult, { ok: false }>) => ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<Extract<TResult, { ok: false }> | null>(null);
  const router = useRouter();

  function handleConfirm() {
    setFailed(null);
    startTransition(async () => {
      const result = await action();
      if (result && !result.ok) {
        setFailed(result as Extract<TResult, { ok: false }>);
        return;
      }
      onOpenChange(false);
      if (onSuccess) onSuccess();
      else router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
        if (!next) setFailed(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {failed && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {renderError ? renderError(failed) : failed.error}
          </div>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button variant={destructive ? "destructive" : "default"} disabled={pending} onClick={handleConfirm}>
            {pending ? (pendingLabel ?? "Working…") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
