#!/usr/bin/env node
/**
 * AgentOffice CLI - Main entry point
 *
 * Usage:
 *   npx agentoffice              # Start server + open browser
 *   npx agentoffice --dev        # Start dev servers (Vite HMR + tsx watch)
 *   npx agentoffice --port 3001  # Custom port
 *   npx agentoffice --build      # Build only, don't start
 */

import { build } from 'vite'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface CLIOptions {
  dev: boolean
  port: number
  host: string
  build: boolean
  open: boolean
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2)
  const options: CLIOptions = {
    dev: false,
    port: 3001,
    host: '0.0.0.0',
    build: false,
    open: true,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dev':
        options.dev = true
        break
      case '--port':
        options.port = parseInt(args[++i], 10)
        break
      case '--host':
        options.host = args[++i]
        break
      case '--build':
        options.build = true
        break
      case '--no-open':
        options.open = false
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  return options
}

function printHelp(): void {
  console.log(`
AgentOffice - AI Agent Control Tower

Usage:
  npx agentoffice [options]

Options:
  --dev           Start development servers (Vite HMR + tsx watch)
  --port <n>      Server port (default: 3001)
  --host <h>      Server host (default: 0.0.0.0)
  --build         Build web assets only, don't start server
  --no-open       Don't open browser automatically
  --help, -h      Show this help

Examples:
  npx agentoffice              # Production mode (serves built web)
  npx agentoffice --dev        # Development mode (hot reload)
  npx agentoffice --port 8080  # Custom port
  npx agentoffice --build      # Build only
`)
}

async function buildWeb(): Promise<void> {
  console.log('🔨 Building web assets...')
  const webDir = path.resolve(__dirname, '../web')
  const webConfigPath = path.resolve(webDir, 'vite.config.ts')
  await build({
    configFile: webConfigPath,
    root: webDir,
    mode: 'production',
  })
  console.log('✅ Web build complete')
}

function startServer(options: CLIOptions): ReturnType<typeof spawn> {
  const serverPath = path.resolve(__dirname, '../server/src/app.ts')
  const isDev = options.dev

  console.log(`🚀 Starting AgentOffice server on ${options.host}:${options.port} (${isDev ? 'dev' : 'prod'})...`)

  // Use tsx to run the server (handles TS and directory imports)
  const child = spawn('npx', ['tsx', 'watch', serverPath], {
    env: {
      ...process.env,
      PORT: String(options.port),
      HOST: options.host,
    },
    stdio: 'inherit',
    shell: true, // Needed on Windows
  })

  return child
}

function startDevWeb(options: CLIOptions): ReturnType<typeof spawn> {
  const webDir = path.resolve(__dirname, '../web')
  console.log(`🌐 Starting Vite dev server...`)

  const child = spawn('npx', ['vite', '--host', '--port', '5173'], {
    cwd: webDir,
    env: {
      ...process.env,
      VITE_SOCKET_URL: `http://localhost:${options.port}`,
    },
    stdio: 'inherit',
    shell: true,
  })

  return child
}

function openBrowser(url: string): void {
  const platform = process.platform
  let command: string
  let args: string[]

  if (platform === 'darwin') {
    command = 'open'
    args = [url]
  } else if (platform === 'win32') {
    command = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    command = 'xdg-open'
    args = [url]
  }

  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

async function main(): Promise<void> {
  const options = parseArgs()

  console.log('┌─────────────────────────────────────┐')
  console.log('│        AgentOffice v1.0.0           │')
  console.log('│   AI Agent Control Tower            │')
  console.log('└─────────────────────────────────────┘')

  try {
    // Build web assets if not in dev mode
    if (!options.dev) {
      await buildWeb()
    }

    // Build-only mode
    if (options.build) {
      console.log('✅ Build complete')
      return
    }

    const serverProcess = startServer(options)

    // In dev mode, also start Vite dev server
    let webProcess: ReturnType<typeof spawn> | null = null
    if (options.dev) {
      webProcess = startDevWeb(options)
    }

    const url = `http://localhost:${options.port}`
    console.log(`\n🌐 AgentOffice running at ${url}`)
    console.log(`📡 WebSocket server ready for agents`)
    console.log(`\nPress Ctrl+C to stop\n`)

    // Open browser
    if (options.open) {
      setTimeout(() => openBrowser(url), 1500)
    }

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n🛑 Shutting down...')
      serverProcess.kill('SIGTERM')
      if (webProcess) webProcess.kill('SIGTERM')
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    // Wait for server process to exit
    await new Promise<void>((resolve) => {
      serverProcess.on('exit', () => resolve())
    })
  } catch (error) {
    console.error('❌ Failed to start AgentOffice:', error)
    process.exit(1)
  }
}

main()