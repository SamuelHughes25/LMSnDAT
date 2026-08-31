"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createTemplate } from "@/app/actions/templates";
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
import { Textarea } from "@/components/ui/textarea";

export function NewTemplateDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
        const template = await createTemplate(name.trim(), description.trim());
        setOpen(false);
        setName("");
        setDescription("");
        router.push(`/templates/${template.id}`);
      } catch {
        setError("Could not create template. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>New template</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
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
