/**
 * BaseEvent - Base class for all events
 *
 * Subclass and use `declare` for your custom fields (no constructor needed):
 *
 * @example
 * ```typescript
 * class UserCreatedEvent extends BaseEvent<string> {
 *   declare user_id: string
 *   declare email: string
 * }
 *
 * // Usage - BaseEvent constructor hydrates all fields automatically
 * const event = new UserCreatedEvent({ user_id: '123', email: 'a@b.com' })
 * event.user_id  // '123'
 * event.email    // 'a@b.com'
 * await event.completed
 * const result = await event.eventResult()
 * ```
 */

import { z } from 'zod'
import { EventResult } from './event-result.js'
import { BaseEventSchema, EventStatus, type EventResultFilter } from './schemas.js'
import { generateUUID7, nowISO } from './utils.js'

const LIBRARY_VERSION = '0.1.0'

export interface BaseEventOptions {
  event_type?: string
  event_schema?: string
  event_timeout?: number | null
  event_result_type?: string | null
  event_id?: string
  event_path?: string[]
  event_parent_id?: string | null
  event_created_at?: string
  event_processed_at?: string | null
  [key: string]: unknown
}

/**
 * Base event class - subclass this to define custom events.
 * Use `await event.completed` to wait for all handlers to finish.
 */
export class BaseEvent<TResult = unknown> {
  // Override in subclasses via schema.extend({ event_result_type: z.whatever() })
  static schema: z.ZodType = BaseEventSchema

  // Event metadata fields
  event_type: string
  event_schema: string
  event_timeout: number | null
  event_result_type: string | null
  event_id: string
  event_path: string[]
  event_parent_id: string | null
  event_created_at: string
  event_processed_at: string | null

  // Results indexed by handler_id
  event_results: Map<string, EventResult<TResult>> = new Map()

  // Reference to the EventBus currently processing this event
  private _eventBus: unknown = null

  // Completion signal - exposed as a promise
  private _completionPromise: Promise<this>
  private _resolveCompletion!: (value: this) => void

  // Allow arbitrary properties for event data
  [key: string]: unknown

  constructor(data: BaseEventOptions = {}) {
    const ThisClass = this.constructor as typeof BaseEvent

    // Set up completion promise FIRST before any assignments
    this._completionPromise = new Promise<this>((resolve) => {
      this._resolveCompletion = resolve
    })

    // Apply defaults
    const defaults: BaseEventOptions = {
      event_id: generateUUID7(),
      event_created_at: nowISO(),
      event_type: ThisClass.name === 'BaseEvent' ? 'BaseEvent' : ThisClass.name,
      event_schema: `${ThisClass.name}@${LIBRARY_VERSION}`,
      event_timeout: 300.0,
      event_path: [],
      event_parent_id: null,
      event_processed_at: null,
      event_result_type: null,
    }

    const merged = { ...defaults, ...data }

    // Validate with Zod if schema is available
    let validated: Record<string, unknown>
    try {
      validated = ThisClass.schema.parse(merged)
    } catch {
      // If validation fails, use merged data directly (allows for custom fields)
      validated = merged
    }

    // Assign validated data to this instance
    // Assign all properties except private ones (starting with _)
    for (const [key, value] of Object.entries(validated)) {
      if (!key.startsWith('_')) {
        this[key] = value
      }
    }

    // TypeScript requires explicit assignment for non-optional fields
    this.event_type = (validated.event_type as string) ?? defaults.event_type!
    this.event_schema = (validated.event_schema as string) ?? defaults.event_schema!
    this.event_timeout = validated.event_timeout as number | null
    this.event_result_type = validated.event_result_type as string | null
    this.event_id = (validated.event_id as string) ?? defaults.event_id!
    this.event_path = (validated.event_path as string[]) ?? []
    this.event_parent_id = validated.event_parent_id as string | null
    this.event_created_at = (validated.event_created_at as string) ?? defaults.event_created_at!
    this.event_processed_at = validated.event_processed_at as string | null
  }

