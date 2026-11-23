/**
 * Call Manager - Voice sessions on top of the chat pipeline.
 *
 * A call is a chat conversation with a voice layer, because agents are text-first.
 *
 * MVP flow:
 * 1. Operator speaks -> browser captures audio
 * 2. Speech-to-text turns it into a chat message addressed to the agent
 * 3. Message goes through normal command path -> approvals and audit log still apply
 * 4. Agent reply streams back as text, shown as live captions
 * 5. Text-to-speech reads the reply aloud, interruptible by the operator
 *
 * Layering: depends on core only (AgentEvent, Command types)
 */

import type { AgentEvent, Command, SessionHandle } from '@agentoffice/core'

export interface CallSession {
  callId: string
  agentId: string
  state: 'idle' | 'listening' | 'speaking' | 'paused' | 'ended'
  startedAt: string
  endedAt: string | null
  captionText: string // accumulated captions
  ttsVoice: string | null
}

export interface CallManager {
  startCall: (agentId: string, options?: { ttsVoice?: string }) => CallSession
  endCall: (callId: string) => void
  sendSpeech: (callId: string, text: string) => void
  getCall: (callId: string) => CallSession | undefined
  listCalls: () => CallSession[]
}

export class CallManagerImpl implements CallManager {
  private calls: Map<string, CallSession> = new Map()
  private callCounter: number = 0

  constructor(private bus: any, private policy: any) {
    // Subscribe to chat messages that might be voice-initiated
    bus.subscribe('chat-message', (payload: any) => this._onChatMessage(payload))
  }

  startCall(agentId: string, options: { ttsVoice?: string } = {}): CallSession {
    const callId = `call-${Date.now()}-${this.callCounter++}`
    const session: CallSession = {
      callId,
      agentId,
      state: 'listening',
      startedAt: new Date().toISOString(),
      endedAt: null,
      captionText: '',
      ttsVoice: options.ttsVoice || 'default',
    }

    this.calls.set(callId, session)

    // Publish call-started event
    this.bus.publish('call-started', { callId, agentId })

    return session
  }

  endCall(callId: string): void {
    const call = this.calls.get(callId)
    if (call) {
      call.state = 'ended'
      call.endedAt = new Date().toISOString()
      this.calls.set(callId, call)
      this.bus.publish('call-ended', { callId })
    }
  }

  sendSpeech(callId: string, text: string): void {
    // Send a text message to the agent via the normal command path
    const call = this.calls.get(callId)
    if (!call) return

    // Publish as a chat message with call context
    this.bus.publish('chat-message', {
      caller: 'operator',
      callId,
      type: 'speech',
      text,
    })
  }

  getCall(callId: string): CallSession | undefined {
    return this.calls.get(callId)
  }

  listCalls(): CallSession[] {
    return Array.from(this.calls.values())
  }

  private _onChatMessage(payload: any) {
    // Handle incoming chat messages that are part of a call
    const { callId, type, text } = payload
    const call = this.calls.get(callId)
    if (!call) return

    if (type === 'speech') {
      // Process speech-to-text result
      call.captionText += (call.captionText ? '\n' : '') + text
      this.bus.publish('call-caption-updated', { callId, text })
    } else if (type === 'caption') {
      // Agent reply as caption
      call.captionText += (call.captionText ? '\n' : '') + text
      // Potentially trigger text-to-speech
      this._triggerTTS(call, text)
    }
  }

  private async _triggerTTS(call: CallSession, text: string): Promise<void> {
    // In MVP, use browser TTS. In production, use a pluggable provider.
    // Server-side: just publish the event, actual TTS happens in the browser
    this.bus.publish('tts-spoken', { callId: call.callId, text })
  }
}