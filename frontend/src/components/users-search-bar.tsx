"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";

// No existing search-box precedent anywhere in this admin dashboard to
// copy — this is the first one. Plain "the URL is the source of truth"
// pattern (no client-side data-fetching library, matching how the rest of
// this codebase only ever fetches via Server Components): typing updates a
// local, instantly-responsive value, and after a short debounce pushes it
// into the `q` search param, which is what the Users page (a Server
// Component) actually reads to refetch from Django. Debounced so fast
// typing doesn't fire a request per keystroke; startTransition marks the
// resulting navigation as non-urgent so it doesn't block the input itself
// from updating instantly.
export function UsersSearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const [, startTransition] = useTransition();

  useEffect(() => {
    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`);
      });
    }, 300);
    return () => clearTimeout(handle);
    // Deliberately only re-runs on `value` — re-running on every
    // searchParams/router/pathname identity change (none of which the user
    // caused by typing) would refire this debounce for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search by username…"
      className="w-64"
    />
  );
}
