"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createPermissionSet } from "@/app/actions/permission-sets";
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

// Mirrors new-group-dialog.tsx exactly, minus description — a new
// permission set starts with every tab off; toggle them from the table
// afterward (see permission-set-tab-checkbox.tsx), no need to front-load
// that into the creation form itself.
export function NewPermissionSetDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createPermissionSet(name.trim());
        setOpen(false);
        setName("");
        router.refresh();
      } catch {
        setError("Could not create permission set — the name may already be taken.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>New permission set</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New permission set</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="permission-set-name">Name</Label>
            <Input id="permission-set-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
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
