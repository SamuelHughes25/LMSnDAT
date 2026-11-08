"use client"

import * as React from "react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

// A single app-wide manager, created once at module load — usable
// directly from any plain event handler (e.g. course-access-cell.tsx),
// with no provider/hook needed at the call site: `toastManager.add({...})`.
// <Toaster /> (mounted once, in the root layout) is purely the rendering
// half that actually turns calls to this manager into visible toasts —
// Base UI's own documented shape for firing toasts from outside a
// component's render.
export const toastManager = ToastPrimitive.createToastManager()

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()
  return (
    <>
      {toasts.map((toast) => (
        <ToastPrimitive.Root
          key={toast.id}
          toast={toast}
          className={cn(
            "relative w-full rounded-lg border-2 bg-card p-3 pr-8 text-sm shadow-lg transition-all duration-200 data-starting-style:translate-x-8 data-starting-style:opacity-0 data-ending-style:opacity-0",
            toast.type === "error" ? "border-destructive/40" : "border-border",
          )}
        >
          {toast.title && (
            <ToastPrimitive.Title className="font-medium text-foreground">{toast.title}</ToastPrimitive.Title>
          )}
          {toast.description && (
            <ToastPrimitive.Description className="mt-0.5 text-muted-foreground">
              {toast.description}
            </ToastPrimitive.Description>
          )}
          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="absolute top-2 right-2 rounded-full p-0.5 text-muted-foreground outline-none hover:bg-muted-foreground/20"
          >
            <X className="h-3.5 w-3.5" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
    </>
  )
}

export function Toaster() {
  return (
    <ToastPrimitive.Provider toastManager={toastManager}>
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2 outline-none">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  )
}
