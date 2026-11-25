# AGENTS.md

AgentOffice coding-agent instructions. Read this before making changes.

## Project overview

AgentOffice is an AI agent control tower. Operators manage multiple agents through a single interface: floor view, chat, calls, control room, and connect flow.

## Layering rules (enforced)

- `core` depends on nothing. It is the single source of truth for types.
- `server` depends on `core` only. Loads adapters through a registry; never imports a vendor.
- `web` depends on `core` only.
- `adapters/*` depend on `core` and `sdk` only.
- `runner` depends on `core` and `adapters`.
- `cli` composes server, web build, and adapters.

## Contracts

- `core/src/events.ts` — AgentEvent union (agent → office)
- `core/src/commands.ts` — Command union (office → agent)
- `core/src/adapter.ts` — AgentAdapter, Capability, SessionHandle, CommandResult
- `core/src/policy.ts` — Approval, PolicyConfig
- `core/asyncapi.yaml` — protocol message definitions
- `CONTEXT.md` — shared vocabulary (Office, Room, Agent, Session, Task, Event, Command, Approval, Handoff, Channel, Call, Operator)

## Coding-agent rules

1. Read the root `AGENTS.md` and relevant nested `AGENTS.md` before making changes.
2. Inspect existing code before creating a new module or dependency.
3. Give an implementation plan before a multi-file change.
4. Do not change architecture boundaries without explaining the reason.
5. Do not use `any`. Use a real type or `unknown` with validation.
6. Validate all data received from a network or external process.
7. Do not bypass authentication, authorisation, approval, or budget checks.
8. Do not add mock behaviour to production paths.
9. Do not silently change database drivers or storage locations.
10. Add tests for every behaviour change.
11. Do not weaken or delete tests to make a change pass.
12. Run the relevant type checks, lint, tests, and build.
13. Inspect the complete Git diff before finishing.
14. Report commands that were not run and tests that failed.
15. Never claim a feature works unless a test or manual check proves it.

## Repository hygiene

- Never commit runtime database files (*.db, *.db-shm, *.db-wal, *.sqlite, *.sqlite3).
- Never commit session files (*.session.md) or generated runtime output.
- Keep `.env` out of git; `.env.example` is safe to commit.
- Add ignore rules to `.gitignore` for new runtime output locations.

## Security

- Default deny: reject commands unless the user and agent have permission.
- Approval integrity: bind every approval to one immutable operation.
- Runtime validation: validate every network payload.
- Idempotency: give every command and event a stable ID.
- Audit trail: store approval decisions and important control actions.
- Never log tokens, secrets, or user/agent content.

## Commands

- `pnpm install` — install dependencies
- `cd web && npx tsc --noEmit` — type check web
- `cd core && npx tsc --noEmit` — type check core
- `cd server && npx tsc -p tsconfig.json --noEmit` — type check server
- `pnpm run build` — full build (web + server)
- `pnpm run test` — run Playwright e2e tests
