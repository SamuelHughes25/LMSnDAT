"use server";

import { revalidatePath } from "next/cache";

import { DjangoApiError, djangoFetch, extractErrorDetail } from "@/lib/django";
import { DEFAULT_SLIDE_TITLE } from "@/lib/course-types";
import type {
  Course,
  CourseAsset,
  CourseAssignment,
  CourseVersion,
  Lesson,
  ReusableLesson,
  Slide,
  SlideConfig,
  SlideType,
} from "@/lib/course-types";
import type { Paginated } from "@/lib/types";

// --- Courses ---

// `thumbnail` is optional and, when present, forces a multipart request
// (djangoFetch's isFormData branch — see lib/django.ts) since a JSON body
// can't carry a raw File. Built as FormData unconditionally rather than
// branching JSON-vs-multipart on whether a thumbnail was picked: one
// request shape for this action, not two independently-drifting ones.
export async function createCourse(name: string, description: string, thumbnail?: File | null): Promise<Course> {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("description", description);
  if (thumbnail) formData.append("thumbnail", thumbnail);
  const course = await djangoFetch<Course>("/courses/", {
    method: "POST",
    body: formData,
  });
  revalidatePath("/courses");
  return course;
}

// Separate from createCourse above — settings/course-thumbnail-settings.tsx
// calls this for a course that already exists, uploading immediately (same
// "commit on selection" pattern as the course builder's own image fields)
// rather than staging a File until some later form submit. Removal (`null`)
// goes through as a plain JSON PATCH — a multipart form has no clean way to
// express "clear this field," but the model's `null=True` already makes the
// generated DRF field `allow_null=True`, so JSON `null` clears it directly.
export async function updateCourseThumbnail(courseId: string, thumbnail: File | null): Promise<Course> {
  let course: Course;
  if (thumbnail) {
    const formData = new FormData();
    formData.append("thumbnail", thumbnail);
    course = await djangoFetch<Course>(`/courses/${courseId}/`, { method: "PATCH", body: formData });
  } else {
    course = await djangoFetch<Course>(`/courses/${courseId}/`, {
      method: "PATCH",
      body: JSON.stringify({ thumbnail: null }),
    });
  }
  revalidatePath(`/courses/${courseId}/settings`);
  revalidatePath("/courses");
  return course;
}

export async function createDraft(courseId: string): Promise<CourseVersion> {
  const version = await djangoFetch<CourseVersion>(`/courses/${courseId}/create-draft/`, {
    method: "POST",
  });
  revalidatePath(`/courses/${courseId}`);
  return version;
}

export async function publishVersion(courseId: string, versionId: string): Promise<CourseVersion> {
  const version = await djangoFetch<CourseVersion>(`/course-versions/${versionId}/publish/`, {
    method: "POST",
  });
  revalidatePath(`/courses/${courseId}`);
  return version;
}

