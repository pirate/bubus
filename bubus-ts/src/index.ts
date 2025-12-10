/**
 * bubus - Production-ready event bus library for TypeScript
 *
 * Browser & Node compatible using ESM.
 * Cross-language compatible with Python bubus via Zod schemas.
 *
 * @example
 * ```typescript
 * import { EventBus, BaseEvent } from 'bubus'
 *
 * // Define a typed event
 * class UserCreatedEvent extends BaseEvent<string> {
 *   user_id: string
 *   email: string
 *
 *   constructor(data: { user_id: string; email: string }) {
 *     super({ ...data, event_type: 'UserCreatedEvent' })
 *     this.user_id = data.user_id
 *     this.email = data.email
 *   }
 * }
 *
 * // Create event bus
 * const bus = new EventBus({ name: 'MyBus' })
 *
 * // Register handler
 * bus.on(UserCreatedEvent, async (event) => {
 *   return `User ${event.user_id} created with email ${event.email}`
 * })
 *
 * // Dispatch and await result
 * const event = bus.dispatch(new UserCreatedEvent({ user_id: '123', email: 'test@example.com' }))
 * const result = await event.eventResult()
 * console.log(result) // 'User 123 created with email test@example.com'
 * ```
 */

// Core classes
export { BaseEvent, type BaseEventOptions } from './base-event.js'
export { EventResult, type EventResultOptions } from './event-result.js'
export {
  EventBus,
  type EventBusOptions,
  type EventBusMiddleware,
  type AsyncEventHandler,
} from './event-bus.js'

// Schemas for cross-language compatibility
export {
  // Validators
  UUIDStr,
  PythonIdentifierStr,
  HandlerId,
  BusId,
  DateTimeStr,

  // Status
  EventStatus,
  EventStatusSchema,

  // Event schemas
  BaseEventSchema,
  EventResultSchema,

  // Types
  type BaseEventData,
  type EventResultData,
  type ResultOf,
  type EventResultFilter,
  type EventHandler,
  type EventPattern,
} from './schemas.js'

// Utilities
export {
  generateUUID7,
  isValidPythonIdentifier,
  nowISO,
  createDeferred,
  sleep,
  getHandlerName,
  getHandlerId,
  type Deferred,
} from './utils.js'
