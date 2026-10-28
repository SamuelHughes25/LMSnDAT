import { type AnalyticsStat, AnalyticsStatSlider } from "@/components/analytics-stat-slider";
import { CourseAnalyticsTable, type UserSummary } from "@/components/course-analytics-table";
import type { AccountUser } from "@/lib/accounts-types";
import type { CourseAttempt, CourseDeadlineExtension } from "@/lib/attempt-types";
import {
  buildSlideAnalyticsIndex,
  SLIDE_TYPE_LABELS,
  type Course,
  type CourseVersion,
  type SlideType,
} from "@/lib/course-types";
import { djangoFetch } from "@/lib/django";
import type { Paginated } from "@/lib/types";

// One gradable slide's aggregate right/wrong record across every attempt
// ever submitted against it (any version — see buildSlideAnalyticsIndex's
// own comment on why a slide id is never reused across a republish).
type SlideStat = {
  slideId: string;
  total: number;
  correct: number;
  number: number;
  slideType: SlideType;
  questionText: string | null;
};

// A simple, dependency-free horizontal bar — no charting library exists
// anywhere in this frontend and "basic" metrics don't warrant adding one
// (see the Phase 2 plan). Just a width:X% div over a muted track.
function StatBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(percent)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  );
}

// Course existence/404 is already handled by the (detail) layout, which
// fetches the course itself — this page only needs the attempts list.
export default async function CourseAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // page_size=200 (DRF's configured max — see backend/apps/core/pagination.py)
  // rather than building pagination UI, fine at this app's scale.
  const [course, attempts, versions] = await Promise.all([
    djangoFetch<Course>(`/courses/${id}/`),
    djangoFetch<Paginated<CourseAttempt>>(`/course-attempts/?course=${id}&page_size=200`),
    // Every version, not just the published one — see
    // buildSlideAnalyticsIndex's own comment on why a completed attempt can
    // still reference a slide from a since-superseded version.
    djangoFetch<Paginated<CourseVersion>>(`/course-versions/?course=${id}&page_size=200`),
  ]);
  const allAttempts = attempts.results;
  const slideInfoById = buildSlideAnalyticsIndex(versions.results);

  // Per-question difficulty, aggregated across every SlideResult on every
  // fetched attempt (including still in_progress ones — a submitted answer
  // is real signal about that question regardless of whether the learner
  // ever finished the rest of the course). Slides with no metadata (an
  // orphaned reference — shouldn't happen, but see the same defensive
  // skip pattern elsewhere in this app) are left out rather than shown
  // with a broken label.
  const slideTotals = new Map<string, { total: number; correct: number }>();
  for (const attempt of allAttempts) {
    for (const result of attempt.slide_results) {
      const entry = slideTotals.get(result.slide) ?? { total: 0, correct: 0 };
      entry.total += 1;
      if (result.is_correct) entry.correct += 1;
      slideTotals.set(result.slide, entry);
    }
  }
  const slideStats: SlideStat[] = Array.from(slideTotals.entries())
    .map(([slideId, { total, correct }]) => {
      const info = slideInfoById[slideId];
      return info
        ? { slideId, total, correct, number: info.number, slideType: info.slideType, questionText: info.questionText }
        : null;
    })
    .filter((s): s is SlideStat => s !== null)
    // Hardest (lowest correct rate) first — doubling as what makes
    // slideStats[0]/slideStats.at(-1) below the most-failed/most-passed
    // stat cards without a separate sort. Shown independently (each only
    // needs ONE qualifying slide, not two) — when there's exactly one
    // gradable slide with any data at all, both cards legitimately point
    // at the same slide; that's not a bug, there's just nothing to
    // contrast it against yet.
    .sort((a, b) => a.correct / a.total - b.correct / b.total);
  const mostFailed = slideStats.length > 0 ? slideStats[0] : null;
  const mostPassed = slideStats.length > 0 ? slideStats[slideStats.length - 1] : null;
  const completed = allAttempts.filter((a) => a.status === "completed");
  const scored = completed.filter((a) => a.score !== null);
  const graded = completed.filter((a) => a.passed !== null);

  const uniqueUserIds = Array.from(new Set(allAttempts.map((a) => a.user)));
  const users = await Promise.all(uniqueUserIds.map((userId) => djangoFetch<AccountUser>(`/users/${userId}/`)));

  const averageScore = scored.length
    ? scored.reduce((sum, a) => sum + (a.score ?? 0), 0) / scored.length
    : null;
  const passRate = graded.length ? (graded.filter((a) => a.passed).length / graded.length) * 100 : null;

  // How hard/easy this course actually is, in one number: on average, how
  // many pass-or-fail attempts does it take one person to get a verdict?
  // Deliberately over GRADED attempts only (a real pass/fail outcome, not
  // just "started" or "completed with no assessment to grade against") —
  // a raw total-attempts count conflates "lots of people took this once"
  // with "a few people struggled through many retakes," which says
  // nothing about difficulty; this isolates the retake signal instead.
  const uniqueGradedUserIds = new Set(graded.map((a) => a.user));
  const averageAttemptsPerPerson = uniqueGradedUserIds.size ? graded.length / uniqueGradedUserIds.size : null;

  // Grouped-by-user, aggregated here (in the server component) from the raw
  // attempt list — no dedicated backend aggregation endpoint; at
  // internal-tool scale a plain reduce over up to 200 fetched rows is
  // simpler and avoids a second API shape to maintain. `attemptsByUser`
  // (every one of a user's own CourseAttempt rows — one per full
  // course play-through, never a per-slide/per-question count) is what
  // powers the table's own expand-to-see-every-attempt row.
  const attemptsByUser: Record<number, CourseAttempt[]> = {};
  for (const userId of uniqueUserIds) {
    attemptsByUser[userId] = allAttempts.filter((a) => a.user === userId);
  }

  const summaries: UserSummary[] = uniqueUserIds.map((userId) => {
    const userAttempts = attemptsByUser[userId];
    const userScored = userAttempts.filter((a) => a.score !== null);
    const bestScore = userScored.length ? Math.max(...userScored.map((a) => a.score ?? 0)) : null;
    // "Passed" for the table means at least one of this user's attempts
    // passed — same "have they ever cleared it" semantics as the portal's
    // own retake reminder (see role-access.ts/portal/page.tsx).
    const gradedForUser = userAttempts.filter((a) => a.passed !== null);
    const passed = gradedForUser.length ? gradedForUser.some((a) => a.passed) : null;
    const lastAttemptAt = userAttempts.reduce(
      (latest, a) => (a.started_at > latest ? a.started_at : latest),
      userAttempts[0].started_at,
    );
    return { userId, attemptCount: userAttempts.length, bestScore, passed, lastAttemptAt };
  });
  summaries.sort((a, b) => (a.lastAttemptAt < b.lastAttemptAt ? 1 : -1));

  // Only fetched/shown at all when the course actually has a deadline —
  // effective deadline is a per-user extension if one exists, else the
  // course's own default (see Course.effective_deadline_for() in
  // backend/apps/courses/models.py, mirrored here client-side since this
  // page already has both pieces in hand).
  let deadlineByUser: Record<number, string | null> | undefined;
  if (course.deadline) {
    const extensions = await djangoFetch<Paginated<CourseDeadlineExtension>>(
      `/course-deadline-extensions/?course=${id}&page_size=200`,
    );
    const extensionByUser = new Map(extensions.results.map((e) => [e.user, e.extended_deadline]));
    deadlineByUser = Object.fromEntries(
      uniqueUserIds.map((userId) => [userId, extensionByUser.get(userId) ?? course.deadline]),
    );
  }

  // The slider's card set — 5 always-present course-level stats, plus up
  // to 2 more only once there's real per-question data to show (see
  // mostFailed/mostPassed above). Every card stays in this row regardless
  // of how many there are — it's a slider specifically so the row never
  // needs to shed cards to fit; extras just scroll off rather than being
  // dropped. Order here is just this array's construction order, i.e. the
  // DEFAULT before any per-browser reordering — AnalyticsStatSlider owns
  // actually arranging/persisting what the viewer sees.
  const stats: AnalyticsStat[] = [
    // Attempts on the COURSE — one row per full play-through
    // (CourseAttempt), never a per-slide/per-question count (that's what
    // SlideResult is, and it never surfaces as a top-level metric here).
    { id: "attempts", label: "Attempts", value: allAttempts.length },
    {
      id: "avgAttempts",
      label: "Avg. attempts per person",
      value: averageAttemptsPerPerson === null ? "—" : averageAttemptsPerPerson.toFixed(1),
    },
    { id: "usersAttempted", label: "Users attempted", value: uniqueUserIds.length },
    { id: "avgScore", label: "Average score", value: averageScore === null ? "—" : `${Math.round(averageScore)}%` },
    { id: "passRate", label: "Pass rate", value: passRate === null ? "—" : `${Math.round(passRate)}%` },
  ];
  if (mostFailed) {
    stats.push({
      id: "mostFailed",
      label: "Most failed question",
      value: `Slide ${mostFailed.number}`,
      detail: `${mostFailed.questionText ?? SLIDE_TYPE_LABELS[mostFailed.slideType]} · ${mostFailed.correct}/${mostFailed.total} (${Math.round((mostFailed.correct / mostFailed.total) * 100)}%)`,
    });
  }
  if (mostPassed) {
    stats.push({
      id: "mostPassed",
      label: "Most passed question",
      value: `Slide ${mostPassed.number}`,
      detail: `${mostPassed.questionText ?? SLIDE_TYPE_LABELS[mostPassed.slideType]} · ${mostPassed.correct}/${mostPassed.total} (${Math.round((mostPassed.correct / mostPassed.total) * 100)}%)`,
    });
  }

  return (
    <div className="space-y-6">
      <AnalyticsStatSlider stats={stats} />

      {(averageScore !== null || passRate !== null) && (
        // ml-10 — matches the slider's own left arrow column (w-9) + its
        // gap-1 to the card track in analytics-stat-slider.tsx, so this
        // box's left edge lines up with the first STAT CARD above it, not
        // with the page's plain left margin (which is where it sat before
        // — reported directly as looking out of position once the arrows
        // moved into their own reserved column instead of overlaying the
        // cards). Deliberately NOT applied to the table further down —
        // that one still aligns with the page's own heading/breadcrumb,
        // which is the more natural match for a full-width element.
        <div className="ml-10 max-w-md space-y-3 rounded-lg border-2 border-border bg-card p-4 shadow-sm">
          {averageScore !== null && <StatBar label="Average score" percent={averageScore} />}
          {passRate !== null && <StatBar label="Pass rate" percent={passRate} />}
        </div>
      )}

      <CourseAnalyticsTable
        summaries={summaries}
        usersById={Object.fromEntries(users.map((u) => [u.id, u]))}
        attemptsByUser={attemptsByUser}
        courseId={id}
        isAssessment={course.is_assessment}
        deadlineByUser={deadlineByUser}
        slideInfoById={slideInfoById}
      />
    </div>
  );
}
