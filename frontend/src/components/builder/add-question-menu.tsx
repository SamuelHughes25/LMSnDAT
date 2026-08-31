"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QUESTION_TYPE_LABELS } from "@/lib/types";
import type { QuestionType } from "@/lib/types";

const ORDERED_TYPES: QuestionType[] = [
  "text",
  "number",
  "boolean",
  "single_select",
  "multi_select",
  "date",
  "photo",
  "signature",
  "gps",
  "barcode",
  "section_header",
  "instruction",
];

export function AddQuestionMenu({ onSelect }: { onSelect: (type: QuestionType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="mr-1 h-4 w-4" />
        Add question
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {ORDERED_TYPES.map((type) => (
          <DropdownMenuItem key={type} onClick={() => onSelect(type)}>
            {QUESTION_TYPE_LABELS[type]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
