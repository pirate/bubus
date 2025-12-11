/**
 * EventBus - Async event bus with guaranteed FIFO processing
 *
 * Features:
 * - Enqueue events synchronously, await their results using 'await event'
 * - FIFO event processing
 * - Serial or parallel handler execution per event
 * - Parent event tracking via explicit bus reference
 */

import { BaseEvent, type BaseEventOptions } from './base-event.js'
import { EventResult } from './event-result.js'
import { EventStatus, type EventPattern, type EventHandler } from './schemas.js'
import {
  generateUUID7,
  nowISO,
  getHandlerName,
  getHandlerId,
  createDeferred,
  type Deferred,
} from './utils.js'

// =============================================================================
// Types
// =============================================================================

export type AsyncEventHandler<TEvent extends BaseEvent = BaseEvent, TResult = unknown> = (
  event: TEvent
) => Promise<TResult>

export interface EventBusOptions {
  /** Optional unique name for the bus (auto-generated if not provided) */
  name?: string
  /** If true, handlers run concurrently for each event, otherwise serially (default: false) */
  parallelHandlers?: boolean
  /** Maximum number of events to keep in history (default: 50, null = unlimited) */
  maxHistorySize?: number | null
}

export interface EventBusMiddleware {
  onEventChange?(
    eventbus: EventBus,
    event: BaseEvent,
    status: EventStatus
  ): Promise<void>
  onEventResultChange?(
    eventbus: EventBus,
    event: BaseEvent,
    eventResult: EventResult,
    status: EventStatus
  ): Promise<void>
}

// =============================================================================
// EventBus
// =============================================================================

/**
 * Async event bus with FIFO processing.
 *
 * @example
 * ```typescript
 * const bus = new EventBus({ name: 'MyBus' })
 *
 * bus.on(UserCreatedEvent, async (event) => {
 *   return `User ${event.user_id} created`
 * })
 *
 * const event = bus.dispatch(new UserCreatedEvent({ user_id: '123' }))
 * const result = await event.eventResult() // 'User 123 created'
 * ```
 */
export class EventBus {
  // Track all EventBus instances (for cross-bus event lookup)
  static allInstances: Set<EventBus> = new Set()

  // Instance properties
  readonly id: string
  name: string
  readonly parallelHandlers: boolean
  readonly maxHistorySize: number | null
  readonly middlewares: EventBusMiddleware[]

  // Runtime state
  private _handlers: Map<string, AsyncEventHandler[]> = new Map()
  private _eventQueue: BaseEvent[] = []
  private _eventHistory: Map<string, BaseEvent> = new Map()
  private _isRunning = false
  private _processingPromise: Promise<void> | null = null
  private _idleDeferred: Deferred<void> | null = null

  // Context tracking (for parent event tracking - explicit approach for browser compatibility)
  private _currentEvent: BaseEvent | null = null
  private _currentHandlerId: string | null = null

  constructor(options: EventBusOptions = {}) {
    this.id = generateUUID7()
    this.parallelHandlers = options.parallelHandlers ?? false
    this.maxHistorySize = options.maxHistorySize ?? 50
    this.middlewares = []

    // Handle name conflict detection
    const requestedName = options.name ?? `EventBus_${this.id.slice(-8)}`
    const existingNames = new Set(Array.from(EventBus.allInstances).map((b) => b.name))

    if (existingNames.has(requestedName)) {
      console.warn(
        `EventBus with name '${requestedName}' already exists. Auto-generating unique name.`
      )
      // Generate unique name with suffix
      let suffix = 1
      let uniqueName = `${requestedName}_${suffix}`
      while (existingNames.has(uniqueName)) {
        suffix++
        uniqueName = `${requestedName}_${suffix}`
      }
      this.name = uniqueName
    } else {
      this.name = requestedName
    }

    // Register this instance
    EventBus.allInstances.add(this)
  }

  // ===========================================================================
  // Properties
  // ===========================================================================

  /** Get events that haven't started processing yet */
  get eventsPending(): BaseEvent[] {
    return [...this._eventHistory.values()].filter(
      (event) => event.eventStartedAt === null && event.eventCompletedAt === null
    )
  }

