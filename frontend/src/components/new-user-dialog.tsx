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
import type { JobRole, UserRole } from "@/lib/accounts-types";

// Sentinel, not an empty string — base-ui's Select treats "" as "no
// selection" internally, so a real "None" option needs its own distinct
// value that's translated back to null right before the server action call.
const NO_ROLE_VALUE = "__none__";

export function NewUserDialog({ roles }: { roles: JobRole[] }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [permission, setPermission] = useState<UserRole>("member");
  const [jobRoleId, setJobRoleId] = useState(NO_ROLE_VALUE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createUser(username.trim(), password, permission, jobRoleId === NO_ROLE_VALUE ? null : jobRoleId);
        setOpen(false);
        setUsername("");
        setPassword("");
        setPermission("member");
        setJobRoleId(NO_ROLE_VALUE);
        router.refresh();
      } catch {
        setError("Could not create user — the username may already be taken.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Permission</Label>
            <Select value={permission} onValueChange={(v) => setPermission(v as UserRole)}>
              <SelectTrigger className="w-full">
                {/* SelectValue needs an explicit formatter or it renders
                    the raw value ("member") instead of a display label —
                    confirmed in a real browser. */}
                <SelectValue>{(value: string) => value.charAt(0).toUpperCase() + value.slice(1)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={jobRoleId} onValueChange={(v) => setJobRoleId(v ?? NO_ROLE_VALUE)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) => (value === NO_ROLE_VALUE ? "None" : (roles.find((r) => r.id === value)?.name ?? "None"))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ROLE_VALUE}>None</SelectItem>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
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
