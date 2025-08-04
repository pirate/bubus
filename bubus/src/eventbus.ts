/**
 * EventBus - the main event dispatcher and handler
 */

import { BaseEvent } from './event.js';
import { 
  uuidv7, 
  createEventResult, 
  runWithParent, 
  withTimeout,
  createDeferred
} from './utils.js';
import type { 
  EventHandler, 
  EventBusOptions, 
  EventResult,
  Deferred
} from './types.js';

interface HandlerRegistration {
  id: string;
  name: string;
  handler: EventHandler;
  pattern: string | RegExp;
}

interface QueuedEvent {
  event: BaseEvent;
  addedAt: number;
}

export class EventBus {
  readonly name: string;
  readonly parallel_handlers: boolean;
  readonly event_timeout: number;
  
  private handlers: Map<string, HandlerRegistration[]> = new Map();
  private wildcardHandlers: HandlerRegistration[] = [];
  private queue: QueuedEvent[] = [];
  private processing = false;
  private running = true;
  private idleDeferred?: Deferred<void>;
  private stopDeferred?: Deferred<void>;
  
  // Event history for expect() functionality
  private eventHistory: BaseEvent[] = [];
  private maxHistorySize = 1000;
  
  constructor(name: string, options: EventBusOptions = {}) {
    this.name = name;
    this.parallel_handlers = options.parallel_handlers ?? false;
    this.event_timeout = options.event_timeout ?? 60;
  }
  
  /**
   * Register an event handler
   */
  on<T extends BaseEvent>(
    eventType: string | (new (...args: any[]) => T) | RegExp,
    handler: EventHandler<T>
  ): void {
    const handlerReg: HandlerRegistration = {
      id: handler.name || uuidv7(),
      name: handler.name || 'anonymous',
      handler: handler as EventHandler,
      pattern: typeof eventType === 'function' 
        ? eventType.prototype.event_type || eventType.name
        : eventType,
    };
    
    if (typeof handlerReg.pattern === 'string') {
      if (handlerReg.pattern === '*') {
        this.wildcardHandlers.push(handlerReg);
      } else {
        if (!this.handlers.has(handlerReg.pattern)) {
          this.handlers.set(handlerReg.pattern, []);
        }
        this.handlers.get(handlerReg.pattern)!.push(handlerReg);
      }
    } else if (handlerReg.pattern instanceof RegExp) {
      this.wildcardHandlers.push(handlerReg);
    }
    
    // Check for duplicate handler names
    const allHandlers = [
      ...Array.from(this.handlers.values()).flat(),
      ...this.wildcardHandlers,
    ];
    const names = allHandlers.map(h => h.name).filter(n => n !== 'anonymous');
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    if (duplicates.length > 0) {
      console.warn(`Duplicate handler names detected: ${duplicates.join(', ')}`);
    }
  }
  
  /**
   * Dispatch an event
   */
  async dispatch<T extends BaseEvent>(event: T): Promise<T> {
    if (!this.running) {
      throw new Error(`EventBus ${this.name} is stopped`);
    }
    
    // Check for loops
    if (event.event_path.includes(this.name)) {
      console.warn(`Event ${event.event_type} already processed by ${this.name}, skipping`);
      return event;
    }
    
    // Add to path
    event.event_path.push(this.name);
    
    // Queue the event
    this.queue.push({ event, addedAt: Date.now() });
    
    // Start processing if not already running
    if (!this.processing) {
      this.processing = true;
      queueMicrotask(() => this.processQueue());
    }
    
    return event;
  }
  
  /**
   * Process queued events
   */
  private async processQueue(): Promise<void> {
    while (this.running && this.queue.length > 0) {
      const queued = this.queue.shift()!;
      
      try {
        await this.processEvent(queued.event);
        
        // Add to history
        this.eventHistory.push(queued.event);
        if (this.eventHistory.length > this.maxHistorySize) {
          this.eventHistory.shift();
        }
      } catch (error) {
        console.error(`Error processing event ${queued.event.event_type}:`, error);
        queued.event._markFailed(error as Error);
      }
    }
    
    this.processing = false;
    
    // Check if we're idle
    if (this.queue.length === 0 && this.idleDeferred) {
      this.idleDeferred.resolve();
      this.idleDeferred = undefined;
    }
    
    // Check if we're stopping
    if (!this.running && this.queue.length === 0 && this.stopDeferred) {
      this.stopDeferred.resolve();
      this.stopDeferred = undefined;
    }
  }
  
