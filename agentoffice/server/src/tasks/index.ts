/**
 * Task Queue - Queue, broadcast, handoff router.
 *
 * Responsibilities:
 * - Hold a queue of "tasks" being carried out by agents
 * - Broadcast a task to all agents in a room
 * - Route handoffs between agents (requires both agents to allow it)
 * - Track task progress and agent usage budgets
 *
 * Layering: depends on core only (AgentEvent, Command, AgentAdapter types)
 */

import type { AgentEvent, Command, AgentAdapter, SessionHandle } from '@agentoffice/core'

export interface Task {
  id: string
  /** The task description/objective */
  description: string
  /** The agentId currently carrying this task, or null if unassigned */
  assignedTo: string | null
  /** Current progress 0-100 */
  progress: number
  /** Artifacts generated during the task */
  artifacts: string[]
  /** Budget tracking for this task */
  budgetUsd: number
  /** Created timestamp */
  createdAt: string
}

export interface ITaskQueue {
  /** Create a new task and assign it to an agent */
  createTask: (description: string, assignTo: string, budgetUsd: number) => Task
  /** Assign a task to a different agent */
  assignTask: (taskId: string, newAgentId: string) => Task | null
  /** Broadcast a task to all agents in a room */
  broadcastTask: (task: Task) => void
  /** Route a handoff from one agent to another (both must allow) */
  routeHandoff: (fromAgentId: string, toAgentId: string, taskId: string) => Promise<boolean>
  /** Get all active tasks */
  listTasks: () => Task[]
  /** Get task by ID */
  getTask: (taskId: string) => Task | undefined
}

export class TaskQueue implements ITaskQueue {
  private tasks: Map<string, Task> = new Map()
  private agentTaskMap: Map<string, Set<string>> = new Map() // agentId -> set of taskIds

  constructor(private bus: any) {
    // Subscribe to handoff events from the bus
    bus.subscribe('handoff', (payload: any) => {
      this._handleHandoffPayload(payload)
    })
  }

  createTask(description: string, assignTo: string, budgetUsd: number): Task {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const task: Task = {
      id,
      description,
      assignedTo: assignTo,
      progress: 0,
      artifacts: [],
      budgetUsd,
      createdAt: new Date().toISOString(),
    }

    this.tasks.set(id, task)

    // Track assignment
    let tasks = this.agentTaskMap.get(assignTo) || new Set()
    tasks.add(id)
    this.agentTaskMap.set(assignTo, tasks)

    // Publish task-created event
    this.bus.publish('task-created', { taskId: id, description, assignedTo: assignTo })

    return task
  }

  assignTask(taskId: string, newAgentId: string): Task | null {
    const task = this.tasks.get(taskId)
    if (!task) return null

    const oldAgentId = task.assignedTo

    // Remove from old agent's task list (if there was one)
    if (oldAgentId !== null) {
      const oldTasks = this.agentTaskMap.get(oldAgentId) || new Set()
      oldTasks.delete(taskId)
      this.agentTaskMap.set(oldAgentId, oldTasks)
    }

    // Assign to new agent
    task.assignedTo = newAgentId
    this.tasks.set(taskId, task)

    let newTasks = this.agentTaskMap.get(newAgentId) || new Set()
    newTasks.add(taskId)
    this.agentTaskMap.set(newAgentId, newTasks)

    // Publish task-assigned event
    this.bus.publish('task-assigned', { taskId, newAgentId, oldAgentId })

    return task
  }

  broadcastTask(task: Task): void {
    this.bus.publish('task-broadcast', { task })
  }

  async routeHandoff(fromAgentId: string, toAgentId: string, taskId: string): Promise<boolean> {
    // A handoff requires BOTH agents to allow it.
    // 1. Check the current agent (from) is willing to hand off
    // 2. Check the target agent (to) is willing to take handoff
    // 3. If both agree, assign the task to the target and notify both

    const targetTask = this.tasks.get(taskId)
    if (!targetTask || targetTask.assignedTo === null || targetTask.assignedTo !== fromAgentId) {
      return false
    }

    // In a real implementation, we would send a 'handoff' command to both agents
    // and wait for approval from both. For now, we'll simulate a successful handoff.
    // The actual flow would be:
    // - Send handoff command to fromAgent with 'approve' expected
    // - Send handoff command to toAgent with 'approve' expected
    // - On both approvals, assignTask(toAgentId, taskId)

    // For now: immediately handoff (this would be gated by approvals in Phase 2+)
    this.assignTask(taskId, toAgentId)

    // Notify both agents
    this.bus.publish('handoff-completed', {
      taskId,
      fromAgentId,
      toAgentId,
    })

    return true
  }

  listTasks(): Task[] {
    return Array.from(this.tasks.values())
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId)
  }

  private _handleHandoffPayload(payload: any) {
    // Handle handoff initiation from an adapter
    const { fromAgentId, toAgentId, taskId } = payload
    this.routeHandoff(fromAgentId, toAgentId, taskId)
  }
}