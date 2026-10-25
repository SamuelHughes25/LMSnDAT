"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setUserRole } from "@/app/actions/users";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UserRole } from "@/lib/accounts-types";

// Only two real options now — "admin" and "manager" have been functionally
// identical since permission sets replaced the old fixed role-based access
// (see accounts-types.ts's getUserKindLabel, which already collapses both
// into the one "Office user" label everywhere else in this app). Picking
// "Office user" here writes 'admin'; there's no live path left that still
// needs 'manager' as a distinct value.
const ACCOUNT_TYPE_OPTIONS: { value: "member" | "admin"; label: string }[] = [
  { value: "member", label: "Operative" },
  { value: "admin", label: "Office user" },
];

// Moves a user between the operative and office-user tiers — what
// actually changes is `role`, which (dashboard)/dashboard/page.tsx's own
// home screen branches on directly: an operative always lands on the
// simple "what's assigned to me" view and an office user always lands on
// the admin-style attention overview, regardless of what tabs a
// permission set or Super User grant separately opens up in the sidebar
// (see app-shell.tsx — that part was already independently reversible).
// This is the piece that was still role-locked: promote an operative who's
// stepping up to manage people, or move an office user back down, and
// their actual dashboard home follows.
export function UserAccountTypePicker({ userId, currentRole }: { userId: number; currentRole: UserRole }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const currentValue = currentRole === "member" ? "member" : "admin";

  function handleChange(value: string | null) {
    if (!value) return;
    setError(null);
    startTransition(async () => {
      const result = await setUserRole(userId, value as UserRole);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <Select value={currentValue} onValueChange={handleChange}>
        <SelectTrigger className="mt-1 w-40" disabled={pending}>
          <SelectValue>{() => ACCOUNT_TYPE_OPTIONS.find((o) => o.value === currentValue)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ACCOUNT_TYPE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
