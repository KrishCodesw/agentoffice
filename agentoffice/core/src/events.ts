/**
 * AgentEvent - Messages from agent to office.
 *
 * Every event type carries a sequence number at the session level so the UI can
 * render an ordered, deduplicated feed. The office never trusts agent output raw;
 * it goes through the approval/budget pipeline before being shown.
 *
 * Design notes:
 * - `status` events are the primary way the UI knows an agent is alive and what
   it's doing. The UI maps state -> label color + character animation.
 * - `output` events are raw agent text. These are summarized before being shown
   in the chat feed to avoid one chatty agent flooding the UI.
 * - `tool_call` events represent a tool the agent invoked. The summary is a human-
   readable description; the full tool output is untrusted and stored in audit log.
 * - `needs_approval` events are the mechanism for risky actions. The approvalId
   maps to a pending approval in the operator's queue.
 * - `usage` events are sent periodically or at the end of a task. The UI can
   show a "spend meter" per agent.
 * - `handoff` events propose transferring the task to another agent. Both agents
   must allow it for the handoff to execute.
 */

// All events that can flow from an agent to the office.
export type AgentEvent =
  | { type: 'status'; state: 'working' | 'idle' | 'paused' | 'error' | 'offline' }
  | { type: 'output'; text: string }
  | { type: 'tool_call'; tool: string; summary: string }
  | { type: 'needs_approval'; approvalId: string; action: string; risk: 'low' | 'medium' | 'high' }
  | { type: 'usage'; inputTokens: number; outputTokens: number; costUsd: number }
  | { type: 'handoff'; toAgentId: string; task: string; artifacts: string[] }