  /** Get events currently being processed */
  get eventsStarted(): BaseEvent[] {
    return [...this._eventHistory.values()].filter(
      (event) => event.eventStartedAt !== null && event.eventCompletedAt === null
    )
  }

  /** Get events that have completed processing */
  get eventsCompleted(): BaseEvent[] {
    return [...this._eventHistory.values()].filter((event) => event.eventCompletedAt !== null)
  }

  /** Get a copy of the event history map */
  get eventHistory(): Map<string, BaseEvent> {
    return new Map(this._eventHistory)
  }

  /** Check if the bus is currently running */
  get isRunning(): boolean {
    return this._isRunning
  }

  // ===========================================================================
  // Handler Registration
  // ===========================================================================

  /**
   * Subscribe to events matching a pattern
   *
   * @param eventPattern - Event type name, event class, or '*' for all events
   * @param handler - Async handler function
   *
   * @example
   * ```typescript
   * bus.on('UserCreatedEvent', async (event) => { ... })
   * bus.on(UserCreatedEvent, async (event) => { ... })
   * bus.on('*', async (event) => { ... }) // All events
   * ```
   */
  on<TEvent extends BaseEvent = BaseEvent, TResult = unknown>(
    eventPattern: EventPattern | (new (data: BaseEventOptions) => TEvent),
    handler: AsyncEventHandler<TEvent, TResult>
  ): void {
    // Determine event key
    let eventKey: string
    if (eventPattern === '*') {
      eventKey = '*'
    } else if (typeof eventPattern === 'function') {
      eventKey = eventPattern.name
    } else {
      eventKey = eventPattern
    }

    // Get or create handler list for this event
    let handlers = this._handlers.get(eventKey)
    if (!handlers) {
      handlers = []
      this._handlers.set(eventKey, handlers)
    }

    // Check for duplicate handler names and warn
    const newHandlerName = getHandlerName(handler)
    const existingNames = handlers.map(getHandlerName)
    if (existingNames.includes(newHandlerName)) {
      console.warn(
        `${this} Handler ${newHandlerName} already registered for event '${eventKey}'. ` +
          `This may make it difficult to filter event results by handler name.`
      )
    }

    handlers.push(handler as AsyncEventHandler)
  }

  /**
   * Remove a handler from an event pattern
   */
  off<TEvent extends BaseEvent = BaseEvent, TResult = unknown>(
    eventPattern: EventPattern | (new (data: BaseEventOptions) => TEvent),
    handler: AsyncEventHandler<TEvent, TResult>
  ): void {
    const eventKey =
      typeof eventPattern === 'function' ? eventPattern.name : String(eventPattern)
    const handlers = this._handlers.get(eventKey)
    if (handlers) {
      const index = handlers.indexOf(handler as AsyncEventHandler)
      if (index !== -1) {
        handlers.splice(index, 1)
      }
    }
  }

  // ===========================================================================
  // Event Dispatching
  // ===========================================================================

  /**
   * Dispatch an event for processing and immediately return
   *
   * @param event - The event to dispatch
   * @returns The dispatched event (can be awaited for completion)
   *
   * @example
   * ```typescript
   * // Fire and forget
   * bus.dispatch(new UserCreatedEvent({ user_id: '123' }))
   *
   * // Wait for completion
   * const event = await bus.dispatch(new UserCreatedEvent({ user_id: '123' }))
   *
   * // Get result
   * const result = await bus.dispatch(new UserCreatedEvent({ user_id: '123' })).eventResult()
   * ```
   */
  dispatch<TEvent extends BaseEvent>(event: TEvent): TEvent {
    // Set parent event ID from context if not already set
    if (event.event_parent_id === null && this._currentEvent !== null) {
      event.event_parent_id = this._currentEvent.event_id
    }

    // Track child events - add to current handler's children
    if (
      this._currentHandlerId !== null &&
      this._currentEvent !== null &&
      event.event_id !== this._currentEvent.event_id
    ) {
      const currentResult = this._currentEvent.event_results.get(this._currentHandlerId)
      if (currentResult) {
        currentResult.event_children.push(event)
      }
    }

    // Add this EventBus to the event_path if not already there
    if (!event.event_path.includes(this.name)) {
      event.event_path.push(this.name)
    }

    // Add to history
    this._eventHistory.set(event.event_id, event)

    // Add to queue
    this._eventQueue.push(event)

    // Notify middlewares
    this._onEventChange(event, EventStatus.PENDING)

    // Start processing if not already running
    this._startProcessing()

    // Clean up excess events
    if (this.maxHistorySize !== null && this._eventHistory.size > this.maxHistorySize) {
      this._cleanupEventHistory()
    }

    return event
  }

