/**
 * Tile Map - Loads and renders tile-based maps
 * Supports Kenney Tiny Town (16x16) tile format
 */

export interface Tile {
  id: number
  name: string
  walkable: boolean
  spriteX: number
  spriteY: number
}

export interface TileLayer {
  name: string
  data: number[] // 1D array of tile IDs (row-major)
  width: number
  height: number
  visible: boolean
  opacity: number
}

export interface TileMapData {
  tileWidth: number
  tileHeight: number
  width: number
  height: number
  tilesets: Tileset[]
  layers: TileLayer[]
}

export interface Tileset {
  firstGid: number
  name: string
  tileWidth: number
  tileHeight: number
  spacing: number
  margin: number
  image: string
  imageWidth: number
  imageHeight: number
  tiles: Tile[]
}

/**
 * Default office map - 20x15 tiles (320x240 pixels at 16px tiles)
 * Can be replaced with Tiled editor export
 */
export const DEFAULT_OFFICE_MAP: TileMapData = {
  tileWidth: 16,
  tileHeight: 16,
  width: 20,
  height: 15,
  tilesets: [
    {
      firstGid: 1,
      name: 'tiny_town',
      tileWidth: 16,
      tileHeight: 16,
      spacing: 0,
      margin: 0,
      image: 'kenney/tiny_town.png',
      imageWidth: 256,
      imageHeight: 256,
      tiles: [
        { id: 0, name: 'empty', walkable: true, spriteX: 0, spriteY: 0 },
        { id: 1, name: 'floor', walkable: true, spriteX: 0, spriteY: 0 },
        { id: 2, name: 'wall_n', walkable: false, spriteX: 1, spriteY: 0 },
        { id: 3, name: 'wall_s', walkable: false, spriteX: 2, spriteY: 0 },
        { id: 4, name: 'wall_e', walkable: false, spriteX: 3, spriteY: 0 },
        { id: 5, name: 'wall_w', walkable: false, spriteX: 4, spriteY: 0 },
        { id: 6, name: 'corner_nw', walkable: false, spriteX: 5, spriteY: 0 },
        { id: 7, name: 'corner_ne', walkable: false, spriteX: 6, spriteY: 0 },
        { id: 8, name: 'corner_sw', walkable: false, spriteX: 7, spriteY: 0 },
        { id: 9, name: 'corner_se', walkable: false, spriteX: 8, spriteY: 0 },
        { id: 10, name: 'desk', walkable: false, spriteX: 0, spriteY: 1 },
        { id: 11, name: 'chair', walkable: true, spriteX: 1, spriteY: 1 },
        { id: 12, name: 'computer', walkable: false, spriteX: 2, spriteY: 1 },
        { id: 13, name: 'plant', walkable: true, spriteX: 3, spriteY: 1 },
        { id: 14, name: 'whiteboard', walkable: false, spriteX: 4, spriteY: 1 },
        { id: 15, name: 'door', walkable: true, spriteX: 5, spriteY: 1 },
      ],
    },
  ],
  layers: [
    {
      name: 'floor',
      data: Array(20 * 15).fill(1), // All floor tiles
      width: 20,
      height: 15,
      visible: true,
      opacity: 1,
    },
    {
      name: 'walls',
      data: createWallsLayer(20, 15),
      width: 20,
      height: 15,
      visible: true,
      opacity: 1,
    },
    {
      name: 'objects',
      data: createObjectsLayer(20, 15),
      width: 20,
      height: 15,
      visible: true,
      opacity: 1,
    },
  ],
}

function createWallsLayer(width: number, height: number): number[] {
  const layer = Array(width * height).fill(0)

  // Top wall
  for (let x = 0; x < width; x++) layer[x] = 2
  // Bottom wall
  for (let x = 0; x < width; x++) layer[(height - 1) * width + x] = 3
  // Left wall
  for (let y = 0; y < height; y++) layer[y * width] = 4
  // Right wall
  for (let y = 0; y < height; y++) layer[y * width + (width - 1)] = 5

  // Corners
  layer[0] = 6
  layer[width - 1] = 7
  layer[(height - 1) * width] = 8
  layer[(height - 1) * width + (width - 1)] = 9

  return layer
}

