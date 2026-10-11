"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { grantPlatformAdmin, revokePlatformAdmin } from "@/app/actions/users";
import { Button } from "@/components/ui/button";

// Grant/revoke the "super user" (is_platform_admin) tier — full access to
// every tab, but revocable, unlike the one permanently-protected
// is_superuser account. The page itself only renders this when the
// VIEWER is is_superuser (see UserDetailPage) — the backend's IsSuperuser
// permission enforces the same rule independently, so this is a UI
// convenience, not the actual security boundary.
export function PlatformAdminToggle({ userId, isPlatformAdmin }: { userId: number; isPlatformAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = isPlatformAdmin ? await revokePlatformAdmin(userId) : await grantPlatformAdmin(userId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <Button variant="outline" size="sm" disabled={pending} onClick={handleClick}>
        {isPlatformAdmin ? "Revoke super user" : "Grant super user"}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
