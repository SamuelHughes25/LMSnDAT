import { History } from "lucide-react";

import { ComingSoonPanel } from "@/components/course-preview/coming-soon-panel";

export default function TemplateActivityPage() {
  return (
    <ComingSoonPanel
      icon={History}
      title="Activity"
      description="A history of submitted audits — who completed them and when — will live here."
    />
  );
}
