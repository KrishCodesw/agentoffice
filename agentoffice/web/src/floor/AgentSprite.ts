/**
 * Agent Sprite - Animated character renderer
 * Supports Kenney Tiny Dungeon character sprites (16x16, 4-direction)
 */

export type AgentDirection = 'up' | 'down' | 'left' | 'right'
export type AgentState = 'idle' | 'walk' | 'talk' | 'working' | 'error' | 'paused'

export interface AgentSpriteConfig {
  agentId: string
  name: string
  color: string // Fallback color for procedural rendering
  position: { x: number; y: number } // World coordinates (pixels)
  tilePosition: { col: number; row: number }
  direction: AgentDirection
  state: AgentState
  isSelected: boolean
}

interface AnimationFrame {
  spriteX: number
  spriteY: number
  duration: number
}

interface Animation {
  frames: AnimationFrame[]
  loop: boolean
}

/**
 * Kenney Tiny Dungeon character sprite layout (16x16 per frame)
 * Assuming 4-direction, 3-frame walk cycle per direction
 * Row 0: down, Row 1: left, Row 2: right, Row 3: up
 */
const CHARACTER_ANIMATIONS: Record<AgentState, Record<AgentDirection, Animation>> = {
  idle: {
    down: { frames: [{ spriteX: 0, spriteY: 0, duration: 1000 }], loop: true },
    left: { frames: [{ spriteX: 0, spriteY: 1, duration: 1000 }], loop: true },
    right: { frames: [{ spriteX: 0, spriteY: 2, duration: 1000 }], loop: true },
    up: { frames: [{ spriteX: 0, spriteY: 3, duration: 1000 }], loop: true },
  },
  walk: {
    down: {
      frames: [
        { spriteX: 1, spriteY: 0, duration: 150 },
        { spriteX: 2, spriteY: 0, duration: 150 },
        { spriteX: 3, spriteY: 0, duration: 150 },
      ],
      loop: true,
    },
    left: {
      frames: [
        { spriteX: 1, spriteY: 1, duration: 150 },
        { spriteX: 2, spriteY: 1, duration: 150 },
        { spriteX: 3, spriteY: 1, duration: 150 },
      ],
      loop: true,
    },
    right: {
      frames: [
        { spriteX: 1, spriteY: 2, duration: 150 },
        { spriteX: 2, spriteY: 2, duration: 150 },
        { spriteX: 3, spriteY: 2, duration: 150 },
      ],
      loop: true,
    },
    up: {
      frames: [
        { spriteX: 1, spriteY: 3, duration: 150 },
        { spriteX: 2, spriteY: 3, duration: 150 },
        { spriteX: 3, spriteY: 3, duration: 150 },
      ],
      loop: true,
    },
  },
  talk: {
    down: {
      frames: [
        { spriteX: 0, spriteY: 0, duration: 300 },
        { spriteX: 4, spriteY: 0, duration: 300 },
      ],
      loop: true,
    },
    left: {
      frames: [
        { spriteX: 0, spriteY: 1, duration: 300 },
        { spriteX: 4, spriteY: 1, duration: 300 },
      ],
      loop: true,
    },
    right: {
      frames: [
        { spriteX: 0, spriteY: 2, duration: 300 },
        { spriteX: 4, spriteY: 2, duration: 300 },
      ],
      loop: true,
    },
    up: {
      frames: [
        { spriteX: 0, spriteY: 3, duration: 300 },
        { spriteX: 4, spriteY: 3, duration: 300 },
      ],
      loop: true,
    },
  },
  working: {
    down: { frames: [{ spriteX: 0, spriteY: 0, duration: 500 }], loop: true },
    left: { frames: [{ spriteX: 0, spriteY: 1, duration: 500 }], loop: true },
    right: { frames: [{ spriteX: 0, spriteY: 2, duration: 500 }], loop: true },
    up: { frames: [{ spriteX: 0, spriteY: 3, duration: 500 }], loop: true },
  },
  paused: {
    down: { frames: [{ spriteX: 5, spriteY: 0, duration: 1000 }], loop: true },
    left: { frames: [{ spriteX: 5, spriteY: 1, duration: 1000 }], loop: true },
    right: { frames: [{ spriteX: 5, spriteY: 2, duration: 1000 }], loop: true },
    up: { frames: [{ spriteX: 5, spriteY: 3, duration: 1000 }], loop: true },
  },
  error: {
    down: {
      frames: [
        { spriteX: 0, spriteY: 0, duration: 200 },
        { spriteX: 5, spriteY: 0, duration: 200 },
      ],
      loop: true,
    },
    left: {
      frames: [
        { spriteX: 0, spriteY: 1, duration: 200 },
        { spriteX: 5, spriteY: 1, duration: 200 },
      ],
      loop: true,
    },
    right: {
      frames: [
        { spriteX: 0, spriteY: 2, duration: 200 },
        { spriteX: 5, spriteY: 2, duration: 200 },
      ],
      loop: true,
    },
    up: {
      frames: [
        { spriteX: 0, spriteY: 3, duration: 200 },
        { spriteX: 5, spriteY: 3, duration: 200 },
      ],
      loop: true,
    },
  },
}

