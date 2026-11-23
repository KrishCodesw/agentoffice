# CONTEXT.md

Shared vocabulary for AgentOffice. Every adapter, server module, and UI component uses these names so nobody has to guess what a "session" or "approval" means.

## Core Types

| Term | Definition |
|------|------------|
| **Office** | The complete AgentOffice instance — a single control tower managing one or more rooms and agents. |
| **Room** | A logical grouping of agents. An office has one or more rooms. Think: "project room", "general", "support-1". Agents connect to a room. |
| **Agent** | An individual AI agent instance. Has an `id`, `capabilities`, and connects via an `Adapter`. |
| **Session** | A connection between the server and an agent (via its adapter). A session has a handle, presence state, and an ordered stream of events. |
| **Task** | A unit of work being carried out by an agent. Associated with artifacts and progress state. |
| **Event** | A message from agent to office. Types include: status, output, tool_call, needs_approval, usage, handoff. Every event has a sequence number per session. |
| **Command** | A message from office to agent. Types: send, pause, resume, stop, approve, deny, takeover. Commands are idempotent and return a result: accepted / rejected / unsupported. |
| **Approval** | A gated action that requires operator confirmation before execution. Has an `approvalId`, `action` description, `risk` level, and `expiresAt` timestamp. |
| **Channel** | A named message stream. Rooms have a "world" channel; agents have direct channels; calls have their own channel; approvals have a channel. |
| **Call** | A voice conversation session. Defined by a voice channel, with captions, TTS/STT participation, and a call ID linking to the chat pipeline. |
| **Operator** | The human user controlling the office. Holds an operator token, can send commands, approve/reject approvals, and manage agents. |

## Capability Flags

| Flag | Meaning |
|------|---------|
| `message` | Agent can receive `send` commands |
| `pause` | Agent can be paused/resumed |
| `approvals` | Agent supports approval/deny commands |
| `usage` | Agent reports input/output token usage and cost |
| `handoff` | Agent supports handoff commands (to another agent) |
| `takeover` | Agent supports takeover (human takes control) |
| `voice` | Agent supports voice calls (STT/TTS) |

## Message Types (shorthand)

**From Agent to Office** (via `events()`):
- `{ type: 'status', state: 'working'|'idle'|'paused'|'error'|'offline' }`
- `{ type: 'output', text: string }`
- `{ type: 'tool_call', tool: string, summary: string }`
- `{ type: 'needs_approval', approvalId: string, action: string, risk: 'low'|'medium'|'high' }`
- `{ type: 'usage', inputTokens: number, outputTokens: number, costUsd: number }`
- `{ type: 'handoff', toAgentId: string, task: string, artifacts: string[] }`

**From Office to Agent** (via `command()`):
- `{ type: 'send', text: string }`
- `{ type: 'pause' }` / `{ type: 'resume' }` / `{ type: 'stop' }`
- `{ type: 'approve', approvalId: string }` / `{ type: 'deny', approvalId: string, reason?: string }`
- `{ type: 'takeover', on: boolean }`

## Naming Conventions

- **PascalCase** for types/interfaces: `AgentAdapter`, `AgentEvent`, `Command`
- **camelCase** for fields: `approvalId`, `costUsd`, `inputTokens`
- **SCREAMING_SNAKE_CASE** for capability flags: `'MESSAGE' | 'PAUSE' | 'APPROVALS'`
- Files: `kebab-case` - `adapter.ts`, `events.ts`, `commands.ts`, `asyncapi.yaml`
- Enum members: `ucfirst` - `'Working' | 'Idle' | 'Paused' | 'Error' | 'Offline'`

## What This File Is For

- Prevents team members from debating "what do we call this?" during code reviews
- New hires can read this in 5 minutes and understand the type system
- CI can verify that generated types match the contracts described here
- Adapter authors know exactly which types they must implement

> **Principle**: The contract is the product. Types come first. This file documents the contract so it can be reviewed independently of the code.