  // ===========================================================================
  // Completion Promise - use `await event.completed`
  // ===========================================================================

  /**
   * Promise that resolves when all handlers have completed.
   * Use `await event.completed` to wait for processing to finish.
   */
  get completed(): Promise<this> {
    return this._completionPromise
  }

  // ===========================================================================
  // EventBus reference - shortcut to dispatch child events
  // ===========================================================================

  /**
   * Get the EventBus currently processing this event.
   * Useful for dispatching child events from within handlers.
   *
   * @example
   * ```typescript
   * async function handler(event: MyEvent) {
   *   // Dispatch child event using the same bus
   *   const child = event.eventBus.dispatch(new ChildEvent())
   *   await child.completed
   * }
   * ```
   */
  get eventBus(): unknown {
    return this._eventBus
  }

  /** @internal Set by EventBus when processing starts */
  set eventBus(bus: unknown) {
    this._eventBus = bus
  }

  // ===========================================================================
  // Computed properties (match Python's @property)
  // ===========================================================================

  /** Current status of this event in the lifecycle */
  get eventStatus(): EventStatus {
    if (this.eventCompletedAt) return EventStatus.COMPLETED
    if (this.eventStartedAt) return EventStatus.STARTED
    return EventStatus.PENDING
  }

  /** Timestamp when event first started being processed by any handler */
  get eventStartedAt(): string | null {
    const startedTimes = [...this.event_results.values()]
      .map((r) => r.started_at)
      .filter((t): t is string => t !== null)
    if (startedTimes.length === 0) return this.event_processed_at
    return startedTimes.sort()[0] ?? null // Earliest
  }

  /** Timestamp when event was completed by all handlers */
  get eventCompletedAt(): string | null {
    if (this.event_results.size === 0) return this.event_processed_at

    const results = [...this.event_results.values()]
    const allDone = results.every(
      (r) => r.status === EventStatus.COMPLETED || r.status === EventStatus.ERROR
    )
    if (!allDone) return null

    const completedTimes = results
      .map((r) => r.completed_at)
      .filter((t): t is string => t !== null)
    return completedTimes.length > 0
      ? completedTimes.sort().reverse()[0] ?? null // Latest
      : this.event_processed_at
  }

  /** Get all child events dispatched from within this event's handlers */
  get eventChildren(): BaseEvent<unknown>[] {
    const children: BaseEvent<unknown>[] = []
    for (const result of this.event_results.values()) {
      children.push(...result.event_children)
    }
    return children
  }

  // ===========================================================================
  // Completion checking
  // ===========================================================================

  /** Check if this event and all its handlers/children have finished */
  eventIsComplete(): boolean {
    // Check all handlers are done
    for (const result of this.event_results.values()) {
      if (result.status !== EventStatus.COMPLETED && result.status !== EventStatus.ERROR) {
        return false
      }
    }
    // Check all children are complete
    return this.eventAreAllChildrenComplete()
  }

  /** Recursively check if all child events and their descendants are complete */
  eventAreAllChildrenComplete(visited: Set<string> = new Set()): boolean {
    if (visited.has(this.event_id)) return true // Prevent cycles
    visited.add(this.event_id)

    for (const child of this.eventChildren) {
      if (child.eventStatus !== EventStatus.COMPLETED) return false
      if (!child.eventAreAllChildrenComplete(visited)) return false
    }
    return true
  }

  /** Check if all handlers are done and signal completion */
  eventMarkCompleteIfAllHandlersCompleted(): void {
    if (this.event_results.size === 0) {
      this.event_processed_at = this.event_processed_at ?? nowISO()
      this._resolveCompletion(this)
      return
    }

    const results = [...this.event_results.values()]
    const allDone = results.every(
      (r) => r.status === EventStatus.COMPLETED || r.status === EventStatus.ERROR
    )
    if (!allDone) return

    if (!this.eventAreAllChildrenComplete()) return

    this.event_processed_at = this.event_processed_at ?? nowISO()
    this._resolveCompletion(this)
  }

