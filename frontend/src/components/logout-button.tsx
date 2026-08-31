"use client";

import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  return (
    <form action={logout}>
      <Button variant="outline" size="sm" type="submit">
        Log out
      </Button>
    </form>
  );
}
