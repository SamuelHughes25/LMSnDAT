# LMS Project Log

Running log of architecture decisions and features/systems as we build them. Companion to `lms-project-brief.md` (the original brief) — that file is the pitch, this file is the record of what we actually decided and shipped.

## Architecture Decisions

### Confirmed from brief (no changes)
- Django + DRF + PostgreSQL, JSONB for `Question.config` / `Answer.value` — avoids table-per-question-type sprawl.
- `Template` / `TemplateVersion` split — Template is stable identity, TemplateVersion holds the actual sections/questions. Submissions point at a specific TemplateVersion so historical data is immutable against later edits.
- DigitalOcean Droplet + Spaces + Docker Compose, Caddy for reverse proxy + auto-SSL.
- React + dnd-kit for the builder, no SurveyJS — control over data shape is justified since the builder is the core product differentiator.

### Flagged / changed from brief
1. **Recurrence** — use RRULE (RFC 5545) via `python-dateutil`, stored as a string, not a hand-rolled recurrence syntax. A Celery Beat task scans active assignments and materializes new submission windows.
2. **Assignment target** — two nullable FKs (`assigned_user`, `assigned_team`) + a DB `CheckConstraint` requiring exactly one set. Not a generic/polymorphic relation.
3. **celery-beat** added as its own Compose service — recurrence + due-date reminders need a scheduler, not just a worker.
4. **Postgres backups** — cron `pg_dump` → Spaces (versioned) from day one. Single-Droplet Postgres has no managed failover/PITR, and this is an audit/compliance tool.
5. **Attachments** — private Spaces bucket, served via short-lived presigned URLs, not public ACLs (audit photos/signatures can contain sensitive material).

## Scoring: MVP or Phase 2

**Decision: full weighted-scoring/threshold engine deferred to Phase 2. MVP gets a lightweight "flagged answer" primitive.**

Why: Corrective Actions are in MVP scope and are explicitly triggered by "a failed/flagged answer," so some pass/fail concept must exist in MVP regardless of whether full scoring does. Implementation: a per-question config flag (e.g. boolean question configured "flag on No") marks an `Answer.requires_action = True` at submission time. Drives Corrective Actions without weighted scores, pass thresholds, or aggregate submission scoring.

## Proposed Project Structure

```
lms/
├── backend/
│   ├── config/               # settings/base.py, local.py, production.py; urls, celery.py
│   ├── apps/
│   │   ├── accounts/         # UserProfile, Team, roles
│   │   ├── templates_app/    # Template, TemplateVersion, Section, Question
│   │   ├── assignments/      # Assignment, recurrence
│   │   ├── submissions/      # Submission, Answer, Attachment
│   │   ├── corrective_actions/
│   │   └── core/             # shared base models, storage backend, permissions
│   ├── requirements/{base,local,production}.txt
│   └── manage.py
├── frontend/                 # Vite + React SPA, talks to API only
├── docker/{django,caddy}/
├── docker-compose.yml
└── docs/
```

Rule of thumb: each app owns its own `models.py` / `serializers.py` / `views.py` / `urls.py` / `tasks.py`. First file to grow past ~300-400 lines gets split (e.g. into a `models/` package) rather than left to grow.

## Decisions (resolved 2026-08-26)