const SPRITE_SIZE = 16
const RENDER_SIZE = 32 // Render at 2x for visibility

/**
 * AgentSprite - Handles character rendering and animation
 */
export class AgentSprite {
  private config: AgentSpriteConfig
  private spriteImage: HTMLImageElement | null = null
  private spriteLoaded = false
  private animationTime = 0
  private currentFrame = 0
  private targetPosition: { x: number; y: number } | null = null
  private moveSpeed = 64 // pixels per second

  constructor(config: AgentSpriteConfig) {
    this.config = config
    this.loadSprite()
  }

  private async loadSprite(): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        this.spriteImage = img
        this.spriteLoaded = true
        resolve()
      }
      img.onerror = () => {
        console.warn('Failed to load character sprite, using procedural rendering')
        this.spriteLoaded = false
        resolve()
      }
      // Kenney Tiny Dungeon character sprite sheet
      img.src = '/assets/kenney/tiny_dungeon_characters.png'
    })
  }

  /**
   * Update sprite position and animation
   */
  update(deltaTime: number): void {
    this.animationTime += deltaTime

    // Handle movement interpolation
    if (this.targetPosition) {
      const dx = this.targetPosition.x - this.config.position.x
      const dy = this.targetPosition.y - this.config.position.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance < this.moveSpeed * (deltaTime / 1000)) {
        // Arrived
        this.config.position = { ...this.targetPosition }
        this.targetPosition = null
        this.config.state = 'idle'
      } else {
        // Moving
        const moveX = (dx / distance) * this.moveSpeed * (deltaTime / 1000)
        const moveY = (dy / distance) * this.moveSpeed * (deltaTime / 1000)
        this.config.position.x += moveX
        this.config.position.y += moveY
        this.config.state = 'walk'

        // Update direction based on movement
        if (Math.abs(dx) > Math.abs(dy)) {
          this.config.direction = dx > 0 ? 'right' : 'left'
        } else {
          this.config.direction = dy > 0 ? 'down' : 'up'
        }
      }
    }

    // Update animation frame
    const anim = CHARACTER_ANIMATIONS[this.config.state]?.[this.config.direction]
    if (anim && anim.frames.length > 1) {
      const frameDuration = anim.frames[this.currentFrame].duration
      if (this.animationTime >= frameDuration) {
        this.animationTime = 0
        this.currentFrame = (this.currentFrame + 1) % anim.frames.length
      }
    }
  }

  /**
   * Set target position for movement
   */
  moveTo(worldX: number, worldY: number): void {
    this.targetPosition = { x: worldX, y: worldY }
  }

  /**
   * Set agent state
   */
  setState(state: AgentState): void {
    if (this.config.state !== state) {
      this.config.state = state
      this.currentFrame = 0
      this.animationTime = 0
    }
  }

  /**
   * Set agent direction
   */
  setDirection(direction: AgentDirection): void {
    this.config.direction = direction
  }

  /**
   * Render the agent to canvas
   */
  render(ctx: CanvasRenderingContext2D, camera: { x: number; y: number; zoom: number }): void {
    const screenX = (this.config.position.x + camera.x) * camera.zoom
    const screenY = (this.config.position.y + camera.y) * camera.zoom
    const renderSize = RENDER_SIZE * camera.zoom

    ctx.save()
    ctx.translate(screenX, screenY)

    // Selection highlight
    if (this.config.isSelected) {
      ctx.strokeStyle = '#0066ff'
      ctx.lineWidth = 2 / camera.zoom
      ctx.beginPath()
      ctx.ellipse(0, renderSize * 0.6, renderSize * 0.5, renderSize * 0.2, 0, 0, Math.PI * 2)
      ctx.stroke()
    }

    // State indicator (small colored dot above head)
    const stateColors: Record<AgentState, string> = {
      idle: '#4caf50',
      walk: '#2196f3',
      talk: '#ff9800',
      working: '#9c27b0',
      error: '#f44336',
      paused: '#ff9800',
    }
    ctx.fillStyle = stateColors[this.config.state] || '#4caf50'
    ctx.beginPath()
    ctx.arc(0, -renderSize * 0.6, 4 / camera.zoom, 0, Math.PI * 2)
    ctx.fill()

    // Name label
    ctx.fillStyle = '#333'
    ctx.font = `${10 / camera.zoom}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(this.config.name, 0, -renderSize * 0.8)

    // Render character
    if (this.spriteLoaded && this.spriteImage) {
      this.renderSprite(ctx, renderSize)
    } else {
      this.renderProcedural(ctx, renderSize)
    }

    ctx.restore()
  }

  private renderSprite(ctx: CanvasRenderingContext2D, renderSize: number): void {
    if (!this.spriteImage) return

    const anim = CHARACTER_ANIMATIONS[this.config.state]?.[this.config.direction]
    if (!anim) return

    const frame = anim.frames[this.currentFrame]
    const sx = frame.spriteX * SPRITE_SIZE
    const sy = frame.spriteY * SPRITE_SIZE

    ctx.drawImage(
      this.spriteImage,
      sx, sy, SPRITE_SIZE, SPRITE_SIZE,
      -renderSize / 2, -renderSize,
      renderSize, renderSize
    )
  }

  private renderProcedural(ctx: CanvasRenderingContext2D, renderSize: number): void {
    const color = this.config.color
    const headRadius = renderSize * 0.3
    const bodyHeight = renderSize * 0.5
    const bodyWidth = renderSize * 0.4

    // Body
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(-bodyWidth / 2, 0, bodyWidth, bodyHeight, 4)
    ctx.fill()

    // Head
    ctx.beginPath()
    ctx.arc(0, -headRadius * 0.5, headRadius, 0, Math.PI * 2)
    ctx.fill()

    // Eyes
    ctx.fillStyle = '#fff'
    const eyeOffset = headRadius * 0.3
    ctx.beginPath()
    ctx.arc(-eyeOffset, -headRadius * 0.5, headRadius * 0.15, 0, Math.PI * 2)
    ctx.arc(eyeOffset, -headRadius * 0.5, headRadius * 0.15, 0, Math.PI * 2)
    ctx.fill()

    // Pupils (direction indicator)
    ctx.fillStyle = '#333'
    let pupilX = 0, pupilY = 0
    switch (this.config.direction) {
      case 'left': pupilX = -headRadius * 0.1; break
      case 'right': pupilX = headRadius * 0.1; break
      case 'up': pupilY = -headRadius * 0.1; break
      case 'down': pupilY = headRadius * 0.1; break
    }
    ctx.beginPath()
    ctx.arc(-eyeOffset + pupilX, -headRadius * 0.5 + pupilY, headRadius * 0.08, 0, Math.PI * 2)
    ctx.arc(eyeOffset + pupilX, -headRadius * 0.5 + pupilY, headRadius * 0.08, 0, Math.PI * 2)
    ctx.fill()

    // State indicator on body
    if (this.config.state === 'working') {
      // Keyboard typing animation
      ctx.fillStyle = '#fff'
      ctx.fillRect(-bodyWidth * 0.3, bodyHeight * 0.3, bodyWidth * 0.6, 2)
    } else if (this.config.state === 'error') {
      // X mark
      ctx.strokeStyle = '#f44336'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-4, -2)
      ctx.lineTo(4, 2)
      ctx.moveTo(4, -2)
      ctx.lineTo(-4, 2)
      ctx.stroke()
    }
  }

  getConfig(): AgentSpriteConfig {
    return { ...this.config }
  }
}

/**
 * Agent Sprite Factory - Creates sprites with predefined colors
 */
export function createAgentSprite(
  agentId: string,
  name: string,
  tilePosition: { col: number; row: number },
  tileMap: { tileWidth: number; tileHeight: number }
): AgentSprite {
  // Generate consistent color from agentId
  let hash = 0
  for (let i = 0; i < agentId.length; i++) {
    hash = agentId.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  const color = `hsl(${hue}, 60%, 45%)`

  const worldPos = {
    x: tilePosition.col * tileMap.tileWidth + tileMap.tileWidth / 2,
    y: tilePosition.row * tileMap.tileHeight + tileMap.tileHeight / 2,
  }

  return new AgentSprite({
    agentId,
    name,
    color,
    position: worldPos,
    tilePosition,
    direction: 'down',
    state: 'idle',
    isSelected: false,
  })
}