  // ===========================================================================
  // Event Processing
  // ===========================================================================

  private _startProcessing(): void {
    if (this._isRunning) return
    this._isRunning = true
    this._processingPromise = this._runLoop()
  }

  private async _runLoop(): Promise<void> {
    while (this._eventQueue.length > 0) {
      const event = this._eventQueue.shift()
      if (event) {
        await this._handleEvent(event)
      }
    }

    this._isRunning = false
    this._processingPromise = null

    // Signal idle
    if (this._idleDeferred) {
      this._idleDeferred.resolve()
      this._idleDeferred = null
    }
  }

  private async _handleEvent(event: BaseEvent): Promise<void> {
    // Set eventBus reference so handlers can access it via event.eventBus
    event.eventBus = this

    // Get applicable handlers
    const applicableHandlers = this._getApplicableHandlers(event)

    // Create pending results
    const handlersMap = new Map<string, { id: string; name: string }>()
    for (const [handlerId, handler] of applicableHandlers) {
      handlersMap.set(handlerId, { id: handlerId, name: getHandlerName(handler) })
    }
    event.eventCreatePendingResults(handlersMap, this.id, this.name)

    // Notify middlewares of pending results
    for (const result of event.event_results.values()) {
      await this._onEventResultChange(event, result, EventStatus.PENDING)
    }

    // Execute handlers
    await this._executeHandlers(event, applicableHandlers)

    // Mark event as complete
    event.eventMarkCompleteIfAllHandlersCompleted()
    if (event.eventStatus === EventStatus.COMPLETED) {
      await this._onEventChange(event, EventStatus.COMPLETED)
    }

    // Propagate completion up parent chain
    this._propagateParentCompletion(event)
  }

  private _getApplicableHandlers(event: BaseEvent): Map<string, AsyncEventHandler> {
    const applicable = new Map<string, AsyncEventHandler>()

    // Get type-specific handlers
    const typeHandlers = this._handlers.get(event.event_type) ?? []
    for (const handler of typeHandlers) {
      const handlerId = getHandlerId(handler, this.id)
      if (!this._wouldCreateLoop(event, handlerId)) {
        applicable.set(handlerId, handler)
      }
    }

    // Get wildcard handlers
    const wildcardHandlers = this._handlers.get('*') ?? []
    for (const handler of wildcardHandlers) {
      const handlerId = getHandlerId(handler, this.id)
      if (!this._wouldCreateLoop(event, handlerId)) {
        applicable.set(handlerId, handler)
      }
    }

    return applicable
  }

  private _wouldCreateLoop(event: BaseEvent, handlerId: string): boolean {
    // Check if handler already has a result for this event
    if (event.event_results.has(handlerId)) {
      const existingResult = event.event_results.get(handlerId)!
      if (
        existingResult.status === EventStatus.PENDING ||
        existingResult.status === EventStatus.STARTED
      ) {
        return true
      }
      if (existingResult.completed_at !== null) {
        return true
      }
    }

    return false
  }

  private async _executeHandlers(
    event: BaseEvent,
    handlers: Map<string, AsyncEventHandler>
  ): Promise<void> {
    if (handlers.size === 0) return

    // Notify event started
    let isFirst = true

    if (this.parallelHandlers) {
      // Execute all handlers in parallel
      const promises: Promise<void>[] = []
      for (const [handlerId, handler] of handlers) {
        promises.push(this._executeHandler(event, handlerId, handler, isFirst))
        isFirst = false
      }
      await Promise.all(promises)
    } else {
      // Execute handlers serially
      for (const [handlerId, handler] of handlers) {
        await this._executeHandler(event, handlerId, handler, isFirst)
        isFirst = false
      }
    }
  }

