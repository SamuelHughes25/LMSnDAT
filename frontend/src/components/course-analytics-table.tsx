"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { ChevronDown, ListFilter, Pencil } from "lucide-react";

import { removeDeadlineExtension, setDeadlineExtension } from "@/app/actions/deadlines";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollableTableContainer } from "@/components/scrollable-table-container";
import { ACCOUNT_TYPES, FilterCategory } from "@/components/user-filters-panel";
import type { CourseAttempt } from "@/lib/attempt-types";
import { describeSlideAnswer, QUESTION_SLIDE_TYPES, SLIDE_TYPE_LABELS, type SlideAnalyticsInfo } from "@/lib/course-types";
import { cn } from "@/lib/utils";

// Grouped-by-user summary row, aggregated in the server component (see
// analytics/page.tsx) from the raw attempt list.
export type UserSummary = {
  userId: number;
  attemptCount: number;
  bestScore: number | null;
  passed: boolean | null;
  lastAttemptAt: string;
};

// Deliberately NOT AccountUser — that requires a per-user /users/{id}/
// fetch, which is Users-tab-gated and 404s for anyone else once the
// viewer doesn't hold that tab (UserViewSet.get_queryset falls back to
// self-only without it). This table's own viewer only ever needs these
// four fields to label/filter a row, and analytics/page.tsx now builds
// this straight from each attempt's own denormalized user_*  fields (see
// CourseAttemptSerializer's own comment) instead of a separate fetch —
// confirmed directly as the fix for a course editor without the Users
// tab seeing this whole table crash the instant the course had more than
// one attempting user.
export type AttemptUserInfo = {
  username: string;
  role: string;
  permission_set: string | null;
  permission_set_name: string | null;
};

// An assessment attempt is always either Passed or Failed, never a bare
// "—" — see user-course-history-table.tsx's identical PassedBadge for the
// full reasoning: an attempt left in_progress forever (closed the tab,
// never came back) used to show as a perpetually-unresolved "—" here too,
// reading as broken rather than simply not-yet-passed. `passed === null`
// on an assessment course now only ever means "not completed yet," so it
// reads as Failed; a learner who finishes later gets their real result the
// moment they do. Non-assessment courses have no pass/fail concept at all
// (grading.py only ever sets `passed` when course.is_assessment), so this
// column reads N/A for them — not Failed, not even a styled "Not an
// assessment" — reported directly as confusing in its own right: a 100%
// score sitting next to a Failed-shaped badge read as contradictory, when
// the real answer is simply that pass/fail doesn't apply here at all. The
// score itself (Best score column) is completely unaffected — it's
// computed from CourseAttempt.score, which grading.py always sets
// regardless of is_assessment; only `passed` is assessment-gated. This
// table only renders for one course at a time, so isAssessment is a
// single top-level flag, not per-row.
function PassedBadge({ passed, isAssessment }: { passed: boolean | null; isAssessment: boolean }) {
  if (!isAssessment) return <span className="text-muted-foreground">N/A</span>;
  return passed ? <Badge>Passed</Badge> : <Badge variant="destructive">Failed</Badge>;
}

// Same two-color convention as PassedBadge, one level down — per-QUESTION
// correctness within a single attempt, not the attempt's own overall
// pass/fail (which stays assessment-gated; a single slide's right/wrong is
// meaningful on every course, assessment or not — see slideStats' own
// comment on analytics/page.tsx for why that section isn't gated either).
function SlideCorrectBadge({ correct }: { correct: boolean }) {
  return correct ? <Badge>Correct</Badge> : <Badge variant="destructive">Incorrect</Badge>;
}