- **Auth**: DRF SimpleJWT (token-based) issued by Django, but never touched by browser JS. See BFF pattern below.
- **Roles**: three-tier — Admin (builds/publishes templates, manages org), Manager (assigns templates, views their team's reports/completions), Member (fills out submissions).
- **Recurrence** *(updated 2026-08-26, supersedes earlier "simple enum" decision)*: RRULE (RFC 5545) via `python-dateutil` — `Assignment.recurrence_rule` stores an RRULE string (`DTSTART`/`FREQ`/`INTERVAL`/`BYDAY`/`BYMONTHDAY`). Reasoning: the requirement is both one-click presets *and* fully custom "any date/time, repeat every N days/weeks/months, on specific weekdays" — that's exactly RRULE's feature set, so we use the library instead of hand-rolling an equivalent field matrix. UI layer offers presets that generate an RRULE string plus a custom builder for everything else; the model only ever sees RRULE.
- **Frontend**: Next.js (App Router), built as a **BFF (Backend-for-Frontend)**, not a thin client shell:
  - Server Actions (not Route Handlers — see implementation note below) proxy auth to Django and set the JWT access/refresh tokens as **httpOnly cookies** on the Next.js domain — tokens never reach browser JS (no XSS token-theft surface).
  - Server Components fetch data directly from Django server-to-server using the cookie — sets up SSR for reporting/export pages later without re-architecting.
  - Consequence: **Django no longer needs to be public-facing.** Only Next.js sits behind Caddy on the public domain; Django is reachable solely over the internal Docker Compose network. Reduces attack surface for a compliance tool essentially for free.

## Features / Systems Log

### 2026-08-26 — Backend scaffold (initial)

Django project with 5 apps (`core`, `accounts`, `templates_app`, `assignments`, `submissions`, `corrective_actions`), a minimal DRF API, and Docker Compose. Verified end-to-end (see `apps/templates_app/tests.py`, `apps/submissions/tests.py`) — not just written, actually run: migrations generate and apply cleanly, and a full API walk (template → draft → sections/questions → publish → assign → submit → flagged answer → corrective action) passes.

- **`accounts`**: custom `User` model (`role`: admin/manager/member) and `Team`, set up from day one since swapping a custom user model in later is painful.
- **`templates_app`**: `Template` / `TemplateVersion` / `Section` / `Question`. `TemplateVersion.create_draft_version()` clones the latest version's sections/questions so editing never touches a published version — enforced both in the service layer and via a DB constraint (`one_draft_per_template`, partial unique index). `publish_version()` archives the previously-published version atomically. Section/Question serializers reject writes once their `TemplateVersion` is no longer a draft.
- **`assignments`**: `Assignment` with an `assigned_user`/`assigned_team` DB `CheckConstraint` (exactly one). Recurrence via RRULE string (see Decisions above); `tasks.generate_recurring_assignment_occurrences` (Celery Beat) materializes concrete occurrences 7 days ahead, `tasks.mark_overdue_assignments` flips status daily.
- **`submissions`**: `Submission.template_version` is derived server-side from `assignment.template_version` at creation — never trusted from the client, since that link is what makes historical submissions immune to later template edits. `Answer.save()` evaluates the owning `Question.flag_rule` and sets `requires_action` automatically (the MVP scoring primitive — see Decisions above).
- **`corrective_actions`**: `CorrectiveAction` linked to a flagged `Answer`; manager/member visibility scoped by `Team`.
- **Docker Compose**: `db` (Postgres 16), `redis`, `web`, `celery-worker`, `celery-beat`. Public-facing topology (Next.js-only, Django internal) not yet wired — that lands with the frontend scaffold.

Known simplifications, not yet addressed:
- A recurrence root `Assignment` (the one holding `recurrence_rule`) is itself a real, actionable assignment as well as a series definition — it can show up in a member's list alongside its generated occurrences. Fine for MVP; revisit if it causes confusion once the frontend exists.

### 2026-08-26 — Backend hardening

- **Postgres backups**: `apps.core.tasks.backup_database` (Celery Beat, daily at 03:00 UTC) shells out to `pg_dump --format=custom` and writes the dump through the same swappable `default_storage` backend already used for attachments, under a `db-backups/` prefix, with 14-day retention pruning. Reuses the existing storage abstraction rather than standing up a second bucket/credential set — noted as a deliberate MVP tradeoff (backups and user attachments share a bucket for now; revisit if that blast-radius coupling ever matters). `postgresql-client` added to the Django image for `pg_dump`. Storage/pruning logic is unit-tested with `pg_dump` itself mocked (no real Postgres in the dev sandbox) — see `apps/core/tests.py`.
- **Celery Beat schedule is now seeded by a data migration** (`apps/core/migrations/0001_seed_periodic_tasks.py`), not manual admin clicks: recurring-assignment generation (every 15 min), overdue marking (daily 01:00 UTC), and the new backup task (daily 03:00 UTC) all register automatically on `migrate`.
- **RBAC test coverage expanded**: `apps/accounts/tests.py`, `apps/assignments/tests.py`, `apps/corrective_actions/tests.py` now cover role-scoped visibility (Admin sees all / Manager sees own team / Member sees only themselves) across users, assignments, and corrective actions, plus the assignment target `CheckConstraint` and corrective-action resolution timestamp. 17 tests total, all passing.
- Fixed an `UnorderedObjectListWarning` surfaced by the new tests: `User` had no default ordering, which pagination flagged as unsafe (inconsistent/duplicate rows across pages). Added `Meta.ordering = ['username']`.

### 2026-08-26 — Frontend scaffold (initial)

Next.js 16 (App Router) app in `frontend/`, created via `create-next-app` + `shadcn` CLI (Tailwind v4, shadcn/ui components: button, input, label, card, table). Scope for this pass: project setup, the BFF auth flow end-to-end, and one real authenticated data page — **not** the drag-and-drop template builder itself, which is its own follow-on task now that this foundation is in place.

- **Next.js 16 renamed `middleware.ts` → `proxy.ts`** (same capability, new file/export name, defaults to the Node.js runtime now). Caught this by reading the framework's own bundled docs (`node_modules/next/dist/docs/`) before writing the auth gate — Next.js ships a note for exactly this situation (agent training data likely predates the current version) — rather than writing to stale training knowledge. Worth remembering for any future Next.js work in this repo.
- **Login/logout are Server Actions, not Route Handlers** — a deviation from the original Decisions entry above. Next's own App Router auth guide (bundled docs, `guides/authentication.md`) uses `<form action={serverAction}>` + `useActionState` as the idiomatic pattern; Server Actions can set cookies directly (`cookies().set(...)`) same as a Route Handler could, with less boilerplate and native `useActionState` pending/error-state wiring. Route Handlers remain the right tool for webhooks/callbacks, just not this.
- **`proxy.ts`** does an *optimistic* check (decode the JWT's `exp` claim without verifying its signature) to decide whether to attempt a token refresh before routing — not a security boundary, just a routing decision; Django re-verifies the real signature on every API call regardless. On an expired/missing access token with a live refresh token, it calls Django's refresh endpoint server-to-server and rewrites both cookies (`ROTATE_REFRESH_TOKENS` means the refresh token itself rotates too).
- **`GET /api/v1/users/me/`** added to the backend (`apps/accounts/views.py`) — the DAL (`lib/dal.ts`) needs a way to resolve "who is the current user and what's their role" from the access token; SimpleJWT's payload only carries `user_id`, not role/username, so this closes that gap. Small, tested (`apps/accounts/tests.py`) addition.
- **`lib/django.ts`**'s `djangoFetch()` is the only way Server Components/Actions should call the backend — reads the access-token cookie, attaches it as a Bearer header, redirects to `/login` on a 401 (covers the case where a token expires mid-render and `proxy.ts`'s pass didn't catch it).
- Docker Compose gained a `frontend` service (Node 22, `next dev` bound to `0.0.0.0` so the container port mapping works), with `DJANGO_API_URL=http://web:8000/api/v1` — internal Docker network only, matching the "Django isn't public-facing" decision.

Verified: `npm run build` (typechecks clean) and `npm run lint` (clean) both pass; with the Django dev server and `next dev` running side by side, confirmed via `curl`-equivalent requests that (a) an unauthenticated request to `/` gets a 307 to `/login`, and (b) `/login` renders. The full browser round-trip (submit login → cookies set → redirect → dashboard with real user data) couldn't be replayed via raw HTTP from here (Server Actions use React's own wire protocol, and no browser-automation tool was available) — confirmed working manually in a real browser instead.

### 2026-08-26 — Template builder

The drag-and-drop builder itself: `/templates` (list + create), `/templates/[id]` (detail — draft/published status, create-draft, publish), `/templates/[id]/builder` (the editor). Added `@dnd-kit/{core,sortable,utilities}` and more shadcn components (dialog, select, textarea, checkbox, badge, separator, dropdown-menu).

- **Discovered mid-build: this shadcn install uses Base UI (`@base-ui/react`), not Radix**, the classic shadcn primitive library. Base UI has no `asChild` prop — composition works via a `render` prop instead (`<DialogTrigger render={<Button />}>label</DialogTrigger>` rather than `<DialogTrigger asChild><Button>label</Button></DialogTrigger>`). Caught by the TypeScript build failing (`Property 'asChild' does not exist`) and confirmed by reading the generated `components/ui/*.tsx` and `@base-ui/react`'s own `.d.ts` files rather than guessing — same "verify against what's actually installed" discipline as the Next.js 16 proxy.ts rename. Worth remembering for any future shadcn component work in this repo: check `render` vs `asChild` before assuming classic shadcn/Radix APIs.
- **Mutation architecture**: all builder CRUD (`app/actions/templates.ts` — create/update/delete/reorder for templates, sections, and questions) goes through Server Actions calling `djangoFetch`, same pattern as auth. The builder page itself is necessarily a Client Component (drag interactivity needs local React state), so it does *not* rely on `revalidatePath` for section/question mutations — each action returns the mutated object and the client syncs its own state directly from that, keeping drags/edits snappy without a full Server Component refetch. `revalidatePath` is still used for the simpler, non-interactive template list/detail pages.
- **Reordering**: drag-and-drop is scoped to *within* a list — sections reorder among themselves, questions reorder within their own section. Dragging a question **between** sections isn't supported in this pass (would need dnd-kit's cross-container `onDragOver` handling); works around it today by delete-and-recreate in the target section. Each section runs its own nested `DndContext`/`SortableContext` rather than one shared context with custom collision detection — simpler to reason about given no cross-section dragging is needed.
- **The scoring/flagging primitive built into the backend is exposed in the builder**: boolean and single-select questions get a "flag this answer for a corrective action when the answer is…" control, writing directly to `Question.flag_rule`. Select-type questions get an options editor. Every question type gets a help-text field. Changing a question's type after creation isn't supported (delete and recreate) — kept out of scope to bound the work.
- Text field edits (title, label, help text, option labels) commit on blur, not per-keystroke, to avoid firing a PATCH per character; discrete actions (checkboxes, add/remove/reorder) persist immediately.