// Hard-deletes a DRAFT version outright — not the same two-stage archive/
// restore path deleteCourse below uses for a whole Course. A draft isn't
// independently meaningful content the way a course is (nothing links to
// it from outside its own course — no CourseAttempt, no assignment, none
// of the PROTECT relationships a published version can accumulate), so
// there's nothing here worth keeping recoverable in the Archive the way
// an accidentally-deleted course is. CourseVersionViewSet has no custom
// destroy() override — this is the plain DRF ModelViewSet delete,
// cascading to the draft's own lessons/slides/assets via their ordinary
// on_delete=CASCADE. Only ever called with a DRAFT version's id — the
// one caller (delete-course-draft-button.tsx) only ever renders next to
// an existing draft, never a published one.
export async function deleteCourseDraft(
  courseId: string,
  versionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<void>(`/course-versions/${versionId}/`, { method: "DELETE" });
    revalidatePath(`/courses/${courseId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError) {
      const detail = extractErrorDetail(err, "This draft can't be deleted right now.");
      return { ok: false, error: detail ?? "This draft can't be deleted right now." };
    }
    throw err;
  }
}

// --- Hard edit lock ("someone's already in the builder") ---
//
// NOT real-time collaborative editing — see Course.editing_user's own
// comment on the backend for the full reasoning (deliberately out of
// scope: a lot of ongoing complexity for little real benefit with this
// app's handful of internal authors). This is the much simpler
// claim/heartbeat/release lock instead: course-builder.tsx claims it on
// mount, re-claims it on an interval to keep it fresh, and releases it on
// unmount; the courses list reads `currently_editing_by` (course-types.ts)
// to grey out a card someone else is already in.
//
// A genuine hard lock — there is no override. An earlier version let the
// frontend pass `force` to take over anyway after a warning; removed
// outright (frontend and backend both — see claim_edit's own comment) once
// it became clear what that actually permitted: two people in the same
// slide at once, where every save PATCHes that slide's ENTIRE config as a
// full overwrite built from whichever browser's own (possibly stale) copy
// last saved — not a per-field merge, so the second editor's save could
// silently erase the first editor's unrelated changes on the same slide
// the instant either one saved. A warning the user can click past doesn't
// prevent that; only actually keeping the second person out does.
export type ClaimCourseEditResult =
  | { ok: true }
  | { ok: false; conflict: true; editingBy: string }
  | { ok: false; conflict: false; error: string };

export async function claimCourseEdit(courseId: string): Promise<ClaimCourseEditResult> {
  try {
    await djangoFetch<Course>(`/courses/${courseId}/claim-edit/`, { method: "POST" });
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 409) {
      try {
        const body: unknown = JSON.parse(err.message);
        const editingBy =
          body && typeof body === "object" && "editing_by" in body && typeof body.editing_by === "string"
            ? body.editing_by
            : "someone else";
        return { ok: false, conflict: true, editingBy };
      } catch {
        return { ok: false, conflict: true, editingBy: "someone else" };
      }
    }
    if (err instanceof DjangoApiError) {
      return { ok: false, conflict: false, error: err.message };
    }
    throw err;
  }
}

// Best-effort, deliberately silent on failure — this fires from a client-
// side unmount/beforeunload cleanup, where the network may already be
// going away (the tab closing) and there is nothing a Server Action could
// usefully show the user at that point anyway. A release that never
// arrives isn't a correctness problem either way: EDIT_LOCK_STALE_SECONDS
// on the backend frees the lock on its own once the heartbeat stops.
export async function releaseCourseEdit(courseId: string): Promise<void> {
  try {
    await djangoFetch<void>(`/courses/${courseId}/release-edit/`, { method: "POST" });
  } catch {
    // Swallowed deliberately — see comment above.
  }
}

// DELETE now archives rather than hard-deleting (see the backend's
// CourseViewSet.destroy) — the course disappears from this list and from
// everyone's portal, but all its data/attempts/analytics stay fully
// intact and reversible from the Archive page (restoreCourse/purgeCourse
// above). The real, final hard delete — which DOES need to deal with
// CourseAttempt.course_version's on_delete=PROTECT — only lives behind
// purgeCourse now. The result-object shape here is kept (rather than
// letting a Server Action throw) in case a future constraint ever makes
// archiving itself fail; today it always succeeds for an existing course.
export async function deleteCourse(courseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<void>(`/courses/${courseId}/`, { method: "DELETE" });
    revalidatePath("/courses");
    return { ok: true };
  } catch (err) {
    const detail = extractErrorDetail(err, "This course can't be archived right now.");
    if (detail !== null) return { ok: false, error: detail };
    throw err;
  }
}

// --- Archive ---
// deleteCourse above now archives instead of hard-deleting (see the
// backend's CourseViewSet.destroy) — restoreCourse/purgeCourse are the
// rest of that lifecycle, only ever called from the Archive page.

export async function restoreCourse(courseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<Course>(`/courses/${courseId}/restore/`, { method: "POST" });
    revalidatePath("/archive");
    revalidatePath("/courses");
    return { ok: true };
  } catch (err) {
    const detail = extractErrorDetail(err, "This course can't be restored right now.");
    if (detail !== null) return { ok: false, error: detail };
    throw err;
  }
}

// The real, final hard delete — purges this course's attempt history
// across every user who took it (see the backend's CourseViewSet.purge),
// so unlike deleteCourse's "rare failure" framing above, a 400 here is a
// real, user-facing outcome that needs the actual backend message (e.g.
// "Only archived courses can be permanently deleted"), not a generic one.
export async function purgeCourse(courseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<void>(`/courses/${courseId}/purge/`, { method: "POST" });
    revalidatePath("/archive");
    return { ok: true };
  } catch (err) {
    const detail = extractErrorDetail(err, "This course can't be permanently deleted.");
    if (detail !== null) return { ok: false, error: detail };
    throw err;
  }
}

// Owner-or-admin only on the backend (IsContentOwnerOrAdmin) — a plain
// editor attempting either of these gets a clean 403 {"detail": "..."}, the
// same body shape describeAssignmentError below already parses, so both
// reuse it instead of duplicating that extraction logic.
export async function transferCourseOwnership(
  courseId: string,
  newOwnerId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<Course>(`/courses/${courseId}/transfer-ownership/`, {
      method: "POST",
      body: JSON.stringify({ owner: newOwnerId }),
    });
    revalidatePath(`/courses/${courseId}/members`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError && (err.status === 400 || err.status === 403)) {
      return { ok: false, error: describeAssignmentError(err) };
    }
    throw err;
  }
}

// Full replace, same "send the complete list" convention as
// addUserToGroup/removeUserFromGroup's content_groups PATCH in
// actions/users.ts — not an incremental add/remove.
export async function setCourseEditors(
  courseId: string,
  editorIds: number[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<Course>(`/courses/${courseId}/set-editors/`, {
      method: "POST",
      body: JSON.stringify({ editors: editorIds }),
    });
    revalidatePath(`/courses/${courseId}/members`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError && (err.status === 400 || err.status === 403)) {
      return { ok: false, error: describeAssignmentError(err) };
    }
    throw err;
  }
}

// The Groups tab's save action, from the course's own side — see
// CourseViewSet.set_groups's own comment for why this is deliberately NOT
// a PATCH to /groups/{id}/ (that's still gated by the full 'groups' tab;
// this lets an owner/editor-with-can_edit_course_groups toggle just THIS
// course's own membership without needing broader group-management
// access). Full-replace, same "send the complete list" convention as
// setCourseEditors above.
export async function setCourseGroups(
  courseId: string,
  groupIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<Course>(`/courses/${courseId}/set-groups/`, {
      method: "POST",
      body: JSON.stringify({ groups: groupIds }),
    });
    revalidatePath(`/courses/${courseId}/roles`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DjangoApiError && (err.status === 400 || err.status === 403)) {
      return { ok: false, error: describeAssignmentError(err) };
    }
    throw err;
  }
}

// One group's checkbox worth of change, computed into the full-replace
// list setCourseGroups needs — same "the toggle component only knows
// about ONE group, the page/action does the list math" shape as
// toggleCourseInGroup in actions/groups.ts, just from the course's own
// side. `currentGroupIds` comes from the already-fetched course.group_ids
// (bound in by the page, same pattern as toggleCourseInGroup.bind(null,
// group.id, id) there), not re-fetched here.
export async function toggleCourseGroup(
  courseId: string,
  groupId: string,
  currentGroupIds: string[],
  add: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const nextIds = add
    ? [...new Set([...currentGroupIds, groupId])]
    : currentGroupIds.filter((gId) => gId !== groupId);
  return setCourseGroups(courseId, nextIds);
}

export async function updateCourseAssessmentSettings(
  courseId: string,
  isAssessment: boolean,
  passingScore: number | null,
): Promise<Course> {
  const course = await djangoFetch<Course>(`/courses/${courseId}/`, {
    method: "PATCH",
    body: JSON.stringify({ is_assessment: isAssessment, passing_score: passingScore }),
  });
  revalidatePath(`/courses/${courseId}/settings`);
  return course;
}

// Deliberately separate from updateCourseAssessmentSettings above — a
// deadline is its own, independent concept, not conditional on the course
// being a scored assessment. A purely informative onboarding course with
// no questions at all can still need a "watch this in your first week"
// deadline; forcing that through the assessment toggle would make it
// impossible to express. See Course.deadline's own comment in
// backend/apps/courses/models.py.
export async function updateCourseDeadline(courseId: string, deadline: string | null): Promise<Course> {
  const course = await djangoFetch<Course>(`/courses/${courseId}/`, {
    method: "PATCH",
    body: JSON.stringify({ deadline }),
  });
  revalidatePath(`/courses/${courseId}/settings`);
  return course;
}

// --- Lessons ---
// No revalidatePath below: the builder page keeps its own client-side state
// (needed for drag-and-drop) and syncs it directly from each action's
// return value rather than forcing a full Server Component refetch.

export async function createLesson(courseVersionId: string, order: number): Promise<Lesson> {
  return djangoFetch<Lesson>("/lessons/", {
    method: "POST",
    body: JSON.stringify({ course_version: courseVersionId, title: "New lesson", description: "", order }),
  });
}

export async function updateLesson(
  lessonId: string,
  data: Partial<Pick<Lesson, "title" | "description" | "order">>,
): Promise<Lesson> {
  return djangoFetch<Lesson>(`/lessons/${lessonId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteLesson(lessonId: string): Promise<void> {
  await djangoFetch<void>(`/lessons/${lessonId}/`, { method: "DELETE" });
}

export async function reorderLessons(lessons: { id: string; order: number }[]): Promise<void> {
  await Promise.all(
    lessons.map((l) =>
      djangoFetch(`/lessons/${l.id}/`, { method: "PATCH", body: JSON.stringify({ order: l.order }) }),
    ),
  );
}

// --- Reusable lessons ---
// The saved-lesson library: save a lesson's slides as a standalone,
// reusable entry, import a copy of one into a (different, or the same)
// course's draft. Both directions are a one-time CLONE, never a live link —
// editing either side afterward never affects the other (see the backend's
// ReusableLesson model docstring). No revalidatePath, same reasoning as the
// rest of this section — the builder syncs its own state from the returned
// value.

export async function saveLessonAsReusable(
  lessonId: string,
  name: string,
  description: string,
): Promise<ReusableLesson> {
  return djangoFetch<ReusableLesson>(`/lessons/${lessonId}/save-as-reusable/`, {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export async function listReusableLessons(): Promise<ReusableLesson[]> {
  const data = await djangoFetch<Paginated<ReusableLesson>>("/reusable-lessons/?page_size=200");
  return data.results;
}

export async function importReusableLesson(
  courseVersionId: string,
  reusableLessonId: string,
  order: number,
): Promise<Lesson> {
  return djangoFetch<Lesson>(`/reusable-lessons/${reusableLessonId}/import/`, {
    method: "POST",
    body: JSON.stringify({ course_version: courseVersionId, order }),
  });
}

export async function deleteReusableLesson(reusableLessonId: string): Promise<void> {
  await djangoFetch<void>(`/reusable-lessons/${reusableLessonId}/`, { method: "DELETE" });
}

// --- Slides ---

// Default config per slide_type on creation. "content", "multiple_choice",
// "missing_word", and "match_pairs" exist this stage — the switch is
// structured so later slide types slot in as new cases without a rewrite.
function defaultSlideConfig(slideType: SlideType): SlideConfig {
  switch (slideType) {
    case "missing_word":
      return { paragraph: "", blanks: [] };
    case "match_pairs":
      // Empty pairs list on creation, matching missing_word's empty-blanks
      // default above — the backend's match_pairs validation is
      // deliberately built to accept `pairs: []` from the start (see
      // backend/apps/courses/serializers.py), so this never fails its own
      // creation request the way an over-strict default once did for the
      // other two types.
      return { instructions: "", pairs: [] };
    case "multiple_choice":
      // The backend requires at least one option marked correct on every
      // save (not just at publish), so the first option defaults to
      // is_correct: true — otherwise a brand-new slide would fail its own
      // creation request before the author ever gets a chance to pick one.
      return {
        question: "",
        options: [
          { id: `option_1_${Date.now().toString(36)}`, text: "", is_correct: true },
          { id: `option_2_${Date.now().toString(36)}`, text: "", is_correct: false },
        ],
        feedback_incorrect: "",
      };
    case "content":
      // Genuinely empty — no `layout`, so content-slide-face.tsx renders
      // the new freeform system (see SlideConfig.layout's own comment) with
      // zero text boxes/images, not the old title-body-by-default. The
      // author adds boxes themselves via "Add text box" / the image panel,
      // or starts from a "Templates" preset if they want a quick-start
      // arrangement instead.
      return { text_boxes: [], object_order: [] };
    default:
      return { body: "", image_url: null, image_position: "top" };
  }
}

export async function createSlide(lessonId: string, slideType: SlideType, order: number): Promise<Slide> {
  return djangoFetch<Slide>("/slides/", {
    method: "POST",
    body: JSON.stringify({
      lesson: lessonId,
      slide_type: slideType,
      title: DEFAULT_SLIDE_TITLE,
      order,
      config: defaultSlideConfig(slideType),
    }),
  });
}

export async function updateSlide(
  slideId: string,
  data: Partial<Pick<Slide, "title" | "order" | "config">>,
): Promise<Slide> {
  return djangoFetch<Slide>(`/slides/${slideId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteSlide(slideId: string): Promise<void> {
  await djangoFetch<void>(`/slides/${slideId}/`, { method: "DELETE" });
}

export async function reorderSlides(slides: { id: string; order: number }[]): Promise<void> {
  await Promise.all(
    slides.map((s) =>
      djangoFetch(`/slides/${s.id}/`, { method: "PATCH", body: JSON.stringify({ order: s.order }) }),
    ),
  );
}

// --- Course assets ---

// Called directly from image-field.tsx's client-side upload handler (a
// Server Action can be invoked imperatively like any async function, not
// just via a <form action>). `formData` already carries "course_version",
// "kind", and "file" — built client-side because the file itself only
// exists in the browser. djangoFetch forwards it to Django as-is; see the
// isFormData branch there for why it must NOT get a JSON Content-Type.
export async function uploadCourseAsset(formData: FormData): Promise<CourseAsset> {
  return djangoFetch<CourseAsset>("/course-assets/", {
    method: "POST",
    body: formData,
  });
}

// --- Direct course assignments ---
// A course directly assigned to one specific user, independent of Group
// membership — see CourseAssignment's own comment in course-types.ts. No
// conflict check against existing Group access on either side: a user
// already covered by a Group that includes this course can still be
// directly assigned with no error (Groups routinely overlap on the same
// course) — the Members tab never cross-checks the two.

// DjangoApiError's `message` is the raw DRF response body (djangoFetch does
// `await res.text()`, not `.json()` — see lib/django.ts). The two expected
// shapes are special-cased for a friendlier message: `{"non_field_errors":
// [...]}` (the model's own UniqueConstraint, surfaced automatically by DRF
// — see CourseAssignmentTests.test_duplicate_assignment_is_a_clean_400_not
// _a_500) and `{"detail": "..."}` (a raised PermissionDenied, e.g.
// perform_create's team check). Anything else DRF could plausibly send —
// per-field validation errors like `{"user": ["Invalid pk \"999\" - object
// does not exist."]}`, e.g. if the target user was deleted in the gap
// between this page loading and the click — still surfaces SOME real
// message instead of falling all the way back to the generic one, by just
// taking the first string found anywhere in the body. Deliberately never
// throws itself; a truly malformed/non-JSON body just means the generic
// fallback below, not a second error on top of the first.
function describeAssignmentError(err: DjangoApiError): string {
  try {
    const body: unknown = JSON.parse(err.message);
    if (body && typeof body === "object") {
      if ("non_field_errors" in body && Array.isArray(body.non_field_errors) && body.non_field_errors[0]) {
        return "This user is already directly assigned to this course.";
      }
      if ("detail" in body && typeof body.detail === "string") {
        return body.detail;
      }
      for (const value of Object.values(body)) {
        if (typeof value === "string") return value;
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      }
    }
  } catch {
    // Not JSON — fall through to the generic message below.
  }
  return `Something went wrong (status ${err.status}).`;
}

export type CourseAssignmentActionResult =
  | { ok: true; assignment: CourseAssignment }
  | { ok: false; error: string };

// Returns a result object rather than letting a DjangoApiError propagate —
// per Next.js's own guidance (see node_modules/next/dist/docs/01-app/
// 01-getting-started/10-error-handling.md's "Handling expected errors"),
// an EXPECTED failure (a duplicate assignment from a double-click, a
// manager's team check) should be modeled as a return value, not a thrown
// error: a Server Action's thrown error message is redacted to a generic
// string in a production build (unlike dev, where the real message shows),
// so course-access-cell.tsx could never actually display "already
// assigned" by catching a throw — only by reading it off a normal return
// value instead. A genuinely unexpected error (network failure, a real
// 500) still rethrows, so it reaches (dashboard)/error.tsx same as before.
export async function addCourseAssignment(courseId: string, userId: number): Promise<CourseAssignmentActionResult> {
  try {
    const assignment = await djangoFetch<CourseAssignment>("/course-assignments/", {
      method: "POST",
      body: JSON.stringify({ course: courseId, user: userId }),
    });
    revalidatePath(`/courses/${courseId}/members`);
    return { ok: true, assignment };
  } catch (err) {
    if (err instanceof DjangoApiError && err.status === 400) {
      return { ok: false, error: describeAssignmentError(err) };
    }
    throw err;
  }
}

export async function removeCourseAssignment(
  assignmentId: string,
  courseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await djangoFetch<void>(`/course-assignments/${assignmentId}/`, { method: "DELETE" });
    revalidatePath(`/courses/${courseId}/members`);
    return { ok: true };
  } catch (err) {
    // 404 here means someone else (another admin, another tab) already
    // removed this exact row — not a real failure from this click's point
    // of view, the assignment is gone either way, which is what the click
    // wanted. Still revalidate so this page's own stale copy of the list
    // (which is what showed a since-deleted row as removable in the first
    // place) catches up on the next render instead of offering the same
    // dead "remove" action again.
    if (err instanceof DjangoApiError && err.status === 404) {
      revalidatePath(`/courses/${courseId}/members`);
      return { ok: true };
    }
    throw err;
  }
}
