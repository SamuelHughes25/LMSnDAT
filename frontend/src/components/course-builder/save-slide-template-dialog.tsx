"use client";

import { useState, useTransition } from "react";
import { HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Slide } from "@/lib/course-types";

// Controlled, no DialogTrigger of its own — opened from the bookmark icon
// button on the canvas (slide-canvas.tsx), same convention as
// save-lesson-dialog.tsx's own trigger in slide-rail.tsx. Works for any
// slide_type, not just freeform content. Saving clones `slide`'s current
// slide_type and config into a brand-new SlideTemplate library entry (see
// backend's SlideTemplate model and services.save_slide_as_template) — a
// one-time snapshot, not a live link, so later edits to this slide never
// change the saved copy.
export function SaveSlideTemplateDialog({
  slide,
  open,
  onOpenChange,
  onSave,
}: {
  slide: Slide;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(slide.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Reset-on-prop-change during render, not an effect — see
  // save-lesson-dialog.tsx's own identical comment for why.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName(slide.title);
      setError(null);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onSave(name.trim());
        onOpenChange(false);
      } catch {
        setError("Could not save this template. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            Add to templates?
            <Tooltip>
              <TooltipTrigger
                render={<button type="button" aria-label="What are templates?" />}
                className="text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent>
                Templates are saved slides you can reuse — title screens, logo dividers, anything you&apos;ll want
                to reproduce exactly. They can hold empty text boxes ready to be filled in, or text and images
                already in place. Save one here, then add it to any lesson from the Add slide menu&apos;s
                Templates list.
              </TooltipContent>
            </Tooltip>
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Saves a copy of this slide to your templates library, so it can be added to any lesson. Editing this
          slide afterward won&apos;t change the saved copy.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="slide-template-name">Name</Label>
            <Input id="slide-template-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
