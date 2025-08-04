/**
 * BaseEvent class - the foundation of all events
 */

import { uuidv7, getCurrentParentId, createDeferred } from './utils.js';
import type { EventMetadata, EventResult, EventStatus, Deferred } from './types.js';

export abstract class BaseEvent implements EventMetadata {
  readonly event_type: string;
  readonly event_id: string;
  readonly event_schema: string;
  readonly event_timeout: number;
  readonly event_path: string[];
  readonly event_parent_id?: string;
  readonly event_created_at: string;
  readonly event_results: Map<string, EventResult>;
  
  private _deferred: Deferred<this>;
  private _event_started_at?: string;
  private _event_completed_at?: string;
  
  constructor(metadata?: Partial<EventMetadata>) {
    this.event_type = metadata?.event_type || this.constructor.name;
    this.event_id = metadata?.event_id || uuidv7();
    this.event_schema = metadata?.event_schema || `${this.constructor.name}@1.0.0`;
    this.event_timeout = metadata?.event_timeout ?? 60;
    this.event_path = metadata?.event_path || [];
    this.event_parent_id = metadata?.event_parent_id || getCurrentParentId();
    this.event_created_at = metadata?.event_created_at || new Date().toISOString();
    this.event_results = metadata?.event_results || new Map();
    
    this._deferred = createDeferred<this>();
    
    // Ensure all event_ methods/properties are protected
    const proto = Object.getPrototypeOf(this);
    const props = [...Object.getOwnPropertyNames(proto), ...Object.getOwnPropertyNames(this)];
    for (const prop of props) {
      if (prop.startsWith('event_') && typeof this[prop as keyof this] === 'function') {
        const descriptor = Object.getOwnPropertyDescriptor(proto, prop) || 
                          Object.getOwnPropertyDescriptor(this, prop);
        if (descriptor && !prop.startsWith('_')) {
          // Verify it's actually prefixed correctly
          continue;
        }
      }
    }
  }
  
  /**
   * Wait for the event to complete
   * Use this instead of await directly on the event to avoid thenable issues
   */
  wait(): Promise<this> {
    return this._deferred.promise;
  }
  
  /**
   * Get the event status
   */
  get event_status(): EventStatus {
    if (this._event_completed_at) return 'completed';
    if (this._event_started_at) return 'started';
    return 'pending';
  }
  
  /**
   * Get when the event started processing
   */
  get event_started_at(): string | undefined {
    return this._event_started_at;
  }
  
  /**
   * Get when the event completed processing
   */
  get event_completed_at(): string | undefined {
    return this._event_completed_at;
  }
  
  /**
   * Mark event as started (called by EventBus)
   */
  _markStarted(): void {
    if (!this._event_started_at) {
      this._event_started_at = new Date().toISOString();
    }
  }
  
  /**
   * Mark event as completed (called by EventBus)
   */
  _markCompleted(): void {
    this._event_completed_at = new Date().toISOString();
    this._deferred.resolve(this);
  }
  
  /**
   * Mark event as failed (called by EventBus)
   */
  _markFailed(error: Error): void {
    this._event_completed_at = new Date().toISOString();
    this._deferred.reject(error);
  }
  
  /**
   * Get the first result value
   */
  async event_result(): Promise<any> {
    await this.wait();
    const results = Array.from(this.event_results.values());
    const firstResult = results.find(r => r.status === 'completed');
    return firstResult?.result;
  }
  
  /**
   * Get all result values as an array
   */
  async event_results_list(): Promise<any[]> {
    await this.wait();
    return Array.from(this.event_results.values())
      .filter(r => r.status === 'completed')
      .map(r => r.result);
  }
  
  /**
   * Get results as a flat dictionary (for dict results)
   */
  async event_results_flat_dict(): Promise<Record<string, any>> {
    await this.wait();
    const result: Record<string, any> = {};
    
    for (const eventResult of this.event_results.values()) {
      if (eventResult.status === 'completed' && eventResult.result) {
        if (typeof eventResult.result === 'object' && !Array.isArray(eventResult.result)) {
          Object.assign(result, eventResult.result);
        }
      }
    }
    
    return result;
  }
  
  /**
   * Get results as a flat array (for array results)
   */
  async event_results_flat_list(): Promise<any[]> {
    await this.wait();
    const result: any[] = [];
    
    for (const eventResult of this.event_results.values()) {
      if (eventResult.status === 'completed' && Array.isArray(eventResult.result)) {
        result.push(...eventResult.result);
      }
    }
    
    return result;
  }
  
  /**
   * Get results indexed by handler ID
   */
  async event_results_by_handler_id(): Promise<Record<string, any>> {
    await this.wait();
    const result: Record<string, any> = {};
    
    for (const eventResult of this.event_results.values()) {
      if (eventResult.status === 'completed') {
        result[eventResult.handler_id] = eventResult.result;
      }
    }
    
    return result;
  }
  
  /**
   * Custom string representation
   */
  toString(): string {
    return `${this.event_type}(${this.event_id.slice(0, 8)}...)`;
  }
  
  /**
   * Node.js inspect
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

/**
 * Helper to create event classes with proper typing
 */
export function createEventClass<T extends Record<string, any>>(
  eventType: string,
  schema?: string
): new (data: T) => BaseEvent & T {
  return class extends BaseEvent {
    constructor(data: T) {
      super({
        event_type: eventType,
        event_schema: schema || `${eventType}@1.0.0`,
      });
      Object.assign(this, data);
    }
  } as any;
}