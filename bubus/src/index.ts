/**
 * Main entry point for the bubus event system
 */

export { BaseEvent, createEventClass } from './event.js';
export { EventBus } from './eventbus.js';
export { 
  serializeEvent,
  uuidv7,
  getCurrentParentId,
  runWithParent
} from './utils.js';

export type {
  EventMetadata,
  EventResult,
  EventStatus,
  EventHandler,
  EventBusOptions,
  SerializedEvent
} from './types.js';

// Re-export types for convenience
export type { BaseEvent as Event } from './event.js';