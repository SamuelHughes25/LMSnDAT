"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { setPermissionSetTab, type PermissionTabField } from "@/app/actions/permission-sets";
import { Checkbox } from "@/components/ui/checkbox";

// One cell in the Permissions table — commits on click, same "immediate
// toggle, no save button" convention as role-assignment-toggle.tsx uses
// for Group access.
export function PermissionSetTabCheckbox({
  permissionSetId,
  field,
  checked,
}: {
  permissionSetId: string;
  field: PermissionTabField;
  checked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleChange(next: boolean) {
    startTransition(async () => {
      await setPermissionSetTab(permissionSetId, field, next);
      router.refresh();
    });
  }

  // Checkbox's own root renders `display:flex` (see ui/checkbox.tsx) —
  // a block-level box, so the table cell's `text-center` (which only ever
  // centers inline content) has no effect on it at all; left unwrapped, it
  // just sits flush at the cell's left edge regardless of column width,
  // which is exactly the "ambiguous which column this is under" bug this
  // wrapper fixes. `flex justify-center` centers it properly regardless of
  // whatever text-alignment the caller's TableCell happens to use.
  return (
    <div className="flex justify-center">
      <Checkbox checked={checked} onCheckedChange={(c) => handleChange(c === true)} disabled={pending} />
    </div>
  );
}
