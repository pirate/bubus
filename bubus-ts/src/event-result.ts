/**
 * EventResult - Result from a single handler execution
 * Maps to Python's EventResult[T_EventResultType]
 */

import { EventStatus } from './schemas.js'
import type { BaseEvent } from './base-event.js'
import { generateUUID7 } from './utils.js'

export interface EventResultOptions {
  event_id: string
  handler_id: string
  handler_name: string
  eventbus_id: string
  eventbus_name: string
  timeout?: number | null
  result_type?: string | null
}

/**
 * Result from a single handler execution.
 * Implements PromiseLike to allow `await eventResult` to get the handler return value.
 */
export class EventResult<TResult = unknown> implements PromiseLike<TResult | null> {
  // Identity
  readonly id: string
  readonly event_id: string
  readonly handler_id: string
  readonly handler_name: string

  // EventBus context
  readonly eventbus_id: string
  readonly eventbus_name: string

  // Status tracking
  status: EventStatus = EventStatus.PENDING
  timeout: number | null = null
  started_at: string | null = null
  completed_at: string | null = null

  // Result data
  result_type: string | null = null
  result: TResult | null = null
  error: Error | null = null

  // Child events dispatched during handler execution
  event_children: BaseEvent<unknown>[] = []

  // Completion signal
  private _completedPromise: Promise<TResult | null>
  private _resolveCompleted!: (value: TResult | null) => void
  private _rejectCompleted!: (error: Error) => void

  constructor(options: EventResultOptions) {
    this.id = generateUUID7()
    this.event_id = options.event_id
    this.handler_id = options.handler_id
    this.handler_name = options.handler_name
    this.eventbus_id = options.eventbus_id
    this.eventbus_name = options.eventbus_name
    this.timeout = options.timeout ?? null
    this.result_type = options.result_type ?? null

    this._completedPromise = new Promise((resolve, reject) => {
      this._resolveCompleted = resolve
      this._rejectCompleted = reject
    })
  }

  // PromiseLike - await result to get handler return value
  then<T1 = TResult | null, T2 = never>(
    onfulfilled?: ((value: TResult | null) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return this._completedPromise.then(onfulfilled, onrejected)
  }

  toString(): string {
    const handlerQualname = `${this.eventbus_name}.${this.handler_name}`
    return `${handlerQualname}() -> ${this.result ?? this.error ?? '...'} (${this.status})`
  }

  /**
   * Update the EventResult with new state.
   * Called by EventBus during handler execution.
   */
  update(data: {
    status?: EventStatus
    result?: TResult
    error?: Error | string
    started_at?: string
    completed_at?: string
  }): this {
    // Handle error conversion
    if (data.error !== undefined) {
      this.error = data.error instanceof Error ? data.error : new Error(String(data.error))
      this.status = EventStatus.ERROR
    }

    // Handle result - check if it's actually an Error (common mistake)
    if (data.result !== undefined) {
      if (data.result instanceof Error) {
        console.warn(
          `Event handler ${this.handler_name} returned an exception object, ` +
            `auto-converting to EventResult(result=null, status="error", error=${data.result})`
        )
        this.error = data.result
        this.status = EventStatus.ERROR
        this.result = null
      } else {
        this.result = data.result
        this.status = EventStatus.COMPLETED
      }
    }

    if (data.status !== undefined) {
      this.status = data.status
    }

    // Set started_at on first non-pending status
    if (this.status !== EventStatus.PENDING && !this.started_at) {
      this.started_at = data.started_at ?? new Date().toISOString()
    }

    // Set completed_at and resolve promise on completion
    if (
      (this.status === EventStatus.COMPLETED || this.status === EventStatus.ERROR) &&
      !this.completed_at
    ) {
      this.completed_at = data.completed_at ?? new Date().toISOString()
      if (this.error) {
        this._rejectCompleted(this.error)
      } else {
        this._resolveCompleted(this.result)
      }
    }

    return this
  }

  /**
   * Execute a handler and update this result automatically.
   * @param event - The event being handled
   * @param handler - The handler function to execute
   */
  async execute(
    event: BaseEvent<TResult>,
    handler: (event: BaseEvent<TResult>) => TResult | Promise<TResult>
  ): Promise<TResult | null> {
    this.update({ status: EventStatus.STARTED })

    try {
      const result = await Promise.resolve(handler(event))
      this.update({ result })
      return this.result
    } catch (err) {
      this.update({ error: err instanceof Error ? err : new Error(String(err)) })
      throw this.error
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      event_id: this.event_id,
      handler_id: this.handler_id,
      handler_name: this.handler_name,
      eventbus_id: this.eventbus_id,
      eventbus_name: this.eventbus_name,
      status: this.status,
      timeout: this.timeout,
      started_at: this.started_at,
      completed_at: this.completed_at,
      result_type: this.result_type,
      result: this.result,
      error: this.error?.message ?? null,
      event_children: this.event_children.map((c) => c.toJSON()),
    }
  }

  /**
   * Create an EventResult from JSON data
   */
  static fromJSON<T = unknown>(json: string | Record<string, unknown>): EventResult<T> {
    const data = typeof json === 'string' ? JSON.parse(json) : json
    const result = new EventResult<T>({
      event_id: data.event_id as string,
      handler_id: data.handler_id as string,
      handler_name: data.handler_name as string,
      eventbus_id: data.eventbus_id as string,
      eventbus_name: data.eventbus_name as string,
      timeout: data.timeout as number | null,
      result_type: data.result_type as string | null,
    })

    // Restore state
    result.status = data.status as EventStatus
    result.started_at = data.started_at as string | null
    result.completed_at = data.completed_at as string | null
    result.result = data.result as T | null
    if (data.error) {
      result.error = new Error(data.error as string)
    }

    return result
  }
}