  // ===========================================================================
  // Result management
  // ===========================================================================

  /** Default filter: truthy completed results (not errors, not null, not events) */
  private static _eventResultIsTruthy<T>(result: EventResult<T>): boolean {
    if (result.status !== EventStatus.COMPLETED) return false
    if (result.result === null) return false
    if (result.error) return false
    if (result.result instanceof BaseEvent) return false
    return true
  }

  /** Create or update an EventResult for a handler */
  eventResultUpdate(
    handlerId: string,
    handlerName: string,
    eventbusId: string,
    eventbusName: string,
    updates: Partial<{ status: EventStatus; result: TResult; error: Error }>
  ): EventResult<TResult> {
    let eventResult = this.event_results.get(handlerId)

    if (!eventResult) {
      eventResult = new EventResult<TResult>({
        event_id: this.event_id,
        handler_id: handlerId,
        handler_name: handlerName,
        eventbus_id: eventbusId,
        eventbus_name: eventbusName,
        timeout: this.event_timeout,
        result_type: this.event_result_type,
      })
      this.event_results.set(handlerId, eventResult)
    }

    if (Object.keys(updates).length > 0) {
      eventResult.update(updates)
    }

    return eventResult
  }

  /** Create pending EventResult placeholders for handlers before execution */
  eventCreatePendingResults(
    handlers: Map<string, { id: string; name: string }>,
    eventbusId: string,
    eventbusName: string
  ): Map<string, EventResult<TResult>> {
    const pending = new Map<string, EventResult<TResult>>()
    for (const [handlerId, handler] of handlers) {
      const result = this.eventResultUpdate(
        handlerId,
        handler.name,
        eventbusId,
        eventbusName,
        { status: EventStatus.PENDING }
      )
      // Reset stale data
      result.result = null
      result.error = null
      result.started_at = null
      result.completed_at = null
      result.status = EventStatus.PENDING
      pending.set(handlerId, result)
    }
    this.event_processed_at = this.event_processed_at ?? nowISO()
    return pending
  }

  // ===========================================================================
  // Result retrieval methods (match Python API)
  // ===========================================================================

  /** Get all results filtered by predicate */
  async eventResultsFiltered(
    options: {
      timeout?: number | null
      include?: EventResultFilter<TResult>
      raiseIfAny?: boolean
      raiseIfNone?: boolean
    } = {}
  ): Promise<Map<string, EventResult<TResult>>> {
    const {
      include = BaseEvent._eventResultIsTruthy,
      raiseIfAny = true,
      raiseIfNone = true,
    } = options

    // Wait for completion
    await this.completed

    // Check for errors first
    if (raiseIfAny) {
      for (const result of this.event_results.values()) {
        if (result.error) throw result.error
      }
    }

    // Filter results
    const filtered = new Map<string, EventResult<TResult>>()
    for (const [id, result] of this.event_results) {
      if (include(result)) {
        filtered.set(id, result)
      }
    }

    if (raiseIfNone && filtered.size === 0) {
      throw new Error(
        `Expected at least one handler to return a non-None result, but none did! ` +
          `${this.event_type}#${this.event_id.slice(-4)}`
      )
    }

    return filtered
  }

  /** Get all raw result values by handler ID */
  async eventResultsByHandlerId(
    options?: Parameters<typeof this.eventResultsFiltered>[0]
  ): Promise<Map<string, TResult | null>> {
    const filtered = await this.eventResultsFiltered(options)
    const results = new Map<string, TResult | null>()
    for (const [id, result] of filtered) {
      results.set(id, result.result)
    }
    return results
  }

  /** Get all raw result values by handler name */
  async eventResultsByHandlerName(
    options?: Parameters<typeof this.eventResultsFiltered>[0]
  ): Promise<Map<string, TResult | null>> {
    const filtered = await this.eventResultsFiltered(options)
    const results = new Map<string, TResult | null>()
    for (const result of filtered.values()) {
      results.set(result.handler_name, result.result)
    }
    return results
  }

