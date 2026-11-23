/**
 * Command - Messages from office to agent.
 *
 * Every command is idempotent. Sending the same command twice must produce the
 * same result. The return value is CommandResult: 'accepted' | 'rejected' | 'unsupported'.
 *
 * 'unsupported' is a normal outcome, not an error. It means the agent simply
 * cannot perform that action (e.g., trying to 'pause' an agent that has no pause
 * capability). The UI should treat 'unsupported' the same as 'accepted' for
 * display purposes, but the control may be disabled/removed from the UI.
 *
 * Design notes:
 * - `send` is the primary way the operator sends a message to the agent.
   It appears in the chat feed as an operator-initiated message.
 * - `pause` / `resume` / `stop` are control commands. The UI should only show
   these when the agent's capability set includes 'pause'.
 * - `approve` / `deny` are used to respond to a `needs_approval` event. The
   approvalId must match the one in the event. If the operator denies without a
   reason, the agent can choose to continue or abort - that's the agent's choice.
 * - `takeover` allows the human to take operational control from the agent.
   The agent can refuse (return 'unsupported'), but the office will keep trying
   until the agent accepts or the session ends.
 */

// All commands that the office can send to an agent.
export type Command =
  | { type: 'send'; text: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'approve'; approvalId: string }
  | { type: 'deny'; approvalId: string; reason?: string }
  | { type: 'takeover'; on: boolean }