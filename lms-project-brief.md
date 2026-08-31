# Project Brief: Internal LMS / Audit Template Platform

## Context

I work for a mid-to-large company that currently uses Mitti (formerly SafetyCulture/iAuditor) to manage audits, inspections, and compliance checklists. Our HR department is actively unhappy with it and looking at alternatives. I want to build an internal replacement, focused specifically on making the **template creation/builder experience** as feature-rich, flexible, and easy to use as possible — since most of the templates our company uses are already fully custom, template authoring is the highest-value part of this system.

This is an extensive, long-running project, not a quick script. I need you to treat it like a real piece of software: proper architecture, modular structure, and maintainability from day one. I have a habit of writing monolithic files and I explicitly do NOT want that here — please push back on me if I ask for something that would lead to a monolith, and structure the codebase into clear, separated modules/packages from the start.

**Important context on how this gets deployed**: I want to build and self-host this entirely on my own before ever showing it to my company — I want a genuinely working, live, deployed version I can demo from a real URL, not something that only runs on my laptop. Budget is small (aiming for roughly $30-35/month), so please favor self-hosted, low-cost choices over managed/enterprise services wherever reasonable for this stage.

## What the product needs to do (functional scope)

1. **Org structure**: Users, Teams, managers who can see their team's completions/reports.
2. **Template builder**: Create templates made of sections, each containing ordered questions. Question types needed at minimum: text, number, boolean (yes/no), single-select, multi-select, date, photo evidence, signature, GPS/location capture, barcode/QR scan, section headers, and instruction/informational blocks.
3. **Conditional logic**: Questions can be shown/hidden based on the answer to another question in the same template (e.g. "only show Q7 if Q3 = No").
4. **Template versioning**: Editing a published template must NOT retroactively change historical submissions. Every submission is tied to the exact template version it was filled out against. Templates can be draft or published.
5. **Assignments**: Templates get assigned to a user or a team, with a due date and optional recurrence (e.g. "every Monday"). Assignment status should track pending/in progress/complete/overdue.
6. **Submissions**: Users fill out an assigned template. Each answer is stored against its question, with support for attachments (photos, signatures) linked to specific answers.
7. **Corrective actions**: A failed/flagged answer can spawn a corrective action — a follow-up task with an owner, due date, and status (open/in progress/resolved).
8. **Scoring** (open decision, see below): weighted questions, pass/fail thresholds, overall submission score — TBD whether this is MVP or phase 2.
9. **Reporting/dashboards**: Not detailed yet — will need trend analysis, non-conformance tracking, and export (PDF/Excel) eventually, but this is not the immediate focus.

## What is explicitly OUT of scope for now (phase 2+)

- **Offline mode** (fill out forms with no signal, sync later) — deliberately deferred. This is a PWA/service-worker + IndexedDB + sync-endpoint problem in its own right and I don't want it complicating the MVP architecture, though the data model shouldn't actively make it impossible later.
- Full reporting/analytics dashboards.
- Any SSO/Azure AD integration — auth can start simple and be swapped later, but keep the User model decoupled enough that this isn't painful.

## Proposed stack (open to your challenge on any of this)

- **Backend**: Django + Django REST Framework, PostgreSQL (using JSONB fields for flexible per-question-type config and per-answer values, rather than a table-per-question-type approach).
- **Frontend**: React, with dnd-kit for the drag-and-drop template builder UI. Not planning to use a pre-built form library like SurveyJS for the builder itself, since I want more control over data structure — open to being talked out of this if you think it's a mistake.
- **Background jobs**: Celery + Redis, for recurring assignment generation, due-date reminders/escalations, and (later) report generation.
- **File storage**: originally planned Azure Blob since my company is an M365 shop, but since I'm self-hosting this on my own before it ever goes near company infrastructure, I'd rather use DigitalOcean Spaces (S3-compatible, ~$5/mo for 250GB) — same API shape as S3, so it wouldn't be painful to move to Azure Blob or AWS S3 later if the company adopts this.

## Self-hosting / deployment plan

- **Where it runs**: A single DigitalOcean Droplet (2 vCPU / 4GB, ~$24/mo) running everything via Docker Compose — Django, PostgreSQL, Redis, and the Celery worker all on one box. Deliberately not paying for managed Postgres/Redis at this stage; that's a "when this becomes real" upgrade, not a day-one need.
- **Storage**: DigitalOcean Spaces for attachments (photos, signatures), ~$5/mo.
- **Domain + SSL**: A real domain (~$1/mo amortized) with free SSL via Let's Encrypt, fronted by Caddy or nginx as a reverse proxy.
- **CI/deploy**: Keep this simple for now — a straightforward Docker Compose deploy process I can run manually or via a basic script, not a full CI/CD pipeline. Don't over-engineer deployment infrastructure before the product itself exists.
- Please design the settings/config layer (env vars, secrets, storage backend, database connection) so that swapping from self-hosted Postgres/Spaces to a managed provider or Azure later is a config change, not a rewrite.

## Draft data model (from earlier design pass — treat as a starting point, not gospel)

Core entities: `Team`, `UserProfile`, `Template`, `TemplateVersion`, `Section`, `Question` (with `question_type`, `config` JSONB, `display_logic` JSONB), `Assignment` (points at a `TemplateVersion`, assigned to a user or team, has `due_date`/`recurrence_rule`/`status`), `Submission` (points at both an `Assignment` and the specific `TemplateVersion`), `Answer` (JSONB `value`, linked to a `Question`), `Attachment` (linked to an `Answer`), `CorrectiveAction` (linked to an `Answer`).

Key design principle carried over from that pass: **Template and TemplateVersion are separate** — Template is the stable identity, TemplateVersion holds the actual sections/questions for a given draft/published version, so historical submissions are never corrupted by later template edits.

## What I want from you right now

I don't want you to just start writing code. Please:

1. Propose a clean project structure/architecture for this (Django app layout, where the API layer sits, how frontend and backend are organized as separate concerns) before writing anything.
2. Flag anything in my proposed data model or stack that you think is wrong, will bite me later, or is overengineered/underengineered for an MVP.
3. Give me your recommendation on the scoring question above — MVP or phase 2 — with reasoning.
4. Once we've agreed on structure, start scaffolding the backend models, migrations, and a minimal DRF API for: creating a template, adding sections/questions to it, publishing a version, assigning it, and submitting answers against it. Hold off on the React builder UI until the backend contracts are solid.
5. As we go, keep me honest about modularity — if a file or module is growing into a monolith, tell me and propose how to split it, don't just let it grow.
6. Include a basic Docker Compose setup (Django, Postgres, Redis, Celery) as part of the initial scaffolding so I can run this locally and deploy the same setup to the Droplet with minimal changes.

Ask me clarifying questions if anything above is ambiguous before you start scaffolding.
