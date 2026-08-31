"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SlideConfig } from "@/lib/course-types";

// Editor-only for the "content" slide_type — there's no learner-facing
// preview component yet (that's a later stage's slide-player.tsx). The
// image field is intentionally omitted this stage; asset upload lands
// later.
//
// Pattern A (uncontrolled defaultValue + onBlur, relying on the properties
// panel remounting via key={panelKey} when the selected slide changes) —
// same pattern as builder/section-properties.tsx.
export function ContentSlideEditor({
  config,
  onChange,
}: {
  config: SlideConfig;
  onChange: (config: SlideConfig) => void;
}) {
  const body = config.body ?? "";

  return (
    <div className="space-y-1.5">
      <Label htmlFor="slide-body">Body</Label>
      <Textarea
        id="slide-body"
        defaultValue={body}
        onBlur={(e) => {
          if (e.target.value !== body) onChange({ ...config, body: e.target.value });
        }}
        placeholder="Slide content shown to the learner"
        className="min-h-32"
      />
    </div>
  );
}