function createObjectsLayer(width: number, height: number): number[] {
  const layer = Array(width * height).fill(0)

  // Desk row in middle
  for (let x = 3; x < 8; x++) {
    layer[7 * width + x] = 10 // desk
  }
  // Chairs
  layer[8 * width + 4] = 11
  layer[8 * width + 6] = 11

  // Computer on desk
  layer[7 * width + 5] = 12

  // Plants
  layer[2 * width + 2] = 13
  layer[2 * width + 17] = 13

  // Whiteboard
  layer[2 * width + 10] = 14

  // Door
  layer[14 * width + 10] = 15

  return layer
}

/**
 * TileMap Renderer - Renders tile map to Canvas
 */
export class TileMapRenderer {
  public readonly map: TileMapData
  private tilesetImage: HTMLImageElement | null = null
  private tilesetLoaded = false
  private tileCache: Map<string, OffscreenCanvas> = new Map()

  constructor(map: TileMapData = DEFAULT_OFFICE_MAP) {
    this.map = map
    this.loadTileset()
  }

  private async loadTileset(): Promise<void> {
    const tileset = this.map.tilesets[0]
    if (!tileset) return

    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        this.tilesetImage = img
        this.tilesetLoaded = true
        this.generateTileCache()
        resolve()
      }
      img.onerror = () => {
        console.warn('Failed to load tileset, using procedural rendering')
        this.tilesetLoaded = false
        resolve()
      }
      // Use a placeholder - in production, this would be the actual Kenney asset
      img.src = '/assets/kenney/tiny_town.png'
    })
  }

  private generateTileCache(): void {
    if (!this.tilesetImage) return

    const tileset = this.map.tilesets[0]
    if (!tileset) return

    // Generate cached tiles for each tile in tileset
    for (const tile of tileset.tiles) {
      const canvas = new OffscreenCanvas(tileset.tileWidth, tileset.tileHeight)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(
        this.tilesetImage!,
        tile.spriteX * tileset.tileWidth,
        tile.spriteY * tileset.tileHeight,
        tileset.tileWidth,
        tileset.tileHeight,
        0, 0,
        tileset.tileWidth,
        tileset.tileHeight
      )
      this.tileCache.set(`${tile.id}`, canvas)
    }
  }

  /**
   * Render the map to a canvas context
   */
  render(ctx: CanvasRenderingContext2D, camera: { x: number; y: number; zoom: number }): void {
    const { tileWidth, tileHeight } = this.map

    // Calculate visible tile range
    const startCol = Math.max(0, Math.floor(-camera.x / (tileWidth * camera.zoom)))
    const endCol = Math.min(this.map.width, Math.ceil((ctx.canvas.width / camera.zoom - camera.x) / (tileWidth * camera.zoom)))
    const startRow = Math.max(0, Math.floor(-camera.y / (tileHeight * camera.zoom)))
    const endRow = Math.min(this.map.height, Math.ceil((ctx.canvas.height / camera.zoom - camera.y) / (tileHeight * camera.zoom)))

    // Render each layer
    for (const layer of this.map.layers) {
      if (!layer.visible) continue

      ctx.globalAlpha = layer.opacity

      for (let row = startRow; row < endRow; row++) {
        for (let col = startCol; col < endCol; col++) {
          const tileId = layer.data[row * layer.width + col]
          if (tileId === 0) continue // Empty tile

          const x = col * tileWidth
          const y = row * tileHeight

          if (this.tilesetLoaded && this.tileCache.has(`${tileId}`)) {
            // Use cached tile
            const cached = this.tileCache.get(`${tileId}`)!
            ctx.drawImage(cached, x, y)
          } else {
            // Procedural fallback
            this.renderProceduralTile(ctx, tileId, x, y, tileWidth, tileHeight)
          }
        }
      }
    }

    ctx.globalAlpha = 1
  }

  private renderProceduralTile(
    ctx: CanvasRenderingContext2D,
    tileId: number,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    // Simple procedural tiles based on ID
    switch (tileId) {
      case 1: // Floor
        ctx.fillStyle = '#e8e0d8'
        ctx.fillRect(x, y, w, h)
        // Subtle grid lines
        ctx.strokeStyle = '#d0c8c0'
        ctx.lineWidth = 0.5
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
        break

      case 2: case 3: case 4: case 5: // Walls
      case 6: case 7: case 8: case 9: // Corners
        ctx.fillStyle = '#8b7355'
        ctx.fillRect(x, y, w, h)
        // Wall highlight
        ctx.fillStyle = '#a68b6b'
        ctx.fillRect(x, y, w, 2)
        ctx.fillRect(x, y, 2, h)
        // Wall shadow
        ctx.fillStyle = '#6b5540'
        ctx.fillRect(x + w - 2, y, 2, h)
        ctx.fillRect(x, y + h - 2, w, 2)
        break

      case 10: // Desk
        ctx.fillStyle = '#5d4e37'
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2)
        ctx.fillStyle = '#7d6b4f'
        ctx.fillRect(x + 1, y + 1, w - 2, 2)
        break

      case 11: // Chair
        ctx.fillStyle = '#4a4a4a'
        ctx.beginPath()
        ctx.arc(x + w/2, y + h/2, Math.min(w, h) * 0.4, 0, Math.PI * 2)
        ctx.fill()
        break

      case 12: // Computer
        ctx.fillStyle = '#1a1a2e'
        ctx.fillRect(x + 2, y + 1, w - 4, h - 3)
        ctx.fillStyle = '#00d4ff'
        ctx.fillRect(x + 3, y + 2, w - 6, 2)
        break

      case 13: // Plant
        ctx.fillStyle = '#2d5a27'
        ctx.beginPath()
        ctx.arc(x + w/2, y + h/2, Math.min(w, h) * 0.35, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#8b7355'
        ctx.fillRect(x + w/2 - 1, y + h - 3, 2, 3)
        break

      case 14: // Whiteboard
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(x, y, w, h)
        ctx.strokeStyle = '#cccccc'
        ctx.lineWidth = 1
        ctx.strokeRect(x, y, w, h)
        // Some writing
        ctx.strokeStyle = '#0066cc'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x + 3, y + 4)
        ctx.lineTo(x + w - 3, y + 4)
        ctx.moveTo(x + 3, y + 8)
        ctx.lineTo(x + w - 5, y + 8)
        ctx.stroke()
        break

      case 15: // Door
        ctx.fillStyle = '#8b7355'
        ctx.fillRect(x, y, w, h)
        ctx.fillStyle = '#c9b896'
        ctx.fillRect(x + 2, y + 2, w - 4, h - 4)
        break
    }
  }

  /**
   * Check if a tile position is walkable
   */
  isWalkable(col: number, row: number): boolean {
    if (col < 0 || col >= this.map.width || row < 0 || row >= this.map.height) return false

    // Check all layers for blocking tiles
    for (const layer of this.map.layers) {
      const tileId = layer.data[row * layer.width + col]
      if (tileId > 0) {
        const tile = this.map.tilesets[0]?.tiles.find(t => t.id === tileId)
        if (tile && !tile.walkable) return false
      }
    }
    return true
  }

  /**
   * Convert world coordinates to tile coordinates
   */
  worldToTile(worldX: number, worldY: number): { col: number; row: number } {
    return {
      col: Math.floor(worldX / this.map.tileWidth),
      row: Math.floor(worldY / this.map.tileHeight),
    }
  }

  /**
   * Convert tile coordinates to world coordinates (center of tile)
   */
  tileToWorld(col: number, row: number): { x: number; y: number } {
    return {
      x: col * this.map.tileWidth + this.map.tileWidth / 2,
      y: row * this.map.tileHeight + this.map.tileHeight / 2,
    }
  }
}