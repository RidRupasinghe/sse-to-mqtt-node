---
name: engineering-workflow
description: General software engineering workflow for sse-to-mqtt-node — scoping a change, refactoring safely, keeping the repo provider-agnostic, git hygiene, and reporting results. Use for any non-trivial change, refactor, bug fix or code review in this repo.
---

# Engineering workflow

## Scope

- Do what was asked. Note related problems you spot (bugs, leaks, unused deps) in the report instead of silently fixing them, unless they block the task.
- Keep the repo **general**: no data-provider names, request shapes or topic rules in `src/`. If a change needs provider-specific behaviour, make it configurable (options, generics, config file, topic template) instead.
- Prefer small, reversible steps. After each step, type-check.

## Refactoring

1. Find every usage before moving or renaming (`grep -rn` across `src/`, `Dockerfile`, `package.json`, `config/`).
2. Use `git mv` for renames so history is kept.
3. Preserve behaviour unless the change is the point. When behaviour changes (retry timing, logging, startup failure modes, what gets published), call it out explicitly in the report.
4. Keep one responsibility per module: fetching (`SseDataProvider`), parsing (`SseParser`), topics (`topicTemplate`), auth (`BearerTokenProvider`), publishing (`MqttPublisher`), wiring and events (`SseToMqttBridge`), config (`connectionsConfig`), CLI (`cli.ts`).

## Correctness checklist

- Inputs from outside (env, config JSON, HTTP, SSE data) are validated at the boundary with clear error messages.
- Failures of one connection don't take down the others; reconnects back off and reset after success.
- Every timer, listener and connection can be cleaned up by `stop()`.
- No secrets in logs, code or commits (`.env` is git- and docker-ignored).
- Public API changes (anything exported from `src/index.ts`, CLI flags, config fields, env vars) are reflected in `README.md` and `CHANGELOG.md`, with tests in `test/`.
- Invented facts about external APIs don't go into types. If an allowed value isn't verified, use a wider type.

## Git

- Work on a feature branch; `master` is the main branch.
- Commit only when the user asks. Group related changes, and write messages in the imperative ("Add topic templates").
- If the user limits files per commit, check `git diff --cached -M --name-status` before committing. A rename with heavy edits counts as a delete plus an add, so do the pure rename in its own commit first.
- Each commit should pass `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` on its own.
- Don't force-push, rewrite history or delete files you haven't read without confirmation.

## Reporting

- Lead with what changed and whether it works.
- State exactly what was verified (type-check, build, script run) and what wasn't (e.g. not run against a real broker or endpoint).
- List behaviour changes and follow-ups separately and briefly.
