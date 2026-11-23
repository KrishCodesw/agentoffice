# AgentOffice: End-to-End Project Plan

Draft v1, November 20, 2026. Companion to the PRD and the UI mockups. AgentOffice is a working name.
## 1. Purpose

This plan turns the PRD into a buildable project. It copies the parts of the pixel-agents (<https://github.com/pixel-agents-hq/pixel-agents>) structure that are proven: strict layering, one typed integration boundary, a single protocol file, and a server that runs anywhere. It changes the parts that keep pixel-agents a viewer for Claude Code, so that AgentOffice becomes a control and communication tool for any agent.

## 2. What we borrow, change and add

| Area | pixel-agents | AgentOffice |
| --- | --- | --- |
| Repo shape | Monorepo: core, server, adapters (VS Code), webview-ui, docs, e2e | Same idea: core, server, adapters, web, runner, sdk, cli, docs, e2e |
| Layering | core depends on nothing; server and UI depend only on core | Keep exactly, and enforce it with lint rules and CI |
| Protocol | An AsyncAPI file is the single source of truth; message types are generated | Keep. Extend it with commands, chat, calls and approvals |
| Integration boundary | HookProvider turns Claude hook events into an AgentEvent; Claude is the only implementation today | AgentAdapter with two directions (events in, commands out) plus capability flags |
| Detection | Hooks first, transcript scanning as fallback | Three connect modes: Managed, Attached, Observed |
| Control | Launch agents in terminals and attach to them; status shown visually | Message, broadcast, pause, stop, approve, take over, hand off |
| Communication | Speech bubbles and sounds | Always-on chat channels and voice calls |
| Supervision | Visual status | Approvals queue, budgets, audit log, kill switch |
| Persistence | Files under a home folder | SQLite by default (zero setup for npx), Postgres later |
| Vendor scope | Claude Code now; others on the roadmap | Claude, OpenAI, HTTP, CLI and MCP through one SDK |
| Docs for AI | A compressed CLAUDE.md reference and a CONTEXT.md vocabulary | Same, because we will build with agents too |

Honest note: as far as their public docs show, their provider boundary is observation-oriented. The outbound command path is our main addition, so it is also our biggest design risk.

## 3. Principles

1. The contract is the product. Adapter, event, command and protocol types come first.
2. Vendor knowledge lives in one folder per vendor and nowhere else.
3. The UI never knows which vendor an agent is.
4. Every control is gated by a capability flag, so we never promise what an agent cannot do.
5. Safe by default: risky actions need approval, budgets pause runaway agents.
6. The floor is a view, not a dependency. Chat and the Control room work without it.
7. Local-first now, hosted later without a rewrite.
8. Everything is testable with mock agents.

## 4. Repo structure

```
agentoffice/
  core/                     contracts only, zero runtime side effects
    asyncapi.yaml           UI to server messages, single source of truth
    src/
      messages.ts           GENERATED from asyncapi.yaml, never hand-edited
      adapter.ts            AgentAdapter, Capability, SessionHandle
      events.ts             AgentEvent union (agent to office)
      commands.ts           Command union (operator to agent)
      schemas.ts            Office, Room, Agent, Task, Approval, Channel, Message, Call
      policy.ts             permission and budget policy types
      transport.ts          MessageTransport (WebSocket, in-process)
      state.ts              StateStore interface
  server/                   control plane, Fastify and WebSocket
    src/
      app.ts                composition
      registry/             agents, sessions, presence
      bus/                  event bus (in-memory first, Redis later)
      tasks/                queue, broadcast, handoff router
      policy/               approvals, permissions, budgets
      chat/                 channels, threads, mentions, message log
      calls/                voice sessions, speech to text and text to speech
      audit/                append-only log
      store/                SQLite default, Postgres later
      auth/                 operator token now, OAuth later
  adapters/                 one package per vendor, the only code that knows vendors
    mock/  http-agent/  claude-agent-sdk/  claude-code/
    openai-agents/  cli-process/  mcp-bridge/
  runner/                   sandboxed host for adapter sessions (Docker), local or remote
  web/                      React and Vite, Canvas 2D floor
    src/ floor/ chat/ call/ control/ connect/ design/
  sdk/                      public adapter SDK and conformance test kit
  cli/                      npx agentoffice
  e2e/                      Playwright with mock agents
  docs/  scripts/  eslint-rules/  .github/  .husky/
  CLAUDE.md  CONTEXT.md  CONTRIBUTING.md  SECURITY.md  CHANGELOG.md
```

Naming note: pixel-agents uses adapters for host environments (VS Code) and providers for vendors. We use adapters for vendors because that is what the product is about, and we have no host variants yet.

**Layering rules** (enforced by an ESLint boundaries rule plus a CI check):

- core depends on nothing.
- server depends on core only. It loads adapters through a registry and never imports a specific vendor.
- web depends on core only.
- adapters depend on core and sdk only.
- runner depends on core and adapters.
- cli composes server, the web build and the adapters.

## 5. The three contracts

### 5.1 Adapter

```
type Capability = 'message' | 'pause' | 'approvals' | 'usage' | 'handoff' | 'takeover' | 'voice'

interface AgentAdapter {
  readonly id: string                                   // e.g. claude-agent-sdk
  readonly capabilities: ReadonlySet<Capability>
  connect(config: AdapterConfig): Promise<SessionHandle>  // managed, attached or observed
  events(session: SessionHandle): AsyncIterable<AgentEvent>      // agent to office
  command(session: SessionHandle, cmd: Command): Promise<CommandResult>  // office to agent
  close(session: SessionHandle): Promise<void>
}
```

### 5.2 Events and commands

```
type AgentEvent =
  | { type: 'status', state: 'working' | 'idle' | 'paused' | 'error' | 'offline' }
  | { type: 'output', text: string }
  | { type: 'tool_call', tool: string, summary: string }
  | { type: 'needs_approval', approvalId: string, action: string, risk: 'low' | 'medium' | 'high' }
  | { type: 'usage', inputTokens: number, outputTokens: number, costUsd: number }
  | { type: 'handoff', toAgentId: string, task: string, artifacts: string[] }

type Command =
  | { type: 'send', text: string }
  | { type: 'pause' } | { type: 'resume' } | { type: 'stop' }
  | { type: 'approve', approvalId: string } | { type: 'deny', approvalId: string, reason?: string }
  | { type: 'takeover', on: boolean }
```

Rules: events are ordered per session and carry a sequence number; commands are idempotent and return a result that says accepted, rejected or unsupported; an unsupported command is a normal outcome, not an error.

### 5.3 Protocol

The browser and the server talk through messages defined only in core/asyncapi.yaml. TypeScript types are generated from it, and CI fails if the generated file is out of date. Channels: world state, agent events, commands, chat messages, call signaling, approvals.

## 6. Connecting any agent

| Mode | How it works | Control level |
| --- | --- | --- |
| Managed | AgentOffice starts the agent through the runner, in a sandbox, using the adapter | L2 full control |
| Attached | The agent already runs somewhere and reports in through hooks, an SDK callback, a WebSocket or an HTTP endpoint | L1 or L2, depending on the adapter |
| Observed | We only watch logs, transcripts, process state or telemetry | L0 read-only |

This mirrors the hooks-first, log-scanning-fallback idea in pixel-agents, but adds Managed mode so we can send commands.

| Adapter | Connects through | Best level | Phase |
| --- | --- | --- | --- |
| mock | In-memory scripted agent for tests and demos | L2 | 0 |
| http-agent | Agent exposes a small HTTP or WebSocket endpoint that speaks the event schema | L1 | 1 |
| claude-agent-sdk | Agent SDK with permission callbacks for approvals | L2 | 1 |
| claude-code | Hooks for events and approvals, headless mode or a pseudo-terminal for commands | L2 | 2 |
| openai-agents | Wrapper that maps run events to AgentEvent | L1 to L2 | 2 |
| cli-process | Spawn any command, parse output, optional pseudo-terminal | L1 | 2 |
| mcp-bridge | Office tools (message an agent, hand off, read the whiteboard) exposed to any MCP-capable agent | L1 | 3 |

Adapters stay thin. Anything an agent cannot do is simply left out of its capability set, and the UI disables that control.

## 7. Server services

| Service | Responsibility | Key rules |
| --- | --- | --- |
| registry | Agents, sessions, presence, reconnects | Mark offline within seconds of a dropped session |
| bus | Fan-out of events to the UI and services | In-memory first; Redis behind the same interface later |
| tasks | Task queue, broadcast to a room, handoff routing | A handoff needs both agents to allow it |
| policy | Approvals, permission tiers, budgets | Default deny for shell, writes outside the working folder, and network |
| chat | Channels per room, direct messages per agent, threads, mentions | Agent output is summarized into messages; approvals are interactive messages |
| calls | Voice sessions on top of the chat pipeline | See section 9 |
| audit | Append-only log of commands, approvals, tool calls | Never edited; exportable |
| store | Persistence behind the StateStore interface | SQLite default, Postgres for hosted |
| auth | Operator token for local use, OAuth for hosted | The token is a secret; never logged |

## 8. Web app

Five modes, matching the mockups, all driven by the same state and protocol:

- **Floor**: the office map with agents as characters, status labels, speech bubbles for handoffs, and a floating agent card. Rendered on Canvas 2D from a grid layout; a layout editor arrives in phase 3.
- **Chat**: the always-on feed with channels, direct messages, threads, mentions, inline approvals and quick replies. It is docked next to every other mode so supervision never stops.
- **Call**: a focused view for talking to one agent, with live captions, what the agent is doing, who else is on the line, and controls.
- **Control room**: the table of every agent with bulk actions, budgets, and the approvals queue.
- **Connect**: choose an adapter, name the agent, pick the room, set permissions and budget.

Assets: use free character and furniture packs with licenses that allow redistribution, and keep a credits file. The visual style is still open; the mockups explored both pixel art and a hand-drawn whiteboard look.

## 9. Voice calls

A call is a chat conversation with a voice layer, because agents are text-first.

1. Operator speaks. The browser captures audio.
2. Speech to text turns it into a chat message addressed to the agent.
3. The message goes through the normal command path, so approvals and the audit log still apply.
4. The agent reply streams back as text, shown as live captions.
5. Text to speech reads the reply aloud, interruptible by the operator.

MVP: push to talk with the browser speech APIs. Next: pluggable streaming providers for speech to text and text to speech, and group calls where several agents listen and one answers. Expect latency to depend mostly on the agent, not on the voice layer.

## 10. Security model

- Sandboxed execution for anything that runs code: Docker, non-root, restricted filesystem and network by default.
- Secrets are injected into runners and never sent to the browser.
- Default-deny approvals; approvals are tied to a specific action and expire.
- Agent output and agent-to-agent messages are untrusted input. A message from one agent never grants another agent extra permissions.
- Server binds to localhost by default; the operator token protects control actions and is never placed in logs.
- Budgets and rate limits per agent, with automatic pause.
- Every command, approval and tool call lands in the audit log.

## 11. Testing and quality gates

- Unit tests with Vitest for core, server and web.
- Adapter conformance suite in sdk: start, ordered events, idempotent stop, reconnect, approval round trip. Every adapter must pass it.
- Protocol contract tests: generated types match asyncapi.yaml.
- End-to-end tests with Playwright and mock agents: connect, command, approve, kill switch.
- Security tests: unauthenticated clients cannot send commands; denied approvals never execute.
- CI gates: type check, lint with layering rules, unused-code check, secret scan, tests, changelog entry.

## 12. Repo hygiene copied as patterns

- CLAUDE.md as a compressed architecture reference for coding agents, and CONTEXT.md as the shared vocabulary (Office, Room, Agent, Session, Task, Event, Command, Approval, Handoff, Channel, Call, Operator).
- CONTRIBUTING, SECURITY, CODE\_OF\_CONDUCT, CHANGELOG, editorconfig, pre-commit hooks, secret-scan config, and a docs folder with an adapter guide.
- Manual testing helpers for events, like a ready-made request file, so adapters can be tried without a UI.

## 13. Roadmap

Estimates are indicative for one person working part time. Adjust after phase 0.

| Phase | Deliverables | Exit criteria |
| --- | --- | --- |
| 0 Skeleton (about 1 week) | Monorepo, layering lint rules, asyncapi.yaml with codegen, CI, mock adapter, e2e harness, CLAUDE.md and CONTEXT.md | Mock agents appear in a bare web page and change status |
| 1 MVP (weeks 2 to 4) | Server with registry and WebSocket, http-agent and claude-agent-sdk adapters, Floor with status, agent card, chat feed, send and stop, approvals, kill switch, SQLite, npx agentoffice | Three real agents in one office; one risky action approved from the UI |
| 2 Control (weeks 5 to 7) | Control room, broadcast, budgets, audit log, claude-code, openai-agents and cli-process adapters, conformance suite v1, adapter guide | Four agent types in one office; bulk task to five agents with spend visible |
| 3 Talk and collaborate (weeks 8 to 10) | Calls with push to talk, threads and mentions, handoffs, rooms and proximity, layout editor, mcp-bridge | Two agents hand off a task without the operator; a spoken command works end to end |
| 4 Scale and share (weeks 11 to 14) | Runner with Docker sandboxes and remote hosts, Postgres and Redis, hosted mode with auth, public SDK, packaging for npm and Docker | A second operator joins a hosted office; a community adapter passes conformance |

## 14. First two weeks, concretely

1. Create the repo with the folder layout above and a README that states the vision and the layering rules.
2. Write CONTEXT.md first, so names are settled before code.
3. Write core/adapter.ts, events.ts and commands.ts exactly as in section 5, with no implementation.
4. Write asyncapi.yaml with world state, agent events and commands, and wire up type generation.
5. Add lint boundaries, type check, tests and a secret scan to CI.
6. Build the mock adapter that plays a scripted day: working, handoff, error, needs approval.
7. Build the server skeleton: registry, bus, WebSocket, in-memory store.
8. Build a bare web page that lists agents and their status from the WebSocket.
9. Add the first Playwright test: start server, see three mock agents, approve one action.
10. Add the claude-agent-sdk or http-agent adapter, whichever you can test fastest.

## 15. Decisions to make now

| Decision | Options | Suggestion |
| --- | --- | --- |
| Fork or fresh repo | Fork pixel-agents, or start clean and borrow only the structure | Fresh repo: our contract differs at the core, and a clean history keeps licensing simple |
| Package tooling | npm workspaces, pnpm | pnpm or npm workspaces; pick what you already use |
| Floor renderer | Custom Canvas 2D, Phaser | Custom Canvas 2D for a small, fast floor; revisit if you add 3D |
| Default persistence | SQLite, Postgres | SQLite for npx, Postgres for hosted, both behind StateStore |
| License | MIT, Apache 2.0 | MIT or Apache 2.0 for easy adoption of adapters |
| Visual style | Pixel art, hand-drawn whiteboard | Decide after one user test; keep assets themeable |
| Name | Keep AgentOffice or rename | Check availability on npm and GitHub before committing |

## 16. Risks

| Risk | Mitigation |
| --- | --- |
| The command path is hard for vendors with no control API | Capability flags and honest control levels; Observed mode still gives value |
| Adapter drift as vendor tools change | Thin adapters, pinned versions, conformance suite in CI |
| Cross-agent prompt injection | Treat agent messages as untrusted, never transfer permissions through messages |
| Scope creep into a game | Chat and the Control room ship before any floor polish |
| pixel-agents moves into the same space | Compete on the control layer, communication and multi-vendor support, and stay open to adapters for their floor |

## 17. Sources and caveats

- pixel-agents README and repository: https://github.com/pixel-agents-hq/pixel-agents
- Its compressed architecture reference (CLAUDE.md): https://raw.githubusercontent.com/pablodelucca/pixel-agents/HEAD/CLAUDE.md
- Third-party generated walkthroughs of its core, structure and server layers on deepwiki.com. These are summaries, so verify details against the source before copying any pattern.
- This plan is based on their documentation, not a review of their code. If we reuse any code, keep their MIT license notice. Copying only the structure and ideas needs no code reuse.
