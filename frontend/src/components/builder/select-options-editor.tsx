"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SelectOption } from "@/lib/types";

export function SelectOptionsEditor({
  options,
  onChange,
}: {
  options: SelectOption[];
  onChange: (options: SelectOption[]) => void;
}) {
  const [local, setLocal] = useState(options);

  function updateLabel(index: number, label: string) {
    setLocal((prev) => prev.map((opt, i) => (i === index ? { ...opt, label } : opt)));
  }

  function commit(next: SelectOption[]) {
    setLocal(next);
    onChange(next);
  }

  function addOption() {
    const n = local.length + 1;
    commit([...local, { value: `option_${n}_${Date.now().toString(36)}`, label: `Option ${n}` }]);
  }

  function removeOption(index: number) {
    commit(local.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">Options</label>
      <div className="space-y-1.5">
        {local.map((option, index) => (
          <div key={option.value} className="flex items-center gap-1.5">
            <Input
              value={option.label}
              onChange={(e) => updateLabel(index, e.target.value)}
              onBlur={() => commit(local)}
              className="h-8"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={local.length <= 1}
              onClick={() => removeOption(index)}
              aria-label="Remove option"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addOption}>
        <Plus className="mr-1 h-3 w-3" />
        Add option
      </Button>
    </div>
  );
}