  private async _executeHandler(
    event: BaseEvent,
    handlerId: string,
    handler: AsyncEventHandler,
    isFirstHandler: boolean
  ): Promise<void> {
    const eventResult = event.event_results.get(handlerId)!

    // Notify started
    eventResult.update({ status: EventStatus.STARTED })
    await this._onEventResultChange(event, eventResult, EventStatus.STARTED)

    if (isFirstHandler) {
      await this._onEventChange(event, EventStatus.STARTED)
    }

    // Set context for child event tracking
    const previousEvent = this._currentEvent
    const previousHandlerId = this._currentHandlerId
    this._currentEvent = event
    this._currentHandlerId = handlerId

    // Set global handler context flag (used by BaseEvent.completed to throw helpful errors)
    const globalObj = globalThis as unknown as { __bubus_inside_handler?: boolean }
    const wasInsideHandler = globalObj.__bubus_inside_handler ?? false
    globalObj.__bubus_inside_handler = true

    try {
      // Execute with timeout if specified
      let resultValue: unknown
      if (event.event_timeout !== null && event.event_timeout > 0) {
        resultValue = await this._withTimeout(
          handler(event),
          event.event_timeout * 1000,
          `Handler ${eventResult.handler_name} timed out after ${event.event_timeout}s`
        )
      } else {
        resultValue = await handler(event)
      }

      eventResult.update({ result: resultValue })
      await this._onEventResultChange(event, eventResult, EventStatus.COMPLETED)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      eventResult.update({ error })
      await this._onEventResultChange(event, eventResult, EventStatus.COMPLETED)

      // Cancel pending children
      event.eventCancelPendingChildProcessing(error)
    } finally {
      // Restore context
      this._currentEvent = previousEvent
      this._currentHandlerId = previousHandlerId
      // Restore global handler context flag
      globalObj.__bubus_inside_handler = wasInsideHandler
    }
  }

  /**
   * Process an event immediately, bypassing the queue (queue jumping).
   * Use this when a handler needs to await a child event it just dispatched.
   *
   * @param event - The event to process immediately
   * @returns The completed event
   *
   * @example
   * ```typescript
   * bus.on(ParentEvent, async (event) => {
   *   // Dispatch child and process immediately (queue jumping)
   *   const child = await bus.immediate(new ChildEvent())
   *   return `child result: ${await child.eventResult()}`
   * })
   * ```
   */
  async immediate<TEvent extends BaseEvent>(event: TEvent): Promise<TEvent> {
    // If already completed, just return
    if (event.eventStatus === EventStatus.COMPLETED) {
      return event
    }

    // Check if THIS bus has already started processing this event
    // (different from another bus having processed it - e.g., during forwarding)
    const thisUBusResults = [...event.event_results.values()].filter(
      (r) => r.eventbus_id === this.id
    )

    if (thisUBusResults.length > 0) {
      // This bus has already started processing - wait for our results to complete
      const pendingResults = thisUBusResults.filter(
        (r) => r.status !== EventStatus.COMPLETED
      )
      if (pendingResults.length > 0) {
        await Promise.all(pendingResults)
      }
      event.eventMarkCompleteIfAllHandlersCompleted()
      return event
    }

    // Register event in history directly (DON'T use dispatch() to avoid race with run loop)
    if (!this._eventHistory.has(event.event_id)) {
      // Set parent event ID from context if not already set
      if (event.event_parent_id === null && this._currentEvent !== null) {
        event.event_parent_id = this._currentEvent.event_id
      }

      // Track child events - add to current handler's children
      if (
        this._currentHandlerId !== null &&
        this._currentEvent !== null &&
        event.event_id !== this._currentEvent.event_id
      ) {
        const currentResult = this._currentEvent.event_results.get(this._currentHandlerId)
        if (currentResult) {
          currentResult.event_children.push(event)
        }
      }

      // Add this EventBus to the event_path if not already there
      if (!event.event_path.includes(this.name)) {
        event.event_path.push(this.name)
      }

      // Add to history (but NOT to queue - we're processing immediately)
      this._eventHistory.set(event.event_id, event)

      // Notify middlewares
      this._onEventChange(event, EventStatus.PENDING)

      // Clean up excess events
      if (this.maxHistorySize !== null && this._eventHistory.size > this.maxHistorySize) {
        this._cleanupEventHistory()
      }
    }

    // Remove from queue if somehow present
    const queueIndex = this._eventQueue.indexOf(event)
    if (queueIndex !== -1) {
      this._eventQueue.splice(queueIndex, 1)
    }

    // Process the event immediately
    await this._handleEvent(event)

    return event
  }

