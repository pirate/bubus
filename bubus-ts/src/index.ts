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
 * // Define a typed event - use `declare` for fields, no constructor needed!
 * class UserCreatedEvent extends BaseEvent<string> {
 *   declare user_id: string
 *   declare email: string
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
 * await event.completed
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
  type IEventBus,
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
