"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FlagRule, Question } from "@/lib/types";

export function FlagRuleEditor({
  question,
  flagRule,
  onChange,
}: {
  question: Question;
  flagRule: FlagRule;
  onChange: (rule: FlagRule) => void;
}) {
  const enabled = flagRule !== null;

  function toggle(checked: boolean) {
    if (!checked) {
      onChange(null);
      return;
    }
    const defaultValue =
      question.question_type === "boolean" ? false : (question.config.options?.[0]?.value ?? "");
    onChange({ operator: "equals", value: defaultValue });
  }

  function setValue(value: string | boolean) {
    onChange({ operator: "equals", value });
  }

  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox checked={enabled} onCheckedChange={(c) => toggle(c === true)} />
        Flag this answer for a corrective action when the answer is…
      </label>

      {enabled && question.question_type === "boolean" && (
        <Select value={String(flagRule?.value ?? false)} onValueChange={(v) => setValue(v === "true")}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      )}

      {enabled && question.question_type === "single_select" && (
        <Select value={String(flagRule?.value ?? "")} onValueChange={(v) => setValue(v ?? "")}>
          <SelectTrigger className="h-8 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(question.config.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
