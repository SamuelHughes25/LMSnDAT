"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  // min-w-0 — without it, a flex/grid ancestor (e.g. DialogContent's own
  // grid) lets this grow to fit an oversized child (TabsList, below)
  // instead of constraining it, which is what let the tab strip spill
  // past the dialog's right edge in the first place.
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex min-w-0 flex-col gap-3", className)} {...props} />
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // w-full + overflow-x-auto, not w-fit — several tabs' combined
        // natural width can exceed the available space (confirmed: 6
        // tabs needed ~507px against ~480px available in the permission
        // set dialog), so this scrolls horizontally inside its own box
        // instead of ever bleeding past a narrower container again.
        "flex h-9 w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors data-active:bg-background data-active:text-foreground data-active:shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-panel" className={cn("outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTab, TabsPanel }
