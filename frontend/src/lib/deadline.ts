// Shared by every place that shows a learner their own effective deadline
// (course.my_deadline — see CourseSerializer.get_my_deadline in
// backend/apps/courses/serializers.py) — the portal home page's reminders
// and the course player's own header.
export type DeadlineStatus = { label: string; overdue: boolean };

export function deadlineStatus(deadline: string | null): DeadlineStatus | null {
  if (!deadline) return null;
  // Date-only comparison (not time-of-day) — a deadline is a whole day,
  // matching the plain <input type="date"> it was set with.
  const today = new Date().toISOString().slice(0, 10);
  const overdue = deadline < today;
  const formatted = new Date(deadline).toLocaleDateString();
  return { label: overdue ? `Overdue since ${formatted}` : `Due ${formatted}`, overdue };
}
