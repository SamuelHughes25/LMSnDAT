import { BarChart3 } from "lucide-react";

import { ComingSoonPanel } from "@/components/course-preview/coming-soon-panel";

export default function CourseAnalyticsPage() {
  return (
    <ComingSoonPanel
      icon={BarChart3}
      title="Analytics"
      description="Once courses can be assigned to learners, completion rates and quiz performance will live here."
    />
  );
}
