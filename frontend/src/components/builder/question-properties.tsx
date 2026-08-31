"use client";

import { Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ANSWERABLE_QUESTION_TYPES,
  CONDITION_CAPABLE_QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  SELECT_QUESTION_TYPES,
} from "@/lib/types";
import type { Question, SelectOption } from "@/lib/types";
import { FlagRuleEditor } from "./flag-rule-editor";
import { SelectOptionsEditor } from "./select-options-editor";

export function QuestionProperties({
  question,
  onChange,
  onDelete,
}: {
  question: Question;
  onChange: (data: Partial<Question>) => void;
  onDelete: () => void;
}) {
  const isAnswerable = ANSWERABLE_QUESTION_TYPES.includes(question.question_type);
  const isSelectType = SELECT_QUESTION_TYPES.includes(question.question_type);
  const canFlag = CONDITION_CAPABLE_QUESTION_TYPES.includes(question.question_type);

  function handleOptionsChange(options: SelectOption[]) {
    onChange({ config: { ...question.config, options } });
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Question</div>
        <Badge variant="outline" className="mt-1">
          {QUESTION_TYPE_LABELS[question.question_type]}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="question-help-text">Help text</Label>
        <Textarea
          id="question-help-text"
          defaultValue={question.help_text}
          onBlur={(e) => {
            if (e.target.value !== question.help_text) onChange({ help_text: e.target.value });
          }}
          placeholder="Extra guidance shown under the question (optional)"
          className="min-h-20"
        />
      </div>

      {isAnswerable && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={question.is_required} onCheckedChange={(c) => onChange({ is_required: c === true })} />
          Required
        </label>
      )}

      {isSelectType && (
        <SelectOptionsEditor options={question.config.options ?? []} onChange={handleOptionsChange} />
      )}

      {canFlag && (
        <FlagRuleEditor
          question={question}
          flagRule={question.flag_rule}
          onChange={(flag_rule) => onChange({ flag_rule })}
        />
      )}

      <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 className="mr-1.5 h-4 w-4" />
        Delete question
      </Button>
    </div>
  );
}
