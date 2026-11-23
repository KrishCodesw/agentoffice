/**
 * Chat - Channels per room, direct messages per agent, threads, mentions,
 * inline approvals and quick replies.
 *
 * Responsibilities:
 * - Threaded conversation model (every message can have a threadId)
 * - Mentions (@agent style) so operators can grab an agent's attention
 * - Inline approvals: when an agent needs approval, it appears as an interactive
   message right inside the chat flow
 * - Quick replies: action buttons attached to messages (Approve / Deny / Continue / Cancel)
 * - Message summarization: agent output is summarized before appearing in chat
 * - Message log: append-only store for the room's conversation history
 *
 * Layering: depends on core only (AgentEvent, Command, Approval types)
 */

import type { AgentEvent, Command, Approval, SessionHandle } from '@agentoffice/core'

export interface ChatMessage {
  id: string
  messageId: string // unique across the system
  sender: 'operator' | 'agent'
  senderId: string // agentId or operator token
  recipient: string | null // roomId or agentId or null for broadcast
  content: string
  timestamp: string
  threadId: string | null
  mentions: string[] // agentIds mentioned in the message
  reactions: Record<string, string[]> // emoji -> list of userIds who reacted
  callSid: string | null
  approvalId: string | null // if this message is an approval request
  quickReplies: QuickReply[] // inline action buttons
}

export interface QuickReply {
  id: string
  label: string
  action: 'approve' | 'deny' | 'continue' | 'cancel' | 'takeover'
  style: 'primary' | 'secondary' | 'danger'
}

export interface ChatChannel {
  roomId: string
  directAgentId: string | null
  messages: ChatMessage[]
}

export class Chat {
  private channels: Map<string, ChatChannel> = new Map() // roomId -> channel
  private messageCounter: number = 0

  constructor(private bus: any) {
    // Subscribe to relevant bus channels
    bus.subscribe('agent-events', (payload: any) => this._onAgentEvent(payload))
    bus.subscribe('approvals', (payload: any) => this._onApproval(payload))
    bus.subscribe('task-created', (payload: any) => this._onTaskCreated(payload))
    bus.subscribe('task-assigned', (payload: any) => this._onTaskAssigned(payload))
  }

  /** Called when an agent event arrives - convert to a chat message. */
  private _onAgentEvent(payload: any) {
    const { agentId, type, state, text, summary, approvalId, risk, action, inputTokens, outputTokens, costUsd } = payload

    let content = ''
    let quickReplies: QuickReply[] = []
    let approvalIdInMessage: string | null = null

    switch (type) {
      case 'status':
        content = `Agent ${agentId} is now ${state}`
        break
      case 'output':
        // Summarize agent output before showing in chat
        content = summary || text || '(no summary available)'
        // If the output triggered an approval, add an inline approval quick reply
        if (approvalId) {
          approvalIdInMessage = approvalId
          quickReplies = [
            { id: 'approve', label: 'Approve', action: 'approve', style: 'primary' },
            { id: 'deny', label: 'Deny', action: 'deny', style: 'danger' },
          ]
        }
        break
      case 'tool_call':
        content = `Tool call: ${text || summary || 'unknown tool'}`
        break
      case 'needs_approval':
        content = `Requires approval: ${text || action || 'unknown action'}`
        approvalIdInMessage = approvalId
        quickReplies = [
          { id: 'approve', label: 'Approve', action: 'approve', style: 'primary' },
          { id: 'deny', label: 'Deny', action: 'deny', style: 'danger' },
        ]
        break
      case 'usage':
        content = `Usage: ${inputTokens || 0} input tokens, ${outputTokens || 0} output tokens (${costUsd || 0} USD)`
        break
      case 'handoff':
        content = `Handoff proposed: task transferred to another agent`
        break
      default:
        content = JSON.stringify(payload)
    }

    // Create a chat message and publish it
    const message: ChatMessage = {
      id: `msg-${Date.now()}-${this.messageCounter++}`,
      messageId: `msg-${Date.now()}-${this.messageCounter}`,
      sender: 'agent',
      senderId: agentId,
      recipient: null, // will be set based on room
      content,
      timestamp: new Date().toISOString(),
      threadId: null,
      mentions: [], // agent events typically don't mention other agents
      reactions: {},
      callSid: null,
      approvalId: approvalIdInMessage,
      quickReplies,
    }

    // Add to the general room channel (or create one)
    this._addMessageToChannel('general', message)
    // Also publish to the bus for UI subscribers
    this.bus.publish('chat-message', message)
  }

  private _onApproval(payload: any) {
    // Handle approval flow from the operator UI
    const { approvalId, action, decide } = payload
    // Forward to the policy engine
    // (the policy engine will update status and execute the action)
  }

  private _onTaskCreated(payload: any) {
    // Add a system message about task creation
    const message: ChatMessage = {
      id: `msg-${Date.now()}-${this.messageCounter++}`,
      messageId: `msg-system-${Date.now()}`,
      sender: 'operator',
      senderId: 'system',
      recipient: null,
      content: `New task created: ${payload.description}`,
      timestamp: new Date().toISOString(),
      threadId: null,
      mentions: [],
      reactions: {},
      callSid: null,
      approvalId: null,
      quickReplies: [],
    }
    this._addMessageToChannel('general', message)
  }

  private _onTaskAssigned(payload: any) {
    const message: ChatMessage = {
      id: `msg-${Date.now()}-${this.messageCounter++}`,
      messageId: `msg-system-${Date.now()}`,
      sender: 'operator',
      senderId: 'system',
      recipient: null,
      content: `Task ${payload.taskId} assigned to agent ${payload.newAgentId}`,
      timestamp: new Date().toISOString(),
      threadId: null,
      mentions: [],
      reactions: {},
      callSid: null,
      approvalId: null,
      quickReplies: [],
    }
    this._addMessageToChannel('general', message)
  }

  /** Add a message to a channel, creating the channel if needed. */
  private _addMessageToChannel(roomId: string, message: ChatMessage): void {
    let channel = this.channels.get(roomId)
    if (!channel) {
      channel = {
        roomId,
        directAgentId: null,
        messages: [],
      }
      this.channels.set(roomId, channel)
    }
    channel.messages.push(message)
  }

  /** Get all messages for a room. */
  getMessages(roomId: string = 'general'): ChatMessage[] {
    return this.channels.get(roomId)?.messages || []
  }

  /** Get a specific message by ID. */
  getMessage(messageId: string): ChatMessage | undefined {
    for (const channel of this.channels.values()) {
      const msg = channel.messages.find((m) => m.id === messageId)
      if (msg) return msg
    }
    return undefined
  }

  /** Add a mention to a message. */
  addMention(messageId: string, agentId: string): void {
    const msg = this.getMessage(messageId)
    if (msg) {
      msg.mentions.push(agentId)
    }
  }

  /** Add a quick reply to a message. */
  addQuickReply(messageId: string, quickReply: QuickReply): void {
    const msg = this.getMessage(messageId)
    if (msg) {
      msg.quickReplies.push(quickReply)
    }
  }
}