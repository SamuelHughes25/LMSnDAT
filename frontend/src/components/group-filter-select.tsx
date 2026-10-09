"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL_VALUE = "__all__";

// One filter select for both group kinds — which query param it reads/
// writes and what its "show everything" label says are the only things
// that differ between the Users list's Course group and Template group
// filters, so both use this one component rather than two near-duplicates.
export function GroupFilterSelect({
  groups,
  paramName,
  allLabel,
}: {
  groups: { id: string; name: string }[];
  paramName: string;
  allLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(paramName) ?? ALL_VALUE;

  function handleChange(value: string | null) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === ALL_VALUE) {
      params.delete(paramName);
    } else {
      params.set(paramName, value);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <Select value={current} onValueChange={handleChange}>
      <SelectTrigger className="w-48">
        {/* SelectValue's default (no children render-prop) shows the raw
            `value` string verbatim — confirmed in a real browser to render
            the literal "__all__" sentinel/a group's UUID instead of its
            name. A formatter function is base-ui's documented way to map
            the current value to a display label. */}
        <SelectValue>
          {(value: string) => (value === ALL_VALUE ? allLabel : (groups.find((g) => g.id === value)?.name ?? allLabel))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
        {groups.map((group) => (
          <SelectItem key={group.id} value={group.id}>
            {group.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
