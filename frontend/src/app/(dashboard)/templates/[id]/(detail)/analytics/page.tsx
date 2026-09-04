import { BarChart3 } from "lucide-react";

import { ComingSoonPanel } from "@/components/course-preview/coming-soon-panel";

export default function TemplateAnalyticsPage() {
  return (
    <ComingSoonPanel
      icon={BarChart3}
      title="Analytics"
      description="Once audits are being submitted, completion rates and flagged-answer trends will live here."
    />
  );
}
