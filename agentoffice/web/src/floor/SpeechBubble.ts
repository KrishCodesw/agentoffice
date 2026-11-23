/**
 * Speech Bubble - Floating text bubbles for agent communication
 */

export interface SpeechBubbleConfig {
  id: string
  agentId: string
  text: string
  position: { x: number; y: number } // World coordinates
  type: 'speech' | 'thought' | 'system' | 'approval'
  duration: number // ms, 0 = persistent until dismissed
  timestamp: number
  maxWidth?: number
}

interface ActiveBubble extends SpeechBubbleConfig {
  age: number
  opacity: number
  targetOpacity: number
  scale: number
}

/**
 * SpeechBubbleManager - Manages multiple speech bubbles with animations
 */
export class SpeechBubbleManager {
  private bubbles: Map<string, ActiveBubble> = new Map()
  private maxBubbles = 10
  private defaultDuration = 5000

  /**
   * Add a new speech bubble
   */
  add(config: SpeechBubbleConfig): void {
    // Remove oldest if at capacity
    if (this.bubbles.size >= this.maxBubbles) {
      const oldest = this.bubbles.values().next().value
      if (oldest) this.bubbles.delete(oldest.id)
    }

    const bubble: ActiveBubble = {
      ...config,
      age: 0,
      opacity: 0,
      targetOpacity: 1,
      scale: 0.8,
      maxWidth: config.maxWidth || 200,
    }

    this.bubbles.set(config.id, bubble)
  }

  /**
   * Remove a speech bubble
   */
  remove(id: string): void {
    const bubble = this.bubbles.get(id)
    if (bubble) {
      bubble.targetOpacity = 0
      bubble.duration = 200 // Fade out quickly
    }
  }

  /**
   * Update all bubbles
   */
  update(deltaTime: number): void {
    const toRemove: string[] = []

    for (const [id, bubble] of this.bubbles) {
      bubble.age += deltaTime

      // Animate opacity
      const opacityDiff = bubble.targetOpacity - bubble.opacity
      bubble.opacity += opacityDiff * 0.15

      // Animate scale
      if (bubble.scale < 1) {
        bubble.scale += (1 - bubble.scale) * 0.2
      }

      // Check for expiration
      if (bubble.duration > 0 && bubble.age >= bubble.duration) {
        bubble.targetOpacity = 0
      }

      // Remove faded out bubbles
      if (bubble.targetOpacity === 0 && bubble.opacity < 0.05) {
        toRemove.push(id)
      }
    }

    for (const id of toRemove) {
      this.bubbles.delete(id)
    }
  }

  /**
   * Get all active bubbles for rendering
   */
  getActive(): ActiveBubble[] {
    return Array.from(this.bubbles.values())
  }

  /**
   * Clear all bubbles
   */
  clear(): void {
    this.bubbles.clear()
  }

  /**
   * Add a speech bubble for an agent (convenience method)
   */
  agentSpeak(agentId: string, text: string, position: { x: number; y: number }, duration = 5000): string {
    const id = `bubble-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    this.add({
      id,
      agentId,
      text,
      position,
      type: 'speech',
      duration,
      timestamp: Date.now(),
    })
    return id
  }

  /**
   * Add a system notification bubble
   */
  systemMessage(text: string, position: { x: number; y: number }, duration = 8000): string {
    const id = `system-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    this.add({
      id,
      agentId: 'system',
      text,
      position,
      type: 'system',
      duration,
      timestamp: Date.now(),
    })
    return id
  }

  /**
   * Add an approval request bubble
   */
  approvalRequest(agentId: string, text: string, position: { x: number; y: number }): string {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    this.add({
      id,
      agentId,
      text,
      position,
      type: 'approval',
      duration: 0, // Persistent until dismissed
      timestamp: Date.now(),
    })
    return id
  }
}

/**
 * SpeechBubbleRenderer - Renders speech bubbles to canvas
 */
export class SpeechBubbleRenderer {
  private font = '12px system-ui, sans-serif'
  private padding = 10
  private cornerRadius = 8
  private tailHeight = 12
  private tailWidth = 16

  /**
   * Render a single speech bubble
   */
  render(
    ctx: CanvasRenderingContext2D,
    bubble: {
      text: string
      position: { x: number; y: number }
      type: 'speech' | 'thought' | 'system' | 'approval'
      opacity: number
      scale: number
      maxWidth?: number
    },
    camera: { x: number; y: number; zoom: number }
  ): void {
    const screenX = (bubble.position.x + camera.x) * camera.zoom
    const screenY = (bubble.position.y + camera.y) * camera.zoom

    ctx.save()
    ctx.translate(screenX, screenY)
    ctx.scale(bubble.scale * camera.zoom, bubble.scale * camera.zoom)
    ctx.globalAlpha = bubble.opacity

    // Measure text
    ctx.font = this.font
    const lines = this.wrapText(ctx, bubble.text, bubble.maxWidth ?? 200)
    const lineHeight = 16
    const textHeight = lines.length * lineHeight
    const textWidth = Math.max(...lines.map(l => ctx.measureText(l).width))
    const bubbleWidth = textWidth + this.padding * 2
    const bubbleHeight = textHeight + this.padding * 2

    // Bubble position (above agent)
    const bubbleX = -bubbleWidth / 2
    const bubbleY = -bubbleHeight - this.tailHeight - 20

    // Colors based on type
    let bgColor = ''
    let borderColor = ''
    let textColor = ''

    switch (bubble.type) {
      case 'speech':
        bgColor = 'rgba(255, 255, 255, 0.95)'
        borderColor = 'rgba(0, 0, 0, 0.1)'
        textColor = '#333'
        break
      case 'thought':
        bgColor = 'rgba(230, 240, 255, 0.95)'
        borderColor = 'rgba(0, 100, 255, 0.3)'
        textColor = '#0044aa'
        break
      case 'system':
        bgColor = 'rgba(255, 248, 220, 0.95)'
        borderColor = 'rgba(200, 180, 0, 0.3)'
        textColor = '#886600'
        break
      case 'approval':
        bgColor = 'rgba(255, 235, 235, 0.95)'
        borderColor = 'rgba(200, 0, 0, 0.3)'
        textColor = '#aa0000'
        break
    }

    // Draw bubble background
    ctx.fillStyle = bgColor
    ctx.strokeStyle = borderColor
    ctx.lineWidth = 1

    this.drawRoundedRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, this.cornerRadius)

    // Draw tail (pointer to agent)
    ctx.beginPath()
    ctx.moveTo(-this.tailWidth / 2, bubbleY + bubbleHeight)
    ctx.lineTo(0, bubbleY + bubbleHeight + this.tailHeight)
    ctx.lineTo(this.tailWidth / 2, bubbleY + bubbleHeight)
    ctx.closePath()
    ctx.fill()

    // Draw text
    ctx.fillStyle = textColor
    ctx.font = this.font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 0, bubbleY + this.padding + i * lineHeight)
    }

    ctx.restore()
  }

  /**
   * Draw a rounded rectangle path
   */
  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + width - radius, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
    ctx.lineTo(x + width, y + height - radius)
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    ctx.lineTo(x + radius, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  /**
   * Wrap text to fit within maxWidth
   */
  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const metrics = ctx.measureText(testLine)

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }

    if (currentLine) lines.push(currentLine)
    return lines
  }
}