// One user's effective deadline for this course (their own extension if
// they have one, else deadline_days after their own CourseAccessGrant —
// see Course.effective_deadline_for() in backend/apps/courses/models.py)
// plus a small inline editor for granting/changing that extension. Surfaced
// here, in the same table an admin/manager is already looking at this
// course's users through, rather than a separate page — this is where
// they'd realistically notice someone needs more time. The pencil only
// renders at all for a viewer with canEditDeadlines (its own sub-
// permission, separate from general course-member management — see
// CanManageCourseDeadlines on the backend) — everyone else just sees the
// date, same read-only treatment as every other column here.
function DeadlineCell({
  courseId,
  userId,
  effectiveDeadline,
  canEdit,
}: {
  courseId: string;
  userId: number;
  effectiveDeadline: string | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(effectiveDeadline ?? "");
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <span>{effectiveDeadline ? new Date(effectiveDeadline).toLocaleDateString() : "—"}</span>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit deadline for user ${userId}`}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        className="h-7 w-36 text-xs"
      />
      <Button
        size="sm"
        disabled={pending || !value}
        onClick={() =>
          startTransition(async () => {
            await setDeadlineExtension(courseId, userId, value);
            setEditing(false);
          })
        }
      >
        Save
      </Button>
      {effectiveDeadline && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await removeDeadlineExtension(courseId, userId);
              setEditing(false);
            })
          }
        >
          Clear
        </Button>
      )}
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </div>
  );
}

// "use client" only for the two genuinely interactive things here — the
// per-row expand toggle, and the deadline extension editor above. Data
// fetching/aggregation stays in the server component; this just renders it
// and owns which row (if any) is expanded.
export function CourseAnalyticsTable({
  summaries,
  usersById,
  attemptsByUser,
  courseId,
  isAssessment,
  canEditDeadlines,
  deadlineByUser,
  slideInfoById,
}: {
  summaries: UserSummary[];
  usersById: Record<number, AttemptUserInfo>;
  attemptsByUser: Record<number, CourseAttempt[]>;
  courseId: string;
  isAssessment: boolean;
  // Whether the viewer can edit deadlines on this course at all — see
  // DeadlineCell's own comment. Irrelevant (and unused) when
  // deadlineByUser is undefined, since there's no Deadline column to put
  // a pencil in either way.
  canEditDeadlines: boolean;
  // Omitted entirely when the course has no deadline set at all — the
  // Deadline column only ever appears for a course that actually has one
  // to show/edit.
  deadlineByUser?: Record<number, string | null>;
  // Labels every SlideResult an attempt sub-row can expand into — see
  // buildSlideAnalyticsIndex (lib/course-types.ts) for how this gets built
  // once, server-side, in analytics/page.tsx.
  slideInfoById: Record<string, SlideAnalyticsInfo>;
}) {
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [selectedPermissionSets, setSelectedPermissionSets] = useState<Set<string>>(new Set());
  const showDeadlineColumn = deadlineByUser !== undefined;
  const columnCount = showDeadlineColumn ? 7 : 6;

  // Every permission set actually held by someone in THIS course's user
  // list — not the full site-wide list of permission sets (most of which
  // would have nothing to do with this course's users and just be dead
  // options), derived straight from usersById rather than a separate fetch.
  const availablePermissionSets = useMemo(() => {
    const byId = new Map<string, string>();
    for (const user of Object.values(usersById)) {
      if (user.permission_set && user.permission_set_name) byId.set(user.permission_set, user.permission_set_name);
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [usersById]);

  const activeAccountTypeCount = ACCOUNT_TYPES.filter((type) => type.roles.every((r) => selectedRoles.has(r))).length;
  const activeFilterCount = activeAccountTypeCount + selectedPermissionSets.size;

  function toggleRoleGroup(roles: string[]) {
    setSelectedRoles((current) => {
      const next = new Set(current);
      const isActive = roles.every((r) => next.has(r));
      for (const r of roles) {
        if (isActive) next.delete(r);
        else next.add(r);
      }
      return next;
    });
  }

  function togglePermissionSet(id: string) {
    setSelectedPermissionSets((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Plain local filter, not a URL param — every row's data (usersById,
  // attemptsByUser) is already fully loaded client-side for this table, so
  // there's no server round trip to debounce/wait on the way the main
  // Users list's UsersSearchBar needs.
  const query = search.trim().toLowerCase();
  const visibleSummaries = summaries.filter((s) => {
    const user = usersById[s.userId];
    const label = user?.username ?? String(s.userId);
    if (query && !label.toLowerCase().includes(query)) return false;
    if (selectedRoles.size > 0 && !(user && selectedRoles.has(user.role))) return false;
    if (selectedPermissionSets.size > 0 && !(user?.permission_set && selectedPermissionSets.has(user.permission_set)))
      return false;
    return true;
  });
  const hasActiveFilters = query.length > 0 || activeFilterCount > 0;

  return (
    <div className="rounded-lg border-2 border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username…"
          className="w-64"
        />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <ListFilter className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5">
                {activeFilterCount}
              </Badge>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <FilterCategory label="Account type" count={activeAccountTypeCount}>
              {ACCOUNT_TYPES.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type.label}
                  checked={type.roles.every((r) => selectedRoles.has(r))}
                  onCheckedChange={() => toggleRoleGroup(type.roles)}
                >
                  {type.label}
                </DropdownMenuCheckboxItem>
              ))}
            </FilterCategory>
            {availablePermissionSets.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <FilterCategory label="Permissions" count={selectedPermissionSets.size}>
                  {availablePermissionSets.map((permissionSet) => (
                    <DropdownMenuCheckboxItem
                      key={permissionSet.id}
                      checked={selectedPermissionSets.has(permissionSet.id)}
                      onCheckedChange={() => togglePermissionSet(permissionSet.id)}
                    >
                      {permissionSet.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterCategory>
              </>
            )}
            {activeFilterCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedRoles(new Set());
                    setSelectedPermissionSets(new Set());
                  }}
                >
                  Clear filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ScrollableTableContainer>
        {/* table-fixed + explicit column widths below — without this, the
            browser's default "auto" table layout recomputes every column's
            width from whichever rows happen to be in the DOM, so expanding a
            row (adding cells with different content/widths, like the blank
            history sub-row cells) visibly shifted every column in the WHOLE
            table, summary rows included. Fixed widths make column widths
            depend only on the header row, never on which rows are expanded. */}
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[24%]">Username</TableHead>
              <TableHead className="w-[10%]">Attempts</TableHead>
              <TableHead className="w-[13%]">Best score</TableHead>
              <TableHead className="w-[13%]">Result</TableHead>
              <TableHead className="w-[16%]">Last attempt</TableHead>
              {showDeadlineColumn && <TableHead className="w-[18%]">Deadline</TableHead>}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleSummaries.map((summary) => {
            const user = usersById[summary.userId];
            const label = user?.username ?? String(summary.userId);
            const isOpen = expandedUserId === summary.userId;
            // Newest first, oldest last — started_at is an ISO string, so
            // a plain string comparison sorts chronologically.
            const attempts = [...(attemptsByUser[summary.userId] ?? [])].sort((a, b) =>
              a.started_at < b.started_at ? 1 : -1,
            );

            return (
              <Fragment key={summary.userId}>
                <TableRow>
                  <TableCell className="truncate font-medium">{label}</TableCell>
                  <TableCell>{summary.attemptCount}</TableCell>
                  <TableCell>{summary.bestScore === null ? "—" : `${summary.bestScore}%`}</TableCell>
                  <TableCell>
                    <PassedBadge passed={summary.passed} isAssessment={isAssessment} />
                  </TableCell>
                  <TableCell>{new Date(summary.lastAttemptAt).toLocaleDateString()}</TableCell>
                  {showDeadlineColumn && (
                    <TableCell>
                      <DeadlineCell
                        courseId={courseId}
                        userId={summary.userId}
                        effectiveDeadline={deadlineByUser[summary.userId] ?? null}
                        canEdit={canEditDeadlines}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={isOpen ? `Hide ${label}'s attempts` : `Show ${label}'s attempts`}
                      aria-expanded={isOpen}
                      onClick={() => {
                        setExpandedUserId(isOpen ? null : summary.userId);
                        setExpandedAttemptId(null);
                      }}
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                    </Button>
                  </TableCell>
                </TableRow>
                {/* Sub-rows for each of this user's attempts — still just
                    more rows in the SAME table, reusing the exact same
                    column set as the summary row above (Username/Attempts/
                    chevron blank, since none of those apply to a single
                    attempt) rather than a nested <Table> with its own
                    header. Column-for-column alignment with the table it's
                    drilling into is still the point. A solid (not a faint
                    fractional-opacity tint) bg-muted fill on every row in
                    the block, plus a bolder top border on the first one,
                    is what actually reads as "a clearly separate section"
                    rather than nearly-white rows indistinguishable from the
                    summary row above. "Attempt history" (in the otherwise-
                    blank Username cell of just the first row, not a pill/
                    Badge — a plain small label sits far more naturally
                    inline in a table cell than a badge shape does) names
                    the section without the earlier caption line's verbosity. */}
                {isOpen &&
                  attempts.map((attempt, index) => {
                    const isAttemptOpen = expandedAttemptId === attempt.id;
                    // Only the four genuine question types (see
                    // QUESTION_SLIDE_TYPES' own comment) ever appear in this
                    // breakdown — accordion/flashcards/hotspot_image are
                    // self-paced completion gates with no right/wrong
                    // concept, so showing them here as a "question" that's
                    // always Correct would be actively misleading, not just
                    // unhelpful.
                    const questionResults = attempt.slide_results.filter((r) => {
                      const info = slideInfoById[r.slide];
                      return info && QUESTION_SLIDE_TYPES.has(info.slideType);
                    });
                    const hasSlideResults = questionResults.length > 0;
                    // Question order, not submission order — same numbering
                    // as slideInfoById's own "Slide X of N" (see
                    // buildSlideAnalyticsIndex); unresolvable slides (no
                    // metadata — shouldn't happen, but see that function's
                    // own defensive-skip reasoning) sort last rather than
                    // crashing the comparator.
                    const orderedResults = [...questionResults].sort(
                      (a, b) =>
                        (slideInfoById[a.slide]?.number ?? Number.MAX_SAFE_INTEGER) -
                        (slideInfoById[b.slide]?.number ?? Number.MAX_SAFE_INTEGER),
                    );
                    return (
                      <Fragment key={attempt.id}>
                        <TableRow className={cn("bg-muted hover:bg-muted", index === 0 && "border-t-2 border-t-border")}>
                          <TableCell>
                            {index === 0 && (
                              <span className="text-xs font-semibold text-muted-foreground">Attempt history</span>
                            )}
                          </TableCell>
                          <TableCell />
                          <TableCell>{attempt.score === null ? "—" : `${attempt.score}%`}</TableCell>
                          <TableCell>
                            <PassedBadge passed={attempt.passed} isAssessment={isAssessment} />
                          </TableCell>
                          <TableCell>{new Date(attempt.started_at).toLocaleDateString()}</TableCell>
                          {showDeadlineColumn && <TableCell />}
                          <TableCell>
                            {hasSlideResults && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={
                                  isAttemptOpen
                                    ? "Hide this attempt's question-by-question results"
                                    : "Show this attempt's question-by-question results"
                                }
                                aria-expanded={isAttemptOpen}
                                onClick={() => setExpandedAttemptId(isAttemptOpen ? null : attempt.id)}
                              >
                                <ChevronDown
                                  className={cn("h-4 w-4 transition-transform", isAttemptOpen && "rotate-180")}
                                />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {/* Third level: this one attempt's own question-by-
                            question breakdown. A single colSpan'd cell with
                            its own compact list, not more same-width
                            columns like the two levels above — a slide
                            result has no "attempts"/"best score"/"deadline"
                            concept to put in those columns, so reusing them
                            here would mean mostly-blank cells rather than
                            genuinely aligned data. */}
                        {isAttemptOpen && (
                          <TableRow className="bg-muted hover:bg-muted">
                            <TableCell colSpan={columnCount} className="py-2">
                              <div className="space-y-1.5 rounded-md border bg-card p-2">
                                {orderedResults.map((result) => {
                                  const info = slideInfoById[result.slide];
                                  // info is always defined here — orderedResults is
                                  // already filtered to slides with resolvable
                                  // metadata (see questionResults above) — but the
                                  // fallbacks stay as a defensive guard, same as the
                                  // rest of this file's slideInfoById lookups.
                                  const { answer, correctAnswer } = info
                                    ? describeSlideAnswer(info.slideType, info.config, result.detail)
                                    : { answer: null, correctAnswer: null };
                                  return (
                                    <div
                                      key={result.id}
                                      className="flex items-start justify-between gap-3 text-sm"
                                    >
                                      <div className="min-w-0">
                                        <span className="mr-2 font-medium text-muted-foreground">
                                          Slide {info?.number ?? "?"}:
                                        </span>
                                        <span
                                          className={cn(!info?.questionText && "text-muted-foreground")}
                                          title={info?.questionText ?? undefined}
                                        >
                                          {info?.questionText ?? (info ? SLIDE_TYPE_LABELS[info.slideType] : "Question")}
                                        </span>
                                        {/* Answer shown either way — even when
                                            right, a manager reviewing this later
                                            may not know the answer off the top of
                                            their head. Correct answer only added
                                            on top of that when wrong; when right,
                                            the answer given already IS the correct
                                            one, so repeating it a second time would
                                            add nothing. */}
                                        <span className="ml-2 text-xs text-muted-foreground">
                                          — Answer:{" "}
                                          <span className={cn(!answer && "italic")}>
                                            {answer ?? "No answer given"}
                                          </span>
                                          {!result.is_correct && correctAnswer && (
                                            <>
                                              {" · Correct answer: "}
                                              <span className="font-medium text-foreground">{correctAnswer}</span>
                                            </>
                                          )}
                                        </span>
                                      </div>
                                      <SlideCorrectBadge correct={result.is_correct} />
                                    </div>
                                  );
                                })}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
            {summaries.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-center text-muted-foreground">
                  No one has attempted this course yet.
                </TableCell>
              </TableRow>
            )}
            {summaries.length > 0 && visibleSummaries.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-center text-muted-foreground">
                  {hasActiveFilters ? "No users match the current search/filters." : "No users match this search."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollableTableContainer>
    </div>
  );
}
