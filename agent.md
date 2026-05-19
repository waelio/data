---
name: waelio-data-strict-agent
description: Strict execution policy for contributors and coding agents in @waelio/data.
version: 1
appliesTo:
  - '**/*'
priority: high
---

## @waelio/data — Strict Agent Contract

This file defines mandatory operating rules for all code changes in this repository.

## Repository Identity

- Package: `@waelio/data`
- Language: TypeScript (strict)
- Runtime: Node.js
- Outputs: CommonJS + ESM + type declarations
- Scope: local secure reactive JSON database + binary file store + authenticated HTTP API + SSE updates

## Core Files

- `src/Database.ts` — JSON storage, optional encryption, collection/key semantics, emitted change events.
- `src/FileStore.ts` — binary file persistence and retrieval.
- `src/server.ts` — auth, CORS, routes (`/collections`, `/:collection/:key`, `/files/*`, `/events`).
- `src/client.ts` — client-facing integration utilities.
- `src/index.ts` — public exports.
- `test/*.test.ts` — behavioral contract tests.

## Absolute Do / Don’t Rules

### Do

1. Keep diffs minimal and directly tied to the requested behavior.
2. Add or update tests when behavior changes.
3. Preserve existing API shapes unless a breaking change is explicitly requested.
4. Keep security-first defaults (localhost bind, token auth, safe comparisons).
5. Keep route responses explicit and deterministic (`status`, predictable JSON body shape).

### Don’t

1. Don’t convert TypeScript files to JavaScript.
2. Don’t silently alter auth logic, token handling, or timing-safe comparison behavior.
3. Don’t weaken file route path validation (must continue blocking traversal attempts).
4. Don’t reformat unrelated files or refactor unrelated subsystems in the same change.
5. Don’t change defaults (`127.0.0.1`, secure behavior) unless requested.

## Required Validation Gates (Must Pass Before Completion)

1. `npm test`
2. If exports/build inputs changed: `npm run build`
3. Confirm no regressions in:
   - bearer token enforcement
   - CORS behavior
   - SSE event broadcasting
   - JSON route behavior
   - file route traversal protection

If any gate fails, do not mark task complete until fixed or explicitly accepted.

## Editing Guardrails

- Prefer targeted edits over broad rewrites.
- Keep naming and coding style consistent with nearby code.
- Avoid introducing new dependencies unless clearly justified.
- When adding endpoints or events, include tests that cover success + failure paths.

## PR / Change Summary Requirements

Every completed change should state:

1. What changed.
2. Why it changed.
3. How it was verified (tests/build/checks run).
4. Any residual risks or follow-ups.
