import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // field-sizing-fixed (not the original -content): confirmed via a
        // real browser that -content's auto-grow-to-fit-content sizing
        // doesn't respect this element's own w-full/max-w-full constraint
        // when the content is a single long unbroken run of characters (no
        // spaces to wrap at) — the textarea grew wider than its dialog
        // regardless, visibly overflowing past it. -fixed restores the
        // ordinary "wrap at the box's own width, scroll/resize-handle for
        // overflow" behavior every textarea had before this property
        // existed, which can never overflow its container no matter what's
        // typed or pasted into it.
        "flex field-sizing-fixed min-h-16 w-full max-w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base break-words whitespace-pre-wrap transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
