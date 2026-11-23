/**
 * Floor Renderer - Main Canvas 2D renderer for the office floor
 * Integrates TileMap, AgentSprite, and SpeechBubble
 */

import React, { useRef, useEffect, useState, useCallback } from 'react'
import { TileMapRenderer, DEFAULT_OFFICE_MAP } from './TileMap'
import { AgentSprite, createAgentSprite, type AgentSpriteConfig, type AgentState, type AgentDirection } from './AgentSprite'
import { SpeechBubbleManager, SpeechBubbleRenderer } from './SpeechBubble'

interface AgentData {
  id: string
  name: string
  capabilities: string[]
  state: 'working' | 'idle' | 'paused' | 'error' | 'offline'
}

interface FloorRendererProps {
  agents: AgentData[]
  onAgentSelect: (agentId: string) => void
  onSendCommand: (command: { type: string; text?: string }) => void
  selectedAgentId: string | null
}

interface AgentRuntimeData extends AgentSpriteConfig {
  sprite: AgentSprite
  lastEventTime: number
}

export function FloorRenderer({
  agents,
  onAgentSelect,
  onSendCommand,
  selectedAgentId,
}: FloorRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  // Runtime data
  const tileMapRef = useRef(new TileMapRenderer(DEFAULT_OFFICE_MAP))
  const agentSpritesRef = useRef<Map<string, AgentRuntimeData>>(new Map())
  const speechBubbleManagerRef = useRef(new SpeechBubbleManager())
  const speechBubbleRendererRef = useRef(new SpeechBubbleRenderer())
  const lastFrameRef = useRef(performance.now())
  const animationFrameRef = useRef<number | null>(null)

  // Initialize agents
  useEffect(() => {
    const tileMap = tileMapRef.current

    // Create sprites for new agents
    for (const agent of agents) {
      if (!agentSpritesRef.current.has(agent.id)) {
        // Find a good spawn position (walkable tile near center)
        const spawnPos = findSpawnPosition(tileMap, agent.id)
        const sprite = createAgentSprite(agent.id, agent.name, spawnPos, {
          tileWidth: tileMap.map.tileWidth,
          tileHeight: tileMap.map.tileHeight,
        })

        agentSpritesRef.current.set(agent.id, {
          ...sprite.getConfig(),
          sprite,
          lastEventTime: 0,
        })
      }
    }

    // Remove sprites for agents that no longer exist
    for (const [id] of agentSpritesRef.current) {
      if (!agents.find(a => a.id === id)) {
        agentSpritesRef.current.delete(id)
      }
    }
  }, [agents])

  // Handle agent events from server
  const handleAgentEvent = useCallback((event: any) => {
    const runtime = agentSpritesRef.current.get(event.agentId)
    if (!runtime) return

    runtime.lastEventTime = Date.now()

    switch (event.type) {
      case 'status':
        const stateMap: Record<string, AgentState> = {
          working: 'working',
          idle: 'idle',
          paused: 'paused',
          error: 'error',
          offline: 'idle',
        }
        runtime.sprite.setState(stateMap[event.state] || 'idle')
        break

      case 'output':
        // Show speech bubble
        speechBubbleManagerRef.current.agentSpeak(
          event.agentId,
          event.text?.substring(0, 100) || '...',
          runtime.position,
          5000
        )
        break

      case 'tool_call':
        speechBubbleManagerRef.current.agentSpeak(
          event.agentId,
          `🔧 ${event.tool}: ${event.summary}`,
          runtime.position,
          4000
        )
        runtime.sprite.setState('working')
        break

      case 'needs_approval':
        speechBubbleManagerRef.current.approvalRequest(
          event.agentId,
          `⚠️ ${event.action} (${event.risk})`,
          runtime.position
        )
        runtime.sprite.setState('working')
        break

      case 'handoff':
        speechBubbleManagerRef.current.agentSpeak(
          event.agentId,
          `🤝 Handoff to ${event.toAgentId}`,
          runtime.position,
          4000
        )
        break
    }
  }, [])

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')!
    let lastTime = performance.now()

    const animate = (time: number) => {
      const deltaTime = time - lastTime
      lastTime = time

      // Update
      tileMapRef.current
      speechBubbleManagerRef.current.update(deltaTime)

      for (const runtime of agentSpritesRef.current.values()) {
        runtime.sprite.update(deltaTime)
        // Update runtime config from sprite
        const config = runtime.sprite.getConfig()
        Object.assign(runtime, config)
      }

      // Render
      render(ctx)

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // Render function
  const render = (ctx: CanvasRenderingContext2D) => {
    const canvas = canvasRef.current!
    const width = canvas.width
    const height = canvas.height

    // Clear
    ctx.clearRect(0, 0, width, height)

    // Background
    ctx.fillStyle = '#f5f0e8'
    ctx.fillRect(0, 0, width, height)

    // Render tile map
    tileMapRef.current.render(ctx, camera)

    // Render agents
    for (const runtime of agentSpritesRef.current.values()) {
      runtime.sprite.render(ctx, camera)
    }

    // Render speech bubbles
    const bubbles = speechBubbleManagerRef.current.getActive()
    for (const bubble of bubbles) {
      speechBubbleRendererRef.current.render(ctx, bubble, camera)
    }

    // Draw minimap in corner
    drawMinimap(ctx)
  }

  // Minimap
  const drawMinimap = (ctx: CanvasRenderingContext2D) => {
    const mapWidth = 150
    const mapHeight = 112
    const x = canvasSize.width - mapWidth - 20
    const y = 20

    ctx.save()
    ctx.globalAlpha = 0.8
    ctx.fillStyle = '#fff'
    ctx.fillRect(x, y, mapWidth, mapHeight)
    ctx.strokeStyle = '#ccc'
    ctx.strokeRect(x, y, mapWidth, mapHeight)

    // Draw agents as dots
    const scaleX = mapWidth / (DEFAULT_OFFICE_MAP.width * DEFAULT_OFFICE_MAP.tileWidth)
    const scaleY = mapHeight / (DEFAULT_OFFICE_MAP.height * DEFAULT_OFFICE_MAP.tileHeight)

    for (const runtime of agentSpritesRef.current.values()) {
      const agent = agents.find(a => a.id === runtime.agentId)
      if (!agent || agent.state === 'offline') continue

      const color = agent.state === 'error' ? '#f44336' :
        agent.state === 'working' ? '#9c27b0' :
        agent.state === 'paused' ? '#ff9800' : '#4caf50'

      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(
        x + runtime.position.x * scaleX,
        y + runtime.position.y * scaleY,
        4,
        0,
        Math.PI * 2
      )
      ctx.fill()
    }

    // Camera viewport indicator
    const viewWidth = canvasSize.width / camera.zoom * scaleX
    const viewHeight = canvasSize.height / camera.zoom * scaleY
    const viewX = x - camera.x * scaleX
    const viewY = y - camera.y * scaleY

    ctx.strokeStyle = '#0066ff'
    ctx.lineWidth = 2
    ctx.strokeRect(viewX, viewY, viewWidth, viewHeight)

    ctx.restore()
  }

  // Canvas resize
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const container = canvas.parentElement
      if (!container) return

      const width = container.clientWidth
      const height = container.clientHeight

      canvas.width = width
      canvas.height = height
      setCanvasSize({ width, height })
    }

    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    setIsDragging(true)
    setDragStart({ x, y })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return

    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const dx = (dragStart.x - x) / camera.zoom
    const dy = (dragStart.y - y) / camera.zoom

    setCamera(prev => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy,
    }))

    setDragStart({ x, y })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.min(Math.max(camera.zoom * zoomFactor, 0.5), 3)

    // Zoom towards mouse position
    const worldX = (mouseX - camera.x) / camera.zoom
    const worldY = (mouseY - camera.y) / camera.zoom

    setCamera(prev => ({
      zoom: newZoom,
      x: mouseX - worldX * newZoom,
      y: mouseY - worldY * newZoom,
    }))
  }

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const worldX = (x - camera.x) / camera.zoom
    const worldY = (y - camera.y) / camera.zoom

    const tileMap = tileMapRef.current
    const tilePos = tileMap.worldToTile(worldX, worldY)

    // Find agent at this tile
    for (const runtime of agentSpritesRef.current.values()) {
      if (runtime.tilePosition.col === tilePos.col && runtime.tilePosition.row === tilePos.row) {
        onAgentSelect(runtime.agentId)
        break
      }
    }
  }

  // Agent click handler
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const worldX = (x - camera.x) / camera.zoom
    const worldY = (y - camera.y) / camera.zoom

    const tileMap = tileMapRef.current
    const tilePos = tileMap.worldToTile(worldX, worldY)

    // Check if clicked on an agent
    for (const runtime of agentSpritesRef.current.values()) {
      const agentScreenX = (runtime.position.x + camera.x) * camera.zoom
      const agentScreenY = (runtime.position.y + camera.y) * camera.zoom
      const dist = Math.sqrt((x - agentScreenX) ** 2 + (y - agentScreenY) ** 2)

      if (dist < 30 * camera.zoom) {
        onAgentSelect(runtime.agentId)
        return
      }
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case 'ArrowUp':
          setCamera(prev => ({ ...prev, y: prev.y + 50 / camera.zoom }))
          break
        case 'ArrowDown':
          setCamera(prev => ({ ...prev, y: prev.y - 50 / camera.zoom }))
          break
        case 'ArrowLeft':
          setCamera(prev => ({ ...prev, x: prev.x + 50 / camera.zoom }))
          break
        case 'ArrowRight':
          setCamera(prev => ({ ...prev, x: prev.x - 50 / camera.zoom }))
          break
        case '=':
        case '+':
          setCamera(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.2, 3) }))
          break
        case '-':
          setCamera(prev => ({ ...prev, zoom: Math.max(prev.zoom / 1.2, 0.5) }))
          break
        case '0':
          setCamera({ x: 0, y: 0, zoom: 1 })
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [camera.zoom])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        style={{
          width: '100%',
          height: '100%',
          background: '#f5f0e8',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
      />

      {/* Controls overlay */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        right: 16,
        display: 'flex',
        justifyContent: 'center',
        gap: 8,
        pointerEvents: 'none',
      }}>
        <button
          onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}
          style={{ pointerEvents: 'auto', padding: '8px 16px', borderRadius: 4 }}
          title="Reset view (0)"
        >
          🔍 Reset View
        </button>
        <span style={{
          pointerEvents: 'auto',
          padding: '8px 12px',
          background: 'rgba(255,255,255,0.9)',
          borderRadius: 4,
          fontSize: 12,
          fontFamily: 'monospace',
        }}>
          Zoom: {(camera.zoom * 100).toFixed(0)}% | Pan: Arrow keys | Zoom: +/- | Click agent to select
        </span>
      </div>

      {/* Selected agent indicator */}
      {selectedAgentId && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '12px 16px',
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          pointerEvents: 'auto',
        }}>
          <strong>Selected: {selectedAgentId}</strong>
          <br />
          <small>Press Enter to send message</small>
        </div>
      )}
    </div>
  )
}

/**
 * Find a good spawn position for an agent
 */
function findSpawnPosition(tileMap: TileMapRenderer, agentId: string): { col: number; row: number } {
  // Try positions around center
  const centerCol = Math.floor(tileMap.map.width / 2)
  const centerRow = Math.floor(tileMap.map.height / 2)

  // Spiral search from center
  const maxRadius = Math.max(tileMap.map.width, tileMap.map.height)
  for (let radius = 0; radius < maxRadius; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue

        const col = centerCol + dx
        const row = centerRow + dy

        if (tileMap.isWalkable(col, row)) {
          return { col, row }
        }
      }
    }
  }

  // Fallback
  return { col: centerCol, row: centerRow }
}