Verified: `npm run build` and `npm run lint` both clean.

### 2026-08-27 — Bug fixes + builder UX overhaul (SharePoint-style)

Two real bugs from live testing, then a full redesign of the builder's interaction model per user feedback ("clunky," everything white and merged together, add-question silently failing).

**Bugs fixed:**
- **"Add question" did nothing**: `DropdownMenuItem` was wired with `onSelect`, the Radix convention — Base UI's `Menu.Item` has no `onSelect` prop at all (confirmed via its `.d.ts`), only `onClick`. The click closed the menu (default `closeOnClick` behavior) without ever invoking the handler, so it looked like the selection "just disappeared." Second instance of the Radix-vs-Base-UI assumption gap from the previous session — worth internalizing: **this project's shadcn install is Base UI, not Radix, full stop** — check prop names against the generated component / `.d.ts`, don't assume Radix conventions anywhere in this codebase.
- **Everything visually merged together**: `--background` and `--card` were both pure white (`oklch(1 0 0)`) with a barely-visible border token. Fixed with a proper elevation hierarchy: muted-gray page background, white cards with `shadow-sm` + heavier borders, question rows tinted to read as nested inside their section.

**Builder redesign** (user's direction: emulate SharePoint's page-editor layout — left nav unchanged, middle = drag/organize canvas, right = contextual properties panel): rebuilt `template-builder.tsx`, `section-card.tsx`, `question-row.tsx`; added `properties-panel.tsx`, `section-properties.tsx`, `question-properties.tsx`, `question-type-icon.tsx`.

- **Selection model**: a single `Selection` (section or question, or none) lives in `TemplateBuilder` state. Clicking a canvas row selects it; the right panel renders that item's full editor. Canvas rows now only carry: drag handle, type icon, inline-editable label/title, a required-asterisk indicator, delete button — help text, the required toggle, select options, and the flag-rule editor all moved into the panel.
- **State/persistence centralized**: all `update*`/`delete*`/`reorder*` Server Action calls and the `sections` state updates that used to live inside `SectionCard`/`QuestionRow` now live in `TemplateBuilder`, passed down as callbacks. Canvas and panel both read from the same lifted `sections` array, so an edit in either place is immediately consistent in both — no duplicated persistence logic between the two surfaces.
- **Panel remounts on selection change** (`key={panelKey}` on `<PropertiesPanel>`) — several of its fields use `defaultValue` + commit-on-blur (`Textarea` for help text/description, `SelectOptionsEditor`'s internal local state), which are uncontrolled and would otherwise show stale content when switching between items without a full remount.
- **Publish moved into the builder** (top-right of the canvas header) rather than living only on the template detail page — redirects to the detail page on success, since a published draft stops existing as a draft and the builder page 404s without one.
- Newly created sections/questions auto-select, so the panel opens immediately for configuring them — matches the "add then configure" flow of the tools this is modeled on.

Verified: `npm run build` and `npm run lint` both clean.

### Not yet built
- Cross-section question dragging (see above).
- Assignments/submissions/corrective-actions UI — only the template builder exists so far.
- DigitalOcean droplet deployment, Caddy reverse proxy, Spaces wiring.
