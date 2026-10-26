"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import {
  createPermissionSet,
  updatePermissionSet,
  type PermissionTabField,
} from "@/app/actions/permission-sets";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import type { PermissionSet } from "@/lib/accounts-types";
import { PERMISSION_SET_SECTIONS } from "@/lib/permission-set-sections";

type Fields = Partial<Record<PermissionTabField, boolean>>;

function fieldsFrom(permissionSet?: PermissionSet): Fields {
  const fields: Fields = {};
  for (const section of PERMISSION_SET_SECTIONS) {
    fields[section.tab] = permissionSet?.[section.tab] ?? false;
    for (const sub of section.subPermissions) {
      fields[sub.field] = permissionSet?.[sub.field] ?? false;
    }
  }
  return fields;
}

// One shared form for creating AND editing a permission set — a tabbed
// dialog (one tab per dashboard section) with the parent tab-access
// checkbox and that section's own sub-permissions, if any, grouped
// together underneath it. Replaces the old two-step flow (a bare name-
// only create dialog, then clicking each tab checkbox individually on
// the table afterward) — everything about a permission set is staged
// here and committed as one request on submit.
export function PermissionSetFormDialog(
  props: { mode: "create" } | { mode: "edit"; permissionSet: PermissionSet },
) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(props.mode === "edit" ? props.permissionSet.name : "");
  const [fields, setFields] = useState<Fields>(() =>
    fieldsFrom(props.mode === "edit" ? props.permissionSet : undefined),
  );
  const [activeTab, setActiveTab] = useState<PermissionTabField>(PERMISSION_SET_SECTIONS[0].tab);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function resetToInitial() {
    setName(props.mode === "edit" ? props.permissionSet.name : "");
    setFields(fieldsFrom(props.mode === "edit" ? props.permissionSet : undefined));
    setActiveTab(PERMISSION_SET_SECTIONS[0].tab);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetToInitial();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        if (props.mode === "create") {
          await createPermissionSet(name.trim(), fields);
        } else {
          await updatePermissionSet(props.permissionSet.id, name.trim(), fields);
        }
        setOpen(false);
        router.refresh();
      } catch {
        setError(
          props.mode === "create"
            ? "Could not create permission set — the name may already be taken."
            : "Could not save changes — the name may already be taken.",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          props.mode === "create" ? (
            <Button size="sm" />
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${props.permissionSet.name}`}
              className="text-muted-foreground hover:text-foreground"
            />
          )
        }
      >
        {props.mode === "create" ? "Create" : <Pencil className="h-4 w-4" />}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.mode === "create" ? "New permission set" : `Edit "${props.permissionSet.name}"`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="permission-set-name">Name</Label>
            <Input id="permission-set-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PermissionTabField)}>
            <TabsList>
              {PERMISSION_SET_SECTIONS.map((section) => (
                <TabsTab key={section.tab} value={section.tab}>
                  {section.label}
                </TabsTab>
              ))}
            </TabsList>
            {PERMISSION_SET_SECTIONS.map((section) => (
              <TabsPanel key={section.tab} value={section.tab} className="space-y-3 rounded-lg border p-3">
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    checked={fields[section.tab] ?? false}
                    onCheckedChange={(c) => setFields((f) => ({ ...f, [section.tab]: c === true }))}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">Access the {section.label} tab</span>
                    <span className="block text-xs text-muted-foreground">
                      View {section.label.toLowerCase()} and reach this section at all.
                    </span>
                  </span>
                </label>

                {section.subPermissions.length > 0 && (
                  <div className="space-y-2 border-t pt-3 pl-1">
                    {section.requiresParent && (
                      <p className="text-xs text-muted-foreground">
                        Each of these needs &quot;Access the {section.label} tab&quot; above too.
                      </p>
                    )}
                    {section.subPermissions.map((sub) => {
                      const disabled = section.requiresParent && !fields[section.tab];
                      return (
                        <label key={sub.field} className="flex cursor-pointer items-start gap-2">
                          <Checkbox
                            checked={!disabled && (fields[sub.field] ?? false)}
                            onCheckedChange={(c) => setFields((f) => ({ ...f, [sub.field]: c === true }))}
                            disabled={disabled}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-sm font-medium">{sub.label}</span>
                            <span className="block text-xs text-muted-foreground">{sub.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </TabsPanel>
            ))}
          </Tabs>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : props.mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
