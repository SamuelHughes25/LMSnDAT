"use client";

import type { ComponentProps } from "react";

import { LoginForm } from "@/components/login-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type LoginDialogProps = ComponentProps<typeof DialogTrigger>;

// The site-wide "Login" entry point for the marketing pages: every
// nav/hero Login control renders one of these, so clicking it pops the
// sign-in form up over whatever marketing page is behind it instead of
// navigating away. Closes on a backdrop click or Escape — Base UI's own
// Dialog default, same as every other dialog in this app — revealing that
// same page again underneath.
//
// app/login/page.tsx (the full-page version) still exists on purpose: it's
// what proxy.ts sends an already-signed-in visitor's /login hit onward
// from (straight to /dashboard), and it's still a real, bookmarkable,
// JS-optional fallback.
export function LoginDialog(props: LoginDialogProps) {
  return (
    <Dialog>
      <DialogTrigger {...props} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
        </DialogHeader>
        <LoginForm />
      </DialogContent>
    </Dialog>
  );
}
