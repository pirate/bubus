/**
 * Core types for the bubus event system
 */

export interface EventMetadata {
  event_type: string;
  event_id: string;
  event_schema: string;
  event_timeout: number;
  event_path: string[];
  event_parent_id?: string;
  event_created_at: string;
  event_results: Map<string, EventResult>;
}

export interface EventResult {
  id: string;
  handler_id: string;
  handler_name: string;
  eventbus_id: string;
  eventbus_name: string;
  timeout?: number;
  status: 'pending' | 'started' | 'completed' | 'error';
  result?: any;
  error?: string;
  started_at: string;
  completed_at?: string;
  event_parent_id: string;
}

export type EventStatus = 'pending' | 'started' | 'completed';

export type EventHandler<T = any> = (event: T) => any | Promise<any>;

export interface EventBusOptions {
  parallel_handlers?: boolean;
  event_timeout?: number;
}

export interface SerializedEvent {
  event_type: string;
  event_id: string;
  event_schema: string;
  event_timeout: number;
  event_path: string[];
  event_parent_id?: string;
  event_created_at: string;
  event_results: Record<string, Omit<EventResult, 'id'> & { id: string }>;
  [key: string]: any;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}