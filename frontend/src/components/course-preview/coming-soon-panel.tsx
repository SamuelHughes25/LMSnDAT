import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";

// Shared stub empty-state for not-yet-built sub-pages (Activity, Analytics,
// and reused inline on Settings) — matches the muted centered empty-state
// style already used in course-builder/properties-panel.tsx.
export function ComingSoonPanel({
  title,
  description,
  icon: Icon = Sparkles,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-6 text-center shadow-sm">
      <Icon className="mb-3 h-8 w-8 text-muted-foreground/50" />
      <div className="font-medium">{title}</div>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