  private async _withTimeout<T>(
    promiseOrValue: Promise<T> | T,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(message))
      }, timeoutMs)

      // Wrap in Promise.resolve to handle both Promise and non-Promise values
      Promise.resolve(promiseOrValue)
        .then((result) => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }

  private _propagateParentCompletion(event: BaseEvent, visited: Set<string> = new Set()): void {
    if (!event.event_parent_id) return
    if (visited.has(event.event_id)) return // Prevent infinite recursion
    visited.add(event.event_id)

    // Find parent in any bus's history
    let parentEvent: BaseEvent | undefined
    for (const bus of EventBus.allInstances) {
      parentEvent = bus._eventHistory.get(event.event_parent_id)
      if (parentEvent) break
    }

    if (parentEvent) {
      parentEvent.eventMarkCompleteIfAllHandlersCompleted()
      this._propagateParentCompletion(parentEvent, visited)
    }
  }

  // ===========================================================================
  // Event Finding
  // ===========================================================================

  /**
   * Find an event matching criteria in history and/or wait for future events
   *
   * @param eventType - Event type name or class
   * @param options - Search options
   *
   * @example
   * ```typescript
   * // Search all history, wait up to 5s for future
   * const event = await bus.find(ResponseEvent, { past: true, future: 5 })
   *
   * // Search last 5s of history, wait forever
   * const event = await bus.find(ResponseEvent, { past: 5, future: true })
   *
   * // Search history only, no waiting
   * const event = await bus.find(ResponseEvent, { past: true, future: false })
   * ```
   */
  async find<TEvent extends BaseEvent>(
    eventType: string | (new (data: BaseEventOptions) => TEvent),
    options: {
      where?: (event: BaseEvent) => boolean
      childOf?: BaseEvent
      past?: boolean | number
      future?: boolean | number
    } = {}
  ): Promise<TEvent | null> {
    const { where = () => true, childOf, past = true, future = true } = options

    const eventKey = typeof eventType === 'function' ? eventType.name : eventType

    // Check if matches criteria
    const matches = (event: BaseEvent): boolean => {
      if (event.event_type !== eventKey) return false
      if (!where(event)) return false
      if (childOf && !this._eventIsChildOf(event, childOf)) return false
      return true
    }

    // Search past history
    if (past !== false) {
      const cutoff =
        typeof past === 'number'
          ? new Date(Date.now() - past * 1000).toISOString()
          : null

      for (const event of [...this._eventHistory.values()].reverse()) {
        if (event.eventCompletedAt === null) continue
        if (cutoff && event.event_created_at < cutoff) continue
        if (matches(event)) {
          return event as TEvent
        }
      }
    }

    // If not searching future, return null
    if (future === false) {
      return null
    }

    // Wait for future events
    // NOTE: We store the event reference and resolve with a marker value to avoid
    // thenable unwrapping deadlock. The event is a PromiseLike and resolving with
    // it would wait for the event to complete, which creates a circular wait since
    // this handler needs to complete first.
    let foundEvent: TEvent | null = null
    const deferred = createDeferred<boolean>()

    const tempHandler: AsyncEventHandler = async (event: BaseEvent) => {
      if (matches(event)) {
        foundEvent = event as TEvent
        deferred.resolve(true)
      }
    }

    this.on(eventKey, tempHandler)

    try {
      if (future === true) {
        await deferred.promise
      } else {
        // Wait with timeout
        await this._withTimeout(
          deferred.promise,
          future * 1000,
          'Find timeout'
        ).catch(() => null)
      }
      return foundEvent
    } finally {
      this.off(eventKey, tempHandler)
    }
  }

  /**
   * Check if event is a descendant of ancestor (child, grandchild, etc.)
   */
  eventIsChildOf(event: BaseEvent, ancestor: BaseEvent): boolean {
    return this._eventIsChildOf(event, ancestor)
  }

  /**
   * Check if event is an ancestor of descendant (parent, grandparent, etc.)
   */
  eventIsParentOf(event: BaseEvent, descendant: BaseEvent): boolean {
    return this._eventIsChildOf(descendant, event)
  }

  private _eventIsChildOf(event: BaseEvent, ancestor: BaseEvent): boolean {
    let currentId = event.event_parent_id
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
      if (currentId === ancestor.event_id) return true
      visited.add(currentId)

      // Find parent in any bus
      let parent: BaseEvent | undefined
      for (const bus of EventBus.allInstances) {
        parent = bus._eventHistory.get(currentId)
        if (parent) break
      }
      if (!parent) break
      currentId = parent.event_parent_id
    }

    return false
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Wait until the event bus is idle (no events being processed)
   */
  async waitUntilIdle(timeout?: number): Promise<void> {
    if (!this._isRunning && this._eventQueue.length === 0) {
      return
    }

    this._idleDeferred = this._idleDeferred ?? createDeferred<void>()

    if (timeout !== undefined) {
      await this._withTimeout(
        this._idleDeferred.promise,
        timeout * 1000,
        `Timeout waiting for idle after ${timeout}s`
      ).catch(() => {})
    } else {
      await this._idleDeferred.promise
    }
  }

  /**
   * Stop the event bus
   */
  async stop(options: { timeout?: number; clear?: boolean } = {}): Promise<void> {
    const { timeout, clear = false } = options

    if (timeout !== undefined && timeout > 0) {
      await this.waitUntilIdle(timeout)
    }

    this._isRunning = false

    // Clear if requested
    if (clear) {
      this._eventHistory.clear()
      this._handlers.clear()
      this._eventQueue = []
      EventBus.allInstances.delete(this)
    }
  }

  // ===========================================================================
  // History Management
  // ===========================================================================

  private _cleanupEventHistory(): void {
    if (this.maxHistorySize === null) return

    const sortedEvents = [...this._eventHistory.entries()].sort(
      ([, a], [, b]) =>
        new Date(a.event_created_at).getTime() - new Date(b.event_created_at).getTime()
    )

    // Remove oldest completed events first
    const completed = sortedEvents.filter(([, e]) => e.eventCompletedAt !== null)
    const toRemove = completed.slice(0, Math.max(0, this._eventHistory.size - this.maxHistorySize))

    for (const [id] of toRemove) {
      this._eventHistory.delete(id)
    }
  }

  // ===========================================================================
  // Middleware
  // ===========================================================================

  private async _onEventChange(event: BaseEvent, status: EventStatus): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.onEventChange) {
        await middleware.onEventChange(this, event, status)
      }
    }
  }

  private async _onEventResultChange(
    event: BaseEvent,
    eventResult: EventResult,
    status: EventStatus
  ): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.onEventResultChange) {
        await middleware.onEventResultChange(this, event, eventResult, status)
      }
    }
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  toString(): string {
    const running = this._isRunning ? String.fromCodePoint(0x1f7e2) : String.fromCodePoint(0x1f534)
    return `${this.name}${running}(${String.fromCodePoint(0x23f3)} ${this.eventsPending.length} | ${String.fromCodePoint(0x25b6)} ${this.eventsStarted.length} | ${String.fromCodePoint(0x2705)} ${this.eventsCompleted.length} -> ${this._handlers.size} handlers)`
  }
}