  /** Get the first non-None result from handlers */
  async eventResult(
    options?: Parameters<typeof this.eventResultsFiltered>[0]
  ): Promise<TResult | null> {
    const filtered = await this.eventResultsFiltered(options)
    const first = [...filtered.values()][0]
    return first?.result ?? null
  }

  /** Get all result values as a list */
  async eventResultsList(
    options?: Parameters<typeof this.eventResultsFiltered>[0]
  ): Promise<(TResult | null)[]> {
    const filtered = await this.eventResultsFiltered(options)
    return [...filtered.values()].map((r) => r.result)
  }

  /** Merge all dict results into a single flat dict */
  async eventResultsFlatDict(
    options: Parameters<typeof this.eventResultsFiltered>[0] & {
      raiseIfConflicts?: boolean
    } = {}
  ): Promise<Record<string, unknown>> {
    const { raiseIfConflicts = true, ...rest } = options
    const filtered = await this.eventResultsFiltered({
      ...rest,
      include: (r) =>
        typeof r.result === 'object' && r.result !== null && !Array.isArray(r.result),
      raiseIfNone: false,
    })

    const merged: Record<string, unknown> = {}
    for (const result of filtered.values()) {
      const dict = result.result as Record<string, unknown>
      if (raiseIfConflicts) {
        const overlapping = Object.keys(merged).filter((k) => k in dict)
        if (overlapping.length > 0) {
          throw new Error(
            `Handler ${result.handler_name} returned dict with keys that would overwrite: ${overlapping.join(', ')}`
          )
        }
      }
      Object.assign(merged, dict)
    }
    return merged
  }

  /** Merge all list results into a single flat list */
  async eventResultsFlatList(
    options?: Parameters<typeof this.eventResultsFiltered>[0]
  ): Promise<unknown[]> {
    const filtered = await this.eventResultsFiltered({
      ...options,
      include: (r) => Array.isArray(r.result),
    })

    const merged: unknown[] = []
    for (const result of filtered.values()) {
      merged.push(...(result.result as unknown[]))
    }
    return merged
  }

  // ===========================================================================
  // Child event management
  // ===========================================================================

  /** Cancel any pending child events (called on handler error/timeout) */
  eventCancelPendingChildProcessing(error: Error): void {
    for (const child of this.eventChildren) {
      for (const result of child.event_results.values()) {
        if (result.status === EventStatus.PENDING) {
          result.update({ error: new Error(`Cancelled due to parent error: ${error.message}`) })
        }
      }
      child.eventCancelPendingChildProcessing(error)
    }
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  /** Only event metadata without contents (for safe logging) */
  eventLogSafeSummary(): Record<string, unknown> {
    const summary: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(this)) {
      if (key.startsWith('event_') && !key.includes('results')) {
        summary[key] = value
      }
    }
    return summary
  }

  toString(): string {
    const icon =
      this.eventStatus === EventStatus.PENDING
        ? '...'
        : this.eventStatus === EventStatus.COMPLETED
          ? 'done'
          : this.eventStatus === EventStatus.ERROR
            ? 'error'
            : 'running'
    const path = this.event_path.slice(1).join('>') || '?'
    return `${path}> ${this.event_type}#${this.event_id.slice(-4)} [${icon}]`
  }

  toJSON(): Record<string, unknown> {
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(this)) {
      if (!key.startsWith('_')) {
        if (value instanceof Map) {
          data[key] = Object.fromEntries(
            [...value.entries()].map(([k, v]) => [
              k,
              v && typeof v === 'object' && 'toJSON' in v
                ? (v as { toJSON(): unknown }).toJSON()
                : v,
            ])
          )
        } else {
          data[key] = value
        }
      }
    }
    return data
  }

  static fromJSON<T extends BaseEvent>(
    this: new (data: BaseEventOptions) => T,
    json: string | Record<string, unknown>
  ): T {
    const data = typeof json === 'string' ? JSON.parse(json) : json
    return new this(data as BaseEventOptions)
  }
}
