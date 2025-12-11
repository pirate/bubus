/**
 * Test comprehensive event patterns including forwarding, async/sync dispatch,
 * queue jumping, and parent-child tracking.
 * Translated from Python tests/test_comprehensive_patterns.py
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus, BaseEvent, EventStatus } from '../src/index.js'

// =============================================================================
// Test Event Classes
// =============================================================================

class ParentEvent extends BaseEvent<string> {}
class ChildEvent extends BaseEvent<string> {}
class ImmediateChildEvent extends BaseEvent<string> {}
class QueuedChildEvent extends BaseEvent<string> {}

// =============================================================================
// Tests
// =============================================================================

describe('ComprehensivePatterns', () => {
  describe('comprehensive patterns', () => {
    it('should handle forwarding, sync dispatch, and parent-child tracking', async () => {
      const bus1 = new EventBus({ name: 'bus1' })
      const bus2 = new EventBus({ name: 'bus2' })

      const results: Array<[number, string]> = []
      let executionCount = 0

      const childBus2EventHandler = (event: BaseEvent): string => {
        executionCount++
        const seq = executionCount
        const eventTypeShort = event.constructor.name.replace('Event', '')
        results.push([seq, `bus2_handler_${eventTypeShort}`])
        return 'forwarded bus result'
      }

      bus2.on('*', childBus2EventHandler)
      bus1.on('*', bus2.dispatch.bind(bus2))

      const parentBus1Handler = async (event: ParentEvent): Promise<string> => {
        executionCount++
        const seq = executionCount
        results.push([seq, 'parent_start'])

        // Pattern 1: Async dispatch - handlers run after parent completes
        const childEventAsync = bus1.dispatch(new QueuedChildEvent())
        expect(childEventAsync.eventStatus).not.toBe(EventStatus.COMPLETED)

        // Pattern 2: Sync dispatch with immediate - handlers run immediately (queue jumping)
        const childEventSync = await bus1.immediate(new ImmediateChildEvent())
        expect(childEventSync.eventStatus).toBe(EventStatus.COMPLETED)

        // Check parent-child relationships
        expect(childEventAsync.event_parent_id).toBe(event.event_id)
        expect(childEventSync.event_parent_id).toBe(event.event_id)

        executionCount++
        results.push([executionCount, 'parent_end'])
        return 'parent_done'
      }

      bus1.on(ParentEvent, parentBus1Handler)

      try {
        const parentEvent = await bus1.immediate(new ParentEvent())

        await bus1.waitUntilIdle()
        await bus2.waitUntilIdle()

        // Verify all child events have correct parent
        const allEvents = Array.from(bus1.eventHistory.values())
        const childEvents = allEvents.filter(
          (e) =>
            e instanceof ImmediateChildEvent || e instanceof QueuedChildEvent
        )
        expect(
          childEvents.every(
            (event) => event.event_parent_id === parentEvent.event_id
          )
        ).toBe(true)

        // Sort results by sequence number
        const sortedResults = [...results].sort((a, b) => a[0] - b[0])
        const executionOrder = sortedResults.map((item) => item[1])

        // Parent handler starts first
        expect(executionOrder[0]).toBe('parent_start')

        // ImmediateChild is processed immediately
        expect(executionOrder.some((e) => e.includes('ImmediateChild'))).toBe(
          true
        )

        // All event types should be processed
        expect(
          executionOrder.filter((e) => e.includes('ImmediateChild')).length
        ).toBe(1)
        expect(
          executionOrder.filter((e) => e.includes('QueuedChild')).length
        ).toBe(1)
        expect(executionOrder.filter((e) => e.includes('Parent')).length).toBe(
          1
        )
      } finally {
        await bus1.stop({ clear: true })
        await bus2.stop({ clear: true })
      }
    })
  })

  describe('race condition stress', () => {
    it('should handle concurrent dispatches without race conditions', async () => {
      const bus1 = new EventBus({ name: 'bus1' })
      const bus2 = new EventBus({ name: 'bus2' })

      const results: string[] = []

      const childHandler = async (event: BaseEvent): Promise<string> => {
        const busName = event.event_path[event.event_path.length - 1] || 'unknown'
        results.push(`child_${busName}`)
        await new Promise((r) => setTimeout(r, 1))
        return `child_done_${busName}`
      }

      const parentHandler = async (event: BaseEvent): Promise<string> => {
        const children: BaseEvent[] = []

        // Async dispatches
        for (let i = 0; i < 3; i++) {
          children.push(bus1.dispatch(new QueuedChildEvent()))
        }

        // Sync dispatches (queue jumping with immediate)
        for (let i = 0; i < 3; i++) {
          const child = await bus1.immediate(new ImmediateChildEvent())
          expect(child.eventStatus).toBe(EventStatus.COMPLETED)
          children.push(child)
        }

        // Verify all have correct parent
        expect(
          children.every((c) => c.event_parent_id === event.event_id)
        ).toBe(true)
        return 'parent_done'
      }

      bus1.on('*', bus2.dispatch.bind(bus2))
      bus1.on(QueuedChildEvent, childHandler)
      bus1.on(ImmediateChildEvent, childHandler)
      bus2.on(QueuedChildEvent, childHandler)
      bus2.on(ImmediateChildEvent, childHandler)
      bus1.on(BaseEvent, parentHandler)

      try {
        // Run multiple times to check for race conditions
        for (let run = 0; run < 5; run++) {
          results.length = 0

          await bus1.immediate(new BaseEvent())
          await bus1.waitUntilIdle()
          await bus2.waitUntilIdle()

          // Should have 6 child events processed on each bus
          expect(results.filter((r) => r === 'child_bus1').length).toBe(6)
          expect(results.filter((r) => r === 'child_bus2').length).toBe(6)
        }
      } finally {
        await bus1.stop({ clear: true })
        await bus2.stop({ clear: true })
      }
    })
  })

  describe('awaited child jumps queue', () => {
    it('should process awaited child immediately without processing other queued events', async () => {
      const bus = new EventBus({ name: 'TestBus', maxHistorySize: 100 })
      const executionOrder: string[] = []

      class Event1 extends BaseEvent<string> {}
      class Event2 extends BaseEvent<string> {}
      class Event3 extends BaseEvent<string> {}
      class ChildEventLocal extends BaseEvent<string> {}

      bus.on(Event1, async () => {
        executionOrder.push('Event1_start')
        const child = bus.dispatch(new ChildEventLocal())
        executionOrder.push('Child_dispatched')
        await bus.immediate(child)
        executionOrder.push('Child_await_returned')
        executionOrder.push('Event1_end')
        return 'event1_done'
      })

      bus.on(Event2, async () => {
        executionOrder.push('Event2_start')
        executionOrder.push('Event2_end')
        return 'event2_done'
      })

      bus.on(Event3, async () => {
        executionOrder.push('Event3_start')
        executionOrder.push('Event3_end')
        return 'event3_done'
      })

      bus.on(ChildEventLocal, async () => {
        executionOrder.push('Child_start')
        executionOrder.push('Child_end')
        return 'child_done'
      })

      try {
        // Dispatch all three events
        const event1 = bus.dispatch(new Event1())
        const event2 = bus.dispatch(new Event2())
        const event3 = bus.dispatch(new Event3())

        // Await Event1 - child should jump queue
        await bus.immediate(event1)

        // Child should have executed during Event1's handler
        expect(executionOrder).toContain('Child_start')
        expect(executionOrder).toContain('Child_end')

        const childStartIdx = executionOrder.indexOf('Child_start')
        const childEndIdx = executionOrder.indexOf('Child_end')
        const event1EndIdx = executionOrder.indexOf('Event1_end')

        expect(childStartIdx).toBeLessThan(event1EndIdx)
        expect(childEndIdx).toBeLessThan(event1EndIdx)

        // Event2 and Event3 should NOT have executed yet
        expect(executionOrder).not.toContain('Event2_start')
        expect(executionOrder).not.toContain('Event3_start')

        // Event2 and Event3 should still be pending
        expect(event2.eventStatus).toBe(EventStatus.PENDING)
        expect(event3.eventStatus).toBe(EventStatus.PENDING)

        // Let remaining events process
        await bus.waitUntilIdle()

        // FIFO order maintained - Event2 before Event3
        const event2StartIdx = executionOrder.indexOf('Event2_start')
        const event3StartIdx = executionOrder.indexOf('Event3_start')
        expect(event2StartIdx).toBeLessThan(event3StartIdx)

        // Verify all completed
        expect(event2.eventStatus).toBe(EventStatus.COMPLETED)
        expect(event3.eventStatus).toBe(EventStatus.COMPLETED)
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })

  describe('dispatch multiple await one', () => {
    it('should jump queue for awaited child while others stay in place', async () => {
      const bus = new EventBus({ name: 'MultiDispatchBus', maxHistorySize: 100 })
      const executionOrder: string[] = []

      class Event1 extends BaseEvent<string> {}
      class Event2 extends BaseEvent<string> {}
      class Event3 extends BaseEvent<string> {}
      class ChildA extends BaseEvent<string> {}
      class ChildB extends BaseEvent<string> {}
      class ChildC extends BaseEvent<string> {}

      bus.on(Event1, async () => {
        executionOrder.push('Event1_start')

        // Dispatch three children but only await the middle one
        bus.dispatch(new ChildA())
        executionOrder.push('ChildA_dispatched')

        const childB = bus.dispatch(new ChildB())
        executionOrder.push('ChildB_dispatched')

        bus.dispatch(new ChildC())
        executionOrder.push('ChildC_dispatched')

        // Only await ChildB (queue jumping)
        await bus.immediate(childB)
        executionOrder.push('ChildB_await_returned')

        executionOrder.push('Event1_end')
        return 'event1_done'
      })

      bus.on(Event2, async () => {
        executionOrder.push('Event2_start')
        executionOrder.push('Event2_end')
        return 'event2_done'
      })

      bus.on(Event3, async () => {
        executionOrder.push('Event3_start')
        executionOrder.push('Event3_end')
        return 'event3_done'
      })

      bus.on(ChildA, async () => {
        executionOrder.push('ChildA_start')
        executionOrder.push('ChildA_end')
        return 'child_a_done'
      })

      bus.on(ChildB, async () => {
        executionOrder.push('ChildB_start')
        executionOrder.push('ChildB_end')
        return 'child_b_done'
      })

      bus.on(ChildC, async () => {
        executionOrder.push('ChildC_start')
        executionOrder.push('ChildC_end')
        return 'child_c_done'
      })

      try {
        // Dispatch E1, E2, E3
        const event1 = bus.dispatch(new Event1())
        bus.dispatch(new Event2())
        bus.dispatch(new Event3())

        await bus.immediate(event1)

        // ChildB should have executed (it was awaited)
        expect(executionOrder).toContain('ChildB_start')
        expect(executionOrder).toContain('ChildB_end')

        // ChildB should have executed before Event1 ended
        const childBEndIdx = executionOrder.indexOf('ChildB_end')
        const event1EndIdx = executionOrder.indexOf('Event1_end')
        expect(childBEndIdx).toBeLessThan(event1EndIdx)

        // ChildA and ChildC should NOT have executed BEFORE Event1 ended
        if (executionOrder.includes('ChildA_start')) {
          const childAStartIdx = executionOrder.indexOf('ChildA_start')
          expect(childAStartIdx).toBeGreaterThan(event1EndIdx)
        }

        if (executionOrder.includes('ChildC_start')) {
          const childCStartIdx = executionOrder.indexOf('ChildC_start')
          expect(childCStartIdx).toBeGreaterThan(event1EndIdx)
        }

        // Now process remaining events
        await bus.waitUntilIdle()

        // Verify FIFO order for remaining: E2, E3, ChildA, ChildC
        const event2StartIdx = executionOrder.indexOf('Event2_start')
        const event3StartIdx = executionOrder.indexOf('Event3_start')
        const childAStartIdx = executionOrder.indexOf('ChildA_start')
        const childCStartIdx = executionOrder.indexOf('ChildC_start')

        expect(event2StartIdx).toBeLessThan(event3StartIdx)
        expect(event3StartIdx).toBeLessThan(childAStartIdx)
        expect(childAStartIdx).toBeLessThan(childCStartIdx)
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })

  describe('multi-bus with queued events', () => {
    it('should handle queue jumping across buses independently', async () => {
      const bus1 = new EventBus({ name: 'Bus1', maxHistorySize: 100 })
      const bus2 = new EventBus({ name: 'Bus2', maxHistorySize: 100 })
      const executionOrder: string[] = []

      class Event1 extends BaseEvent<string> {}
      class Event2 extends BaseEvent<string> {}
      class Event3 extends BaseEvent<string> {}
      class Event4 extends BaseEvent<string> {}
      class ChildEventLocal extends BaseEvent<string> {}

      bus1.on(Event1, async () => {
        executionOrder.push('Bus1_Event1_start')
        const child = bus1.dispatch(new ChildEventLocal())
        executionOrder.push('Child_dispatched_to_Bus1')
        await bus1.immediate(child)
        executionOrder.push('Child_await_returned')
        executionOrder.push('Bus1_Event1_end')
        return 'event1_done'
      })

      bus1.on(Event2, async () => {
        executionOrder.push('Bus1_Event2_start')
        executionOrder.push('Bus1_Event2_end')
        return 'event2_done'
      })

      bus2.on(Event3, async () => {
        executionOrder.push('Bus2_Event3_start')
        executionOrder.push('Bus2_Event3_end')
        return 'event3_done'
      })

      bus2.on(Event4, async () => {
        executionOrder.push('Bus2_Event4_start')
        executionOrder.push('Bus2_Event4_end')
        return 'event4_done'
      })

      bus1.on(ChildEventLocal, async () => {
        executionOrder.push('Child_start')
        executionOrder.push('Child_end')
        return 'child_done'
      })

      try {
        // Queue events on both buses
        const event1 = bus1.dispatch(new Event1())
        bus1.dispatch(new Event2())
        bus2.dispatch(new Event3())
        bus2.dispatch(new Event4())

        // Await E1 - child should jump Bus1's queue
        await bus1.immediate(event1)

        // Child should have executed
        expect(executionOrder).toContain('Child_start')
        expect(executionOrder).toContain('Child_end')

        const childEndIdx = executionOrder.indexOf('Child_end')
        const event1EndIdx = executionOrder.indexOf('Bus1_Event1_end')
        expect(childEndIdx).toBeLessThan(event1EndIdx)

        // E2 on Bus1 should NOT have executed yet
        expect(executionOrder).not.toContain('Bus1_Event2_start')

        // E3 and E4 on Bus2 should NOT have executed yet
        expect(executionOrder).not.toContain('Bus2_Event3_start')
        expect(executionOrder).not.toContain('Bus2_Event4_start')

        // Process remaining
        await bus1.waitUntilIdle()
        await bus2.waitUntilIdle()

        // Verify all eventually executed
        expect(executionOrder).toContain('Bus1_Event2_start')
        expect(executionOrder).toContain('Bus2_Event3_start')
        expect(executionOrder).toContain('Bus2_Event4_start')
      } finally {
        await bus1.stop({ clear: true })
        await bus2.stop({ clear: true })
      }
    })
  })

  describe('await already completed event', () => {
    it('should handle awaiting already completed event as no-op', async () => {
      const bus = new EventBus({
        name: 'AlreadyCompletedBus',
        maxHistorySize: 100,
      })
      const executionOrder: string[] = []

      class Event1 extends BaseEvent<string> {}
      class Event2 extends BaseEvent<string> {}

      bus.on(Event1, async () => {
        executionOrder.push('Event1_start')
        executionOrder.push('Event1_end')
        return 'event1_done'
      })

      bus.on(Event2, async () => {
        executionOrder.push('Event2_start')
        executionOrder.push('Event2_end')
        return 'event2_done'
      })

      try {
        // Dispatch and await E1 first
        const event1 = await bus.immediate(new Event1())
        expect(event1.eventStatus).toBe(EventStatus.COMPLETED)

        // Now dispatch E2
        const event2 = bus.dispatch(new Event2())

        // Await E1 again - should be a no-op (already completed)
        await event1.completed

        // E2 should NOT have executed yet (second await doesn't trigger processing)
        expect(event2.eventStatus).toBe(EventStatus.PENDING)

        // Complete E2
        await bus.waitUntilIdle()
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })

  describe('multiple awaits same event', () => {
    it('should handle multiple concurrent awaits on same event', async () => {
      const bus = new EventBus({ name: 'MultiAwaitBus', maxHistorySize: 100 })
      const executionOrder: string[] = []
      const awaitResults: string[] = []

      class Event1 extends BaseEvent<string> {}
      class Event2 extends BaseEvent<string> {}
      class ChildEventLocal extends BaseEvent<string> {}

      bus.on(Event1, async () => {
        executionOrder.push('Event1_start')

        const child = bus.dispatch(new ChildEventLocal())

        // Process child immediately (queue jumping)
        await bus.immediate(child)

        // Create multiple concurrent awaits on the same child (already completed)
        const awaitChild = async (name: string) => {
          await child.completed
          awaitResults.push(`${name}_completed`)
        }

        // Start two concurrent awaits (both should resolve immediately)
        await Promise.all([awaitChild('await1'), awaitChild('await2')])
        executionOrder.push('Both_awaits_completed')

        executionOrder.push('Event1_end')
        return 'event1_done'
      })

      bus.on(Event2, async () => {
        executionOrder.push('Event2_start')
        executionOrder.push('Event2_end')
        return 'event2_done'
      })

      bus.on(ChildEventLocal, async () => {
        executionOrder.push('Child_start')
        await new Promise((r) => setTimeout(r, 10))
        executionOrder.push('Child_end')
        return 'child_done'
      })

      try {
        const event1 = bus.dispatch(new Event1())
        bus.dispatch(new Event2())

        await bus.immediate(event1)

        // Both awaits should have completed
        expect(awaitResults).toHaveLength(2)
        expect(awaitResults).toContain('await1_completed')
        expect(awaitResults).toContain('await2_completed')

        // Child should have executed before Event1 ended
        expect(executionOrder).toContain('Child_start')
        expect(executionOrder).toContain('Child_end')

        const childEndIdx = executionOrder.indexOf('Child_end')
        const event1EndIdx = executionOrder.indexOf('Event1_end')
        expect(childEndIdx).toBeLessThan(event1EndIdx)

        // E2 should NOT have executed yet
        expect(executionOrder).not.toContain('Event2_start')

        await bus.waitUntilIdle()
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })

  describe('deeply nested awaited children', () => {
    it('should handle deeply nested awaits correctly', async () => {
      const bus = new EventBus({ name: 'DeepNestedBus', maxHistorySize: 100 })
      const executionOrder: string[] = []

      class Event1 extends BaseEvent<string> {}
      class Event2 extends BaseEvent<string> {}
      class Child1 extends BaseEvent<string> {}
      class Child2 extends BaseEvent<string> {}

      bus.on(Event1, async () => {
        executionOrder.push('Event1_start')
        const child1 = bus.dispatch(new Child1())
        await bus.immediate(child1)
        executionOrder.push('Event1_end')
        return 'event1_done'
      })

      bus.on(Child1, async () => {
        executionOrder.push('Child1_start')
        const child2 = bus.dispatch(new Child2())
        await bus.immediate(child2)
        executionOrder.push('Child1_end')
        return 'child1_done'
      })

      bus.on(Child2, async () => {
        executionOrder.push('Child2_start')
        executionOrder.push('Child2_end')
        return 'child2_done'
      })

      bus.on(Event2, async () => {
        executionOrder.push('Event2_start')
        executionOrder.push('Event2_end')
        return 'event2_done'
      })

      try {
        const event1 = bus.dispatch(new Event1())
        bus.dispatch(new Event2())

        await bus.immediate(event1)

        // All nested children should have completed
        expect(executionOrder).toContain('Child1_start')
        expect(executionOrder).toContain('Child1_end')
        expect(executionOrder).toContain('Child2_start')
        expect(executionOrder).toContain('Child2_end')

        // Verify nesting order: Child2 completes before Child1
        const child2EndIdx = executionOrder.indexOf('Child2_end')
        const child1EndIdx = executionOrder.indexOf('Child1_end')
        const event1EndIdx = executionOrder.indexOf('Event1_end')

        expect(child2EndIdx).toBeLessThan(child1EndIdx)
        expect(child1EndIdx).toBeLessThan(event1EndIdx)

        // E2 should NOT have started
        expect(executionOrder).not.toContain('Event2_start')

        await bus.waitUntilIdle()

        // E2 should start after E1 ends
        const event2StartIdx = executionOrder.indexOf('Event2_start')
        expect(event2StartIdx).toBeGreaterThan(event1EndIdx)
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })
})
