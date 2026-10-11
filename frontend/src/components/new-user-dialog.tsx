"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createUser } from "@/app/actions/users";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PermissionSet, UserRole } from "@/lib/accounts-types";

const NONE_VALUE = "__none__";

// Course/template group membership is no longer picked here — a user can
// belong to any number of each, and that's now managed from their own
// detail page (/users/[id]) rather than a single dropdown at creation
// time. A brand-new user simply starts in no groups.
//
// The old admin/manager/member radio is gone too — an account's
// capabilities now come from a PermissionSet (see /permissions) or the
// is_superuser/is_platform_admin tiers, not a fixed role string. `role`
// itself now only decides "Operative" vs "Office user" (see
// accounts-types.ts's getUserKindLabel) — a cosmetic/organizational
// default, not a hard access boundary any more (an operative can still be
// granted a permission set, same as an office user — see app-shell.tsx's
// unified nav for why that now actually does something). So this asks
// "operative, or office user?" and, either way, which permission set (if
// any) to start them with — both kinds are equally eligible for one now.
export function NewUserDialog({ permissionSets }: { permissionSets: PermissionSet[] }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [permissionSetId, setPermissionSetId] = useState<string>(NONE_VALUE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Resets everything a fresh "New user" click should never see leftover —
  // the dialog content stays mounted while closed (Base UI just hides it),
  // and until now nothing ever cleared username/password/role/error on
  // close/cancel, only on a successful submit — so canceling out and
  // reopening showed whatever was last typed.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setUsername("");
      setPassword("");
      setConfirmPassword("");
      setRole("member");
      setPermissionSetId(NONE_VALUE);
      setError(null);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    // A mistyped password here used to only surface once the created
    // account's own first login failed — reported directly as a real,
    // repeated problem ("i keep making accounts and mistyping the
    // password"). Catching the mismatch right here, before the account is
    // even created, is the actual fix — not a password-strength check,
    // just "did you type the same thing twice."
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createUser(
        username.trim(),
        password,
        role,
        permissionSetId === NONE_VALUE ? null : permissionSetId,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      handleOpenChange(false);
      router.push(`/users/${result.user.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>New user</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm_password">Confirm password</Label>
            <Input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Kind</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger className="w-full">
                <SelectValue>{() => (role === "member" ? "Operative" : "Office user")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Operative</SelectItem>
                <SelectItem value="admin">Office user</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Not gated on `role` any more — an operative is just as
              eligible for a permission set (Manage-side access) as an
              office user is, see this file's own top comment. Both kinds
              get the exact same Templates/Courses "assigned to me" view
              either way; this only ever adds Manage-section access on
              top. */}
          <div className="space-y-2">
            <Label>Permission set</Label>
            <Select value={permissionSetId} onValueChange={(v) => setPermissionSetId(v ?? NONE_VALUE)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {() =>
                    permissionSetId === NONE_VALUE
                      ? "No access yet"
                      : (permissionSets.find((p) => p.id === permissionSetId)?.name ?? "No access yet")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>No access yet</SelectItem>
                {permissionSets.map((permissionSet) => (
                  <SelectItem key={permissionSet.id} value={permissionSet.id}>
                    {permissionSet.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
