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
      const bus = new EventBus({ name: 'NestedTimeoutBus' })
      const executionLog: string[] = []

      class HandlerClass1 {
        async onTopmostEvent(event: TopmostEvent): Promise<string> {
          executionLog.push('HandlerClass1.onTopmostEvent started')
          await new Promise((r) => setTimeout(r, 100))
          executionLog.push('HandlerClass1.onTopmostEvent completed')
          return 'HandlerClass1.onTopmostEvent completed after 0.1s'
        }

        async onGrandchildEvent(event: GrandchildEvent): Promise<string> {
          executionLog.push('HandlerClass1.onGrandchildEvent started')
          // This would take too long and timeout
          await new Promise((r) => setTimeout(r, 5000))
          return 'HandlerClass1.onGrandchildEvent completed'
        }
      }

      class HandlerClass2 {
        async onGrandchildEvent(event: GrandchildEvent): Promise<string> {
          executionLog.push('HandlerClass2.onGrandchildEvent started')
          executionLog.push('HandlerClass2.onGrandchildEvent completed')
          return 'HandlerClass2.onGrandchildEvent completed immediately'
        }
      }

      class MainClass0 {
        constructor(private bus: EventBus) {}

        async onTopmostEvent(event: TopmostEvent): Promise<string> {
          executionLog.push('MainClass0.onTopmostEvent started')
          await new Promise((r) => setTimeout(r, 100))

          const childEvent = this.bus.dispatch(new ChildEvent({ tab_id: 'tab-123' }))
          try {
            await childEvent
          } catch (e) {
            executionLog.push(`MainClass0 caught error: ${e}`)
            throw e
          }

          return 'MainClass0.onTopmostEvent completed'
        }

        async onChildEvent(event: ChildEvent): Promise<string> {
          executionLog.push('MainClass0.onChildEvent started')
          const grandchildEvent = this.bus.dispatch(
            new GrandchildEvent({ success: true })
          )
          await grandchildEvent
          return 'MainClass0.onChildEvent completed'
        }

        async onGrandchildEvent(event: GrandchildEvent): Promise<string> {
          executionLog.push('MainClass0.onGrandchildEvent started')
          await new Promise((r) => setTimeout(r, 200))
          executionLog.push('MainClass0.onGrandchildEvent completed')
          return 'MainClass0.onGrandchildEvent completed after 0.2s'
        }
      }

      const handlerClass1 = new HandlerClass1()
      const handlerClass2 = new HandlerClass2()
      const mainClass0 = new MainClass0(bus)

      // Register handlers for TopmostEvent
      bus.on('TopmostEvent', handlerClass1.onTopmostEvent.bind(handlerClass1))
      bus.on('TopmostEvent', mainClass0.onTopmostEvent.bind(mainClass0))

      // Register handlers for ChildEvent
      bus.on('ChildEvent', mainClass0.onChildEvent.bind(mainClass0))

      // Register handlers for GrandchildEvent
      bus.on('GrandchildEvent', mainClass0.onGrandchildEvent.bind(mainClass0))
      bus.on('GrandchildEvent', handlerClass2.onGrandchildEvent.bind(handlerClass2))
      bus.on('GrandchildEvent', handlerClass1.onGrandchildEvent.bind(handlerClass1))

      try {
        const navigateEvent = bus.dispatch(new TopmostEvent({ url: 'https://example.com' }))

        // Wait for event to complete (with timeout error)
        await expect(navigateEvent.eventResult()).rejects.toThrow()
        await bus.waitUntilIdle({ timeout: 10 })

        // Verify some handlers executed
        expect(executionLog).toContain('HandlerClass1.onTopmostEvent started')
        expect(executionLog).toContain('MainClass0.onTopmostEvent started')
      } finally {
        await bus.stop({ clear: true, timeout: 0 })
      }
    })
  })

  describe('multiple handlers with timeout', () => {
    it('should allow successful handlers even when one times out', async () => {
      const bus = new EventBus({ name: 'MultiHandlerTimeoutBus' })
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
