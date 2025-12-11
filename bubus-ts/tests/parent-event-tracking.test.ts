/**
 * Test parent event tracking functionality in EventBus.
 * Translated from Python tests/test_parent_event_tracking.py
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus, BaseEvent } from '../src/index.js'

// =============================================================================
// Test Event Classes
// =============================================================================

class ParentEvent extends BaseEvent<string> {
  declare message: string
}

class ChildEvent extends BaseEvent<string> {
  declare data: string
}

class GrandchildEvent extends BaseEvent<string> {
  declare value: number
}

// =============================================================================
// Tests
// =============================================================================

describe('ParentEventTracking', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus({ name: 'TestBus' })
  })

  afterEach(async () => {
    await bus.stop({ clear: true })
  })

  describe('basic parent tracking', () => {
    it('should set event_parent_id on child events dispatched from handler', async () => {
      const eventChildren: ChildEvent[] = []

      bus.on(ParentEvent, async (event) => {
        const child = new ChildEvent({ data: `child_of_${event.message}` })
        bus.dispatch(child)
        eventChildren.push(child)
        return 'parent_handled'
      })

      const parent = new ParentEvent({ message: 'test_parent' })
      const parentResult = bus.dispatch(parent)

      await bus.waitUntilIdle()
      await parentResult

      expect(eventChildren).toHaveLength(1)
      expect(eventChildren[0].event_parent_id).toBe(parent.event_id)
    })

    it('should track parent-child relationships across multiple levels', async () => {
      const eventsByLevel: Record<string, BaseEvent | null> = {
        parent: null,
        child: null,
        grandchild: null,
      }

      bus.on(ParentEvent, async (event) => {
        eventsByLevel.parent = event
        const child = new ChildEvent({ data: 'child_data' })
        bus.dispatch(child)
        return 'parent'
      })

      bus.on(ChildEvent, async (event) => {
        eventsByLevel.child = event
        const grandchild = new GrandchildEvent({ value: 42 })
        bus.dispatch(grandchild)
        return 'child'
      })

      bus.on(GrandchildEvent, async (event) => {
        eventsByLevel.grandchild = event
        return 'grandchild'
      })

      const parent = new ParentEvent({ message: 'root' })
      bus.dispatch(parent)

      await bus.waitUntilIdle()

      expect(eventsByLevel.parent).not.toBeNull()
      expect(eventsByLevel.child).not.toBeNull()
      expect(eventsByLevel.grandchild).not.toBeNull()

      // Verify the parent chain
      expect(eventsByLevel.parent!.event_parent_id).toBeNull()
      expect(eventsByLevel.child!.event_parent_id).toBe(parent.event_id)
      expect(eventsByLevel.grandchild!.event_parent_id).toBe(
        eventsByLevel.child!.event_id
      )
    })

    it('should track multiple children from same parent', async () => {
      const eventChildren: ChildEvent[] = []

      bus.on(ParentEvent, async (event) => {
        for (let i = 0; i < 3; i++) {
          const child = new ChildEvent({ data: `child_${i}` })
          bus.dispatch(child)
          eventChildren.push(child)
        }
        return 'spawned_children'
      })

      const parent = new ParentEvent({ message: 'multi_child_parent' })
      bus.dispatch(parent)

      await bus.waitUntilIdle()

      expect(eventChildren).toHaveLength(3)
      for (const child of eventChildren) {
        expect(child.event_parent_id).toBe(parent.event_id)
      }
    })
  })

  describe('parallel handlers', () => {
    it('should track parent correctly with parallel handlers', async () => {
      const eventsFromHandlers: Record<string, ChildEvent[]> = { h1: [], h2: [] }

      bus.on(ParentEvent, async (event) => {
        await new Promise((r) => setTimeout(r, 10))
        const child = new ChildEvent({ data: 'from_h1' })
        bus.dispatch(child)
        eventsFromHandlers.h1.push(child)
        return 'h1'
      })

      bus.on(ParentEvent, async (event) => {
        await new Promise((r) => setTimeout(r, 20))
        const child = new ChildEvent({ data: 'from_h2' })
        bus.dispatch(child)
        eventsFromHandlers.h2.push(child)
        return 'h2'
      })

      const parent = new ParentEvent({ message: 'parallel_test' })
      bus.dispatch(parent)

      await bus.waitUntilIdle()

      expect(eventsFromHandlers.h1).toHaveLength(1)
      expect(eventsFromHandlers.h2).toHaveLength(1)
      expect(eventsFromHandlers.h1[0].event_parent_id).toBe(parent.event_id)
      expect(eventsFromHandlers.h2[0].event_parent_id).toBe(parent.event_id)
    })
  })

  describe('explicit parent ID', () => {
    it('should not override explicitly set event_parent_id', async () => {
      let capturedChild: ChildEvent | null = null

      bus.on(ParentEvent, async (event) => {
        const explicitParentId = '01234567-89ab-cdef-0123-456789abcdef'
        const child = new ChildEvent({
          data: 'explicit',
          event_parent_id: explicitParentId,
        })
        bus.dispatch(child)
        capturedChild = child
        return 'dispatched'
      })

      const parent = new ParentEvent({ message: 'test' })
      bus.dispatch(parent)

      await bus.waitUntilIdle()

      expect(capturedChild).not.toBeNull()
      expect(capturedChild!.event_parent_id).toBe(
        '01234567-89ab-cdef-0123-456789abcdef'
      )
      expect(capturedChild!.event_parent_id).not.toBe(parent.event_id)
    })
  })

  describe('cross-bus parent tracking', () => {
    it('should track parent across multiple EventBuses', async () => {
      const bus1 = new EventBus({ name: 'Bus1' })
      const bus2 = new EventBus({ name: 'Bus2' })

      const capturedEvents: Array<{
        bus: string
        event: BaseEvent
        child: ChildEvent | null
      }> = []

      bus1.on(ParentEvent, async (event) => {
        const child = new ChildEvent({ data: 'cross_bus_child' })
        bus2.dispatch(child)
        capturedEvents.push({ bus: 'bus1', event, child })
        return 'bus1_handled'
      })

      bus2.on(ChildEvent, async (event) => {
        capturedEvents.push({ bus: 'bus2', event, child: null })
        return 'bus2_handled'
      })

      try {
        const parent = new ParentEvent({ message: 'cross_bus_test' })
        bus1.dispatch(parent)

        await bus1.waitUntilIdle()
        await bus2.waitUntilIdle()

        expect(capturedEvents).toHaveLength(2)
        expect(capturedEvents[0].child!.event_parent_id).toBe(parent.event_id)
        expect(capturedEvents[1].event.event_parent_id).toBe(parent.event_id)
      } finally {
        await bus1.stop({ clear: true })
        await bus2.stop({ clear: true })
      }
    })
  })

  describe('sync handler parent tracking', () => {
    it('should track parent with sync handlers', async () => {
      const eventChildren: ChildEvent[] = []

      bus.on(ParentEvent, (event) => {
        const child = new ChildEvent({ data: 'from_sync' })
        bus.dispatch(child)
        eventChildren.push(child)
        return 'sync_handled'
      })

      const parent = new ParentEvent({ message: 'sync_test' })
      bus.dispatch(parent)

      await bus.waitUntilIdle()

      expect(eventChildren).toHaveLength(1)
      expect(eventChildren[0].event_parent_id).toBe(parent.event_id)
    })
  })

  describe('error handler parent tracking', () => {
    it('should track parent even when handlers error', async () => {
      const eventChildren: ChildEvent[] = []

      bus.on(ParentEvent, async () => {
        const child = new ChildEvent({ data: 'before_error' })
        bus.dispatch(child)
        eventChildren.push(child)
        throw new Error('Handler error - expected')
      })

      bus.on(ParentEvent, async () => {
        const child = new ChildEvent({ data: 'after_error' })
        bus.dispatch(child)
        eventChildren.push(child)
        return 'success'
      })

      const parent = new ParentEvent({ message: 'error_test' })
      bus.dispatch(parent)

      await bus.waitUntilIdle()

      expect(eventChildren).toHaveLength(2)
      for (const child of eventChildren) {
        expect(child.event_parent_id).toBe(parent.event_id)
      }
    })
  })

  describe('event children tracking', () => {
    it('should track child events in parent eventChildren array', async () => {
      bus.on(ParentEvent, async (event) => {
        for (let i = 0; i < 3; i++) {
          const child = new ChildEvent({ data: `child_${i}` })
          bus.dispatch(child)
        }
        return 'parent_done'
      })

      bus.on(ChildEvent, async (event) => {
        return `handled_${event.data}`
      })

      const parent = new ParentEvent({ message: 'test_children_tracking' })
      bus.dispatch(parent)

      await parent.completed

      expect(parent.eventChildren).toHaveLength(3)
      for (let i = 0; i < 3; i++) {
        const child = parent.eventChildren[i] as ChildEvent
        expect(child.data).toBe(`child_${i}`)
        expect(child.event_parent_id).toBe(parent.event_id)
      }
    })

    it('should track nested event children', async () => {
      bus.on(ParentEvent, async () => {
        const child = new ChildEvent({ data: 'level1' })
        bus.dispatch(child)
        return 'parent'
      })

      bus.on(ChildEvent, async () => {
        const grandchild = new GrandchildEvent({ value: 42 })
        bus.dispatch(grandchild)
        return 'child'
      })

      bus.on(GrandchildEvent, async (event) => {
        return `grandchild_${event.value}`
      })

      const parent = new ParentEvent({ message: 'nested_test' })
      bus.dispatch(parent)
      await parent.completed

      expect(parent.eventChildren).toHaveLength(1)
      const child = parent.eventChildren[0] as ChildEvent

      expect(child.eventChildren).toHaveLength(1)
      const grandchild = child.eventChildren[0] as GrandchildEvent
      expect(grandchild.value).toBe(42)
    })

    it('should have empty eventChildren when handler dispatches none', async () => {
      bus.on(ParentEvent, async () => {
        return 'no_children'
      })

      const parent = new ParentEvent({ message: 'no_children_test' })
      bus.dispatch(parent)
      await parent.completed

      expect(parent.eventChildren).toHaveLength(0)
    })
  })

  describe('forwarded events', () => {
    it('should not count forwarded events as children', async () => {
      const bus2 = new EventBus({ name: 'Bus2' })

      try {
        // Forward all events from bus to bus2
        bus.on('*', bus2.dispatch.bind(bus2))

        const parent = new ParentEvent({ message: 'forward_test' })
        bus.dispatch(parent)
        await bus.waitUntilIdle()
        await bus2.waitUntilIdle()

        // Parent should have no children (forwarding doesn't create children)
        expect(parent.eventChildren).toHaveLength(0)
      } finally {
        await bus2.stop({ clear: true })
      }
    })
  })

  describe('event_are_all_children_complete', () => {
    it('should return true when all children are complete', async () => {
      const completionOrder: string[] = []

      bus.on(ParentEvent, async () => {
        const child1 = new ChildEvent({ data: 'child1' })
        const child2 = new ChildEvent({ data: 'child2' })
        bus.dispatch(child1)
        bus.dispatch(child2)
        completionOrder.push('parent_handler')
        return 'parent'
      })

      bus.on(ChildEvent, async (event) => {
        await new Promise((r) => setTimeout(r, 10))
        completionOrder.push(`child_handler_${event.data}`)
        return `handled_${event.data}`
      })

      const parent = new ParentEvent({ message: 'completion_test' })
      bus.dispatch(parent)

      // At this point, parent handler hasn't run yet, so no children exist
      expect(parent.eventAreAllChildrenComplete()).toBe(true) // No children yet

      // Wait for parent event to complete (includes waiting for children)
      await parent.completed

      // Now all children should be complete
      expect(parent.eventAreAllChildrenComplete()).toBe(true)
      expect(parent.eventChildren).toHaveLength(2)
      for (const child of parent.eventChildren) {
        expect(child.eventStatus).toBe('completed')
      }
    })
  })
})
