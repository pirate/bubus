/**
 * Utility functions for bubus
 */

import { v7 as uuidv7 } from 'uuid'

/**
 * Generate a UUIDv7 string (time-ordered UUID)
 */
export function generateUUID7(): string {
  return uuidv7()
}

/**
 * Check if a string is a valid Python identifier
 * (can be used as event names, bus names, etc.)
 */
export function isValidPythonIdentifier(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && !s.startsWith('_')
}

/**
 * Get current ISO 8601 datetime string
 */
export function nowISO(): string {
  return new Date().toISOString()
}

/**
 * Create a deferred promise that can be resolved/rejected externally
 */
export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

/**
 * Wait for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get handler name from a function
 */
export function getHandlerName(handler: Function): string {
  return handler.name || 'anonymous'
}

/**
 * Generate a unique handler ID based on bus and handler
 */
export function getHandlerId(handler: Function, eventbusId: string): string {
  // Use a combination of eventbus ID and a unique identifier for the handler
  const handlerStr = handler.toString().slice(0, 100)
  const hash = simpleHash(handlerStr + eventbusId)
  return `${eventbusId}.${hash}`
}

/**
 * Simple string hash function
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16)
}
