# Repository guidance

Before changing this repository, read `CONTRIBUTING-AI.md` and the linked guidance relevant to the task.

Before planning or implementing the personal health-log milestones, read `docs/project/requirements.md` and `docs/project/m1-plan.md`.

## Agent skills

### Issue tracker

Issues and specs live in this fork's GitHub Issues. Read `docs/agents/issue-tracker.md` before reading or writing tickets.

### Triage labels

Use the five default triage labels. Read `docs/agents/triage-labels.md` before classifying or labelling tickets.

### Domain docs

Single-context: root `CONTEXT.md` and `docs/adr/`. Read `docs/agents/domain.md` before exploring domain terms or architecture decisions.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
