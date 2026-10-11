"use client";

import { useActionState, useState } from "react";

import { changeOwnPassword, type ChangePasswordState } from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Mirrors login-form.tsx's own shape exactly (useActionState over a bare
// credential form) — see changeOwnPassword's own comment for why this
// follows that convention rather than actions/users.ts's usual
// {ok,error}-result + imperative-call pattern.
export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(changeOwnPassword, undefined);
  // Keyed remount clears every field after a successful change — a plain
  // uncontrolled <form action={...}> has no other way to reset its own
  // inputs (there's no imperative form ref/reset call wired up here, and
  // controlled inputs would mean re-deriving each field's value from
  // `state` instead of letting the browser own them), and leaving the old
  // (now stale/wrong) password values sitting in the fields after a
  // success reads as "did this actually work?" Bumped during RENDER (this
  // project's sanctioned alternative to setState-in-an-effect — see
  // app-shell.tsx's identical prevPathname pattern), comparing against
  // the last `state` this component actually saw rather than an effect
  // reacting to `state` changing.
  const [formKey, setFormKey] = useState(0);
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) setFormKey((k) => k + 1);
  }

  return (
    <form key={formKey} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="old_password">Current password</Label>
        <Input id="old_password" name="old_password" type="password" required autoComplete="current-password" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new_password">New password</Label>
        <Input id="new_password" name="new_password" type="password" required autoComplete="new-password" minLength={8} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm_password">Confirm new password</Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
        />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-600">Password changed.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
