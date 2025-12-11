/**
 * Test for per-handler timeout enforcement.
 * Translated from Python tests/test_handler_timeout.py
 */

import { describe, it, expect } from 'vitest'
import { EventBus, BaseEvent, EventStatus } from '../src/index.js'

// =============================================================================
// Test Event Classes
// =============================================================================

class TopmostEvent extends BaseEvent<string> {
  declare url: string
  event_timeout: number | null = 5.0
}

class ChildEvent extends BaseEvent<string> {
  declare tab_id: string
  event_timeout: number | null = 2.0
}

class GrandchildEvent extends BaseEvent<string> {
  declare success: boolean
  event_timeout: number | null = 1.0
}

// =============================================================================
// Tests
// =============================================================================

describe('HandlerTimeout', () => {
  describe('basic timeout enforcement', () => {
    it('should timeout slow handlers', async () => {
      const bus = new EventBus({ name: 'TimeoutTestBus' })

      bus.on(TopmostEvent, async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return 'Should never return'
      })

      try {
        const event = new TopmostEvent({ url: 'https://example.com' })
        event.event_timeout = 0.1 // 100ms timeout

        const dispatchedEvent = bus.dispatch(event)

        await expect(dispatchedEvent.eventResult()).rejects.toThrow('timed out')
        await bus.waitUntilIdle()

        // Event should be completed (even if handler timed out)
        expect(dispatchedEvent.eventStatus).toBe(EventStatus.COMPLETED)
      } finally {
        await bus.stop({ clear: true })
      }
    })

    it('should allow fast handlers to complete', async () => {
      const bus = new EventBus({ name: 'FastHandlerBus' })

      bus.on(TopmostEvent, async () => {
        await new Promise((r) => setTimeout(r, 10))
        return 'Completed quickly'
      })

      try {
        const event = new TopmostEvent({ url: 'https://example.com' })
        event.event_timeout = 1.0 // 1s timeout

        const dispatchedEvent = bus.dispatch(event)
        const result = await dispatchedEvent.eventResult()

        expect(result).toBe('Completed quickly')
        expect(dispatchedEvent.eventStatus).toBe(EventStatus.COMPLETED)
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })

  describe('nested event timeout', () => {
    it('should handle nested events with their own timeouts', async () => {
      // Use parallel handlers so both handlers start simultaneously
      const bus = new EventBus({ name: 'NestedTimeoutBus', parallelHandlers: true })
      const executionLog: string[] = []

      // Fast handler that completes before timeout
      bus.on(TopmostEvent, async (event) => {
        executionLog.push('fast_handler_started')
        await new Promise((r) => setTimeout(r, 10))
        executionLog.push('fast_handler_completed')
        return 'fast'
      })

      // Slow handler that will timeout
      bus.on(TopmostEvent, async (event) => {
        executionLog.push('slow_handler_started')
        await new Promise((r) => setTimeout(r, 5000))
        executionLog.push('slow_handler_completed')
        return 'slow'
      })

      try {
        const event = new TopmostEvent({ url: 'https://example.com' })
        event.event_timeout = 0.2 // 200ms timeout

        const dispatchedEvent = bus.dispatch(event)

        // Wait for completion
        await bus.waitUntilIdle({ timeout: 2 })

        // Both handlers should have started
        expect(executionLog).toContain('fast_handler_started')
        expect(executionLog).toContain('slow_handler_started')

        // Fast handler should have completed
        expect(executionLog).toContain('fast_handler_completed')

        // Slow handler should NOT have completed (timed out)
        expect(executionLog).not.toContain('slow_handler_completed')

        // Check event results - should have both a success and a timeout error
        const results = Array.from(dispatchedEvent.event_results.values())
        const successResults = results.filter((r) => r.status === 'completed' && !r.error)
        const errorResults = results.filter((r) => r.error)

        expect(successResults.length).toBeGreaterThanOrEqual(1)
        expect(errorResults.length).toBeGreaterThanOrEqual(1)
        expect(errorResults.some((r) => r.error?.message.includes('timed out'))).toBe(true)
      } finally {
        await bus.stop({ clear: true, timeout: 0 })
      }
    })
  })

  describe('multiple handlers with timeout', () => {
    it('should allow successful handlers even when one times out', async () => {
      // Use parallel handlers so both handlers start simultaneously
      const bus = new EventBus({ name: 'MultiHandlerTimeoutBus', parallelHandlers: true })
      const results: string[] = []

      bus.on(TopmostEvent, async () => {
        await new Promise((r) => setTimeout(r, 10))
        results.push('fast_handler')
        return 'fast'
      })

      bus.on(TopmostEvent, async () => {
        await new Promise((r) => setTimeout(r, 5000))
        results.push('slow_handler')
        return 'slow'
      })

      try {
        const event = new TopmostEvent({ url: 'https://example.com' })
        event.event_timeout = 0.2 // 200ms timeout

        const dispatchedEvent = bus.dispatch(event)

        // Wait for completion
        await bus.waitUntilIdle({ timeout: 1 })

        // Fast handler should have completed
        expect(results).toContain('fast_handler')

        // Check that we have both results (one success, one timeout)
        const eventResults = Array.from(dispatchedEvent.event_results.values())
        const successResults = eventResults.filter((r) => r.status === 'completed' && !r.error)
        const errorResults = eventResults.filter((r) => r.error)

        expect(successResults.length).toBeGreaterThanOrEqual(1)
        expect(errorResults.length).toBeGreaterThanOrEqual(1)
      } finally {
        await bus.stop({ clear: true, timeout: 0 })
      }
    })
  })

  describe('timeout with no timeout set', () => {
    it('should not timeout when event_timeout is null', async () => {
      const bus = new EventBus({ name: 'NoTimeoutBus' })

      bus.on(TopmostEvent, async () => {
        await new Promise((r) => setTimeout(r, 100))
        return 'Completed without timeout'
      })

      try {
        const event = new TopmostEvent({ url: 'https://example.com' })
        event.event_timeout = null // No timeout

        // Use immediate() to properly wait for completion
        const completedEvent = await bus.immediate(event)
        const result = await completedEvent.eventResult()

        expect(result).toBe('Completed without timeout')
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })
})
