"use client";

import { useState, useTransition } from "react";

import { adminResetUserPassword } from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Sits next to PlatformAdminToggle on the user detail page, same
// is_superuser-only visibility gate (see UserDetailPage) — the backend's
// own permission is actually broader (anyone with Users tab access can
// already PATCH someone else's password, see adminResetUserPassword's own
// comment), but the super-super-user is the one who actually asked for
// this, specifically to stop locking themselves out of accounts they just
// created by mistyping the password with no second chance to catch it.
// No "current password" field — unlike change-password-form.tsx's
// self-service flow, this is an admin overriding someone ELSE's
// credential, which never required knowing their existing one even
// before this button existed (createUser/the old admin-reset PATCH both
// already worked this way).
export function AdminResetPasswordButton({ userId, username }: { userId: number; username: string }) {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
      setSuccess(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!newPassword) {
      setError("A new password is required.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await adminResetUserPassword(userId, newPassword);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Reset password</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset {username}&apos;s password</DialogTitle>
        </DialogHeader>
        {success ? (
          <>
            <p className="text-sm text-muted-foreground">
              Password changed. Make sure {username} knows their new one — they&apos;ll need it next time they log
              in.
            </p>
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new_password">New password</Label>
              <Input
                id="new_password"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm_new_password">Confirm new password</Label>
              <Input
                id="confirm_new_password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Resetting…" : "Reset password"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
