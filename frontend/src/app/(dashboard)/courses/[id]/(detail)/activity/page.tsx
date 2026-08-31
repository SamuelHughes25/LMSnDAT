import { History } from "lucide-react";

import { ComingSoonPanel } from "@/components/course-preview/coming-soon-panel";

export default function CourseActivityPage() {
  return (
    <ComingSoonPanel
      icon={History}
      title="Activity"
      description="A history of edits, publishes, and version changes will live here."
    />
  );
}
