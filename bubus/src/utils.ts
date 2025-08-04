/**
 * Utility functions for the event system
 */

import { uuidv7 } from 'uuidv7';
import type { Deferred, EventResult, SerializedEvent } from './types.js';

export { uuidv7 };

/**
 * Creates a deferred promise
 */
export function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void;
  let reject: (reason?: any) => void;
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  
  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * Current parent event context using AsyncLocalStorage (Node.js)
 * Falls back to a simple global for environments without AsyncLocalStorage
 */
let currentParentId: string | undefined;

// Simple fallback implementation
const fallbackRunWithParent = <T>(parentId: string, fn: () => T): T => {
  const previous = currentParentId;
  currentParentId = parentId;
  try {
    return fn();
  } finally {
    currentParentId = previous;
  }
};

const fallbackGetCurrentParentId = (): string | undefined => {
  return currentParentId;
};

// Always use fallback for now to avoid AsyncLocalStorage issues
let runWithParentImpl = fallbackRunWithParent;
let getCurrentParentIdImpl = fallbackGetCurrentParentId;

export const runWithParent = runWithParentImpl;
export const getCurrentParentId = getCurrentParentIdImpl;

/**
 * Creates an EventResult object
 */
export function createEventResult(
  handlerId: string,
  handlerName: string,
  eventbusId: string,
  eventbusName: string,
  eventParentId: string,
  timeout?: number
): EventResult {
  return {
    id: uuidv7(),
    handler_id: handlerId,
    handler_name: handlerName,
    eventbus_id: eventbusId,
    eventbus_name: eventbusName,
    timeout,
    status: 'pending',
    started_at: new Date().toISOString(),
    event_parent_id: eventParentId,
  };
}

/**
 * Converts a Map to a plain object for serialization
 */
export function mapToObject<K extends string | number | symbol, V>(
  map: Map<K, V>
): Record<K, V> {
  const obj = {} as Record<K, V>;
  for (const [key, value] of map) {
    obj[key] = value;
  }
  return obj;
}

/**
 * Converts a plain object to a Map
 */
export function objectToMap<K extends string | number | symbol, V>(
  obj: Record<K, V>
): Map<K, V> {
  return new Map(Object.entries(obj) as Array<[K, V]>);
}

/**
 * Serializes an event to a JSON-compatible format
 */
export function serializeEvent(event: any): SerializedEvent {
  const serialized: SerializedEvent = {
    event_type: event.event_type,
    event_id: event.event_id,
    event_schema: event.event_schema,
    event_timeout: event.event_timeout,
    event_path: [...event.event_path],
    event_parent_id: event.event_parent_id,
    event_created_at: event.event_created_at,
    event_results: mapToObject(event.event_results),
  };
  
  // Copy all other properties
  for (const key in event) {
    if (!key.startsWith('event_') && !key.startsWith('_')) {
      serialized[key] = event[key];
    }
  }
  
  return serialized;
}

/**
 * Run a function with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}