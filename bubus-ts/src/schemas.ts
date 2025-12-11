/**
 * Zod schemas for bubus event bus - Cross-language compatible with Python bubus
 *
 * Design decisions:
 * - snake_case for fields: Match Python field names exactly for JSON compatibility
 * - camelCase for methods: Idiomatic TypeScript
 * - ISO 8601 strings for datetime: Universal format, no unix timestamps
 * - String UUIDs: No UUID objects, just validated strings containing UUIDs
 */

import { z } from 'zod'

// =============================================================================
// Custom Validators (matching Python's Annotated validators)
// =============================================================================

/** Validates UUID string format (any version) */
export const UUIDStr = z.string().uuid()

/**
 * Validates Python identifier format (event names, bus names)
 * Must be a valid Python identifier and not start with underscore
 */
export const PythonIdentifierStr = z
  .string()
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    'Must be a valid Python identifier'
  )
  .refine((s) => !s.startsWith('_'), 'Must not start with underscore')

/** Unique identifier for a handler (auto-generated at registration) */
export const HandlerId = z.string()

/** Unique identifier for an EventBus instance (auto-generated at creation) */
export const BusId = z.string()

/** ISO 8601 datetime string */
export const DateTimeStr = z.string().datetime({ offset: true })

// =============================================================================
// Event Status
// =============================================================================

/**
 * Event status enum - matches Python's EventStatus(StrEnum)
 * Using const enum for tree-shaking, string values for JSON compatibility
 */
export const EventStatus = {
  PENDING: 'pending',
  STARTED: 'started',
  COMPLETED: 'completed',
} as const

export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus]

/** Zod schema for EventStatus */
export const EventStatusSchema = z.enum(['pending', 'started', 'completed'])

// =============================================================================
// EventResult Schema
// =============================================================================

/**
 * Schema for EventResult - result from a single handler execution
 * Forward reference for BaseEvent is handled via lazy evaluation
 */
export const EventResultSchema = z.object({
  id: UUIDStr,
  event_id: UUIDStr,
  handler_id: HandlerId,
  handler_name: z.string(),
  eventbus_id: BusId,
  eventbus_name: PythonIdentifierStr,
  status: EventStatusSchema,
  timeout: z.number().nullable(),
  started_at: DateTimeStr.nullable(),
  completed_at: DateTimeStr.nullable(),
  result_type: z.string().nullable(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  event_children: z.array(z.lazy(() => BaseEventSchema)),
})

export type EventResultData = z.infer<typeof EventResultSchema>

// =============================================================================
// BaseEvent Schema
// =============================================================================

/** Zod schema for parsing BaseEvent from JSON */
export const BaseEventSchema = z
  .object({
    event_type: PythonIdentifierStr,
    event_schema: z.string().max(250),
    event_timeout: z.number().nullable().default(300.0),
    event_result_type: z.string().nullable(),
    event_id: UUIDStr,
    event_path: z.array(PythonIdentifierStr),
    event_parent_id: UUIDStr.nullable(),
    event_created_at: DateTimeStr,
    event_processed_at: DateTimeStr.nullable(),
  })
  .passthrough()

export type BaseEventData = z.infer<typeof BaseEventSchema>

// =============================================================================
// Helper Types
// =============================================================================

/** Helper type to extract result type from an event schema */
export type ResultOf<T extends z.ZodObject<z.ZodRawShape>> =
  T extends z.ZodObject<infer Shape>
    ? Shape extends { event_result_type: z.ZodType<infer R> }
      ? R
      : unknown
    : unknown

/** Filter function type for event results */
export type EventResultFilter<T = unknown> = (result: {
  status: EventStatus
  result: T | null
  error: Error | null
}) => boolean

/** Event handler function type */
export type EventHandler<TEvent = unknown, TResult = unknown> = (
  event: TEvent
) => TResult | Promise<TResult>

/** Event pattern type - event type name, wildcard, or event class */
export type EventPattern = string | '*'

/**
 * Interface for EventBus to avoid circular imports.
 * BaseEvent uses this to type the eventBus property.
 */
export interface IEventBus {
  readonly id: string
  readonly name: string
  dispatch(event: unknown): unknown
}