  /**
   * Process a single event
   */
  private async processEvent(event: BaseEvent): Promise<void> {
    event._markStarted();
    
    // Find matching handlers
    const handlers: HandlerRegistration[] = [
      ...(this.handlers.get(event.event_type) || []),
      ...this.wildcardHandlers.filter(h => {
        if (typeof h.pattern === 'string') return h.pattern === '*';
        if (h.pattern instanceof RegExp) return h.pattern.test(event.event_type);
        return false;
      }),
    ];
    
    if (handlers.length === 0) {
      event._markCompleted();
      return;
    }
    
    // Execute handlers
    if (this.parallel_handlers) {
      // Run all handlers in parallel
      const promises = handlers.map(h => this.executeHandler(h, event));
      await Promise.allSettled(promises);
    } else {
      // Run handlers sequentially
      for (const handler of handlers) {
        try {
          await this.executeHandler(handler, event);
        } catch (error) {
          // Error already recorded in event results
          console.error(`Handler ${handler.name} failed:`, error);
        }
      }
    }
    
    event._markCompleted();
  }
  
  /**
   * Execute a single handler
   */
  private async executeHandler(
    registration: HandlerRegistration,
    event: BaseEvent
  ): Promise<void> {
    const eventResult = createEventResult(
      registration.id,
      registration.name,
      this.name,
      this.name,
      event.event_id,
      this.event_timeout
    );
    
    event.event_results.set(eventResult.id, eventResult);
    eventResult.status = 'started';
    eventResult.started_at = new Date().toISOString();
    
    try {
      // Run handler with parent context
      const handlerPromise = runWithParent(event.event_id, () => 
        Promise.resolve(registration.handler(event))
      );
      
      // Add timeout
      const timeout = eventResult.timeout || event.event_timeout || this.event_timeout;
      const result = await withTimeout(
        handlerPromise,
        timeout * 1000,
        `Handler ${registration.name} timed out after ${timeout}s`
      );
      
      eventResult.result = result;
      eventResult.status = 'completed';
    } catch (error) {
      eventResult.error = (error as Error).message;
      eventResult.status = 'error';
      throw error;
    } finally {
      eventResult.completed_at = new Date().toISOString();
    }
  }
  
  /**
   * Stop the event bus
   */
  async stop(timeout?: number): Promise<void> {
    this.running = false;
    
    if (this.queue.length === 0) {
      return;
    }
    
    this.stopDeferred = createDeferred<void>();
    
    if (timeout) {
      try {
        await withTimeout(
          this.stopDeferred.promise,
          timeout * 1000,
          `EventBus ${this.name} stop timed out`
        );
      } catch {
        // Force clear the queue
        this.queue = [];
        if (this.stopDeferred) {
          this.stopDeferred.resolve();
        }
      }
    } else {
      await this.stopDeferred.promise;
    }
  }
  
  /**
   * Wait until the event bus is idle
   */
  async wait_until_idle(): Promise<void> {
    if (this.queue.length === 0 && !this.processing) {
      return;
    }
    
    this.idleDeferred = createDeferred<void>();
    await this.idleDeferred.promise;
  }
  
  /**
   * Wait for a specific event
   */
  async expect<T extends BaseEvent>(
    predicate: (event: BaseEvent) => event is T,
    timeout?: number
  ): Promise<T> {
    // Check history first
    for (let i = this.eventHistory.length - 1; i >= 0; i--) {
      if (predicate(this.eventHistory[i]!)) {
        return this.eventHistory[i] as T;
      }
    }
    
    // Wait for future event
    const deferred = createDeferred<T>();
    
    const handler: EventHandler = (event) => {
      if (predicate(event)) {
        deferred.resolve(event as T);
      }
    };
    
    // Register temporary wildcard handler
    this.on('*', handler);
    
    try {
      if (timeout) {
        return await withTimeout(
          deferred.promise,
          timeout * 1000,
          'expect() timed out'
        );
      } else {
        return await deferred.promise;
      }
    } finally {
      // Remove the handler
      const index = this.wildcardHandlers.findIndex(h => h.handler === handler);
      if (index !== -1) {
        this.wildcardHandlers.splice(index, 1);
      }
    }
  }
  
  /**
   * Forward events to another bus
   */
  forward_to(other: EventBus, pattern?: string | RegExp): void {
    const handler: EventHandler = async (event) => {
      // Avoid infinite loops
      if (!event.event_path.includes(other.name)) {
        await other.dispatch(event);
      }
    };
    
    if (pattern) {
      this.on(pattern as any, handler);
    } else {
      this.on('*', handler);
    }
  }
  
  /**
   * Get event history
   */
  get event_history(): ReadonlyArray<BaseEvent> {
    return [...this.eventHistory];
  }
  
  /**
   * Clear event history
   */
  clear_history(): void {
    this.eventHistory = [];
  }
}