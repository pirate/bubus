/**
 * Test event_bus property access from within handlers.
 * Translated from Python tests/test_event_bus_property.py
 */

import { describe, it, expect } from 'vitest'
import { EventBus, BaseEvent } from '../src/index.js'

// =============================================================================
// Test Event Classes
// =============================================================================

class MainEvent extends BaseEvent<void> {
  declare message: string
}

class ChildEvent extends BaseEvent<void> {
  declare data: string
}

class GrandchildEvent extends BaseEvent<void> {
  declare info: string
}

// =============================================================================
// Tests
// =============================================================================

describe('EventBusProperty', () => {
  describe('single bus', () => {
    it('should allow accessing event_bus inside handler', async () => {
      const bus = new EventBus({ name: 'TestBus' })

      let handlerCalled = false
      let dispatchedChild: ChildEvent | null = null

      bus.on(MainEvent, async (event) => {
        handlerCalled = true

        // Should be able to access eventBus inside handler
        expect(event.eventBus).toBe(bus)
        expect(event.eventBus!.name).toBe('TestBus')

        // Should be able to dispatch child events using the property
        dispatchedChild = await event.eventBus!.immediate(new ChildEvent({ data: 'child' }))
      })

      bus.on(ChildEvent, async () => 'child_done')

      try {
        await bus.immediate(new MainEvent({ message: 'test' }))

        expect(handlerCalled).toBe(true)
        expect(dispatchedChild).not.toBeNull()
        expect(dispatchedChild).toBeInstanceOf(ChildEvent)
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })

  describe('multiple buses', () => {
    it('should return correct bus for each handler context', async () => {
      const bus1 = new EventBus({ name: 'Bus1' })
      const bus2 = new EventBus({ name: 'Bus2' })

      let handler1Called = false
      let handler2Called = false

      bus1.on(MainEvent, async (event) => {
        handler1Called = true
        expect(event.eventBus).toBe(bus1)
        expect(event.eventBus!.name).toBe('Bus1')
      })

      bus2.on(MainEvent, async (event) => {
        handler2Called = true
        expect(event.eventBus).toBe(bus2)
        expect(event.eventBus!.name).toBe('Bus2')
      })

      try {
        await bus1.immediate(new MainEvent({ message: 'bus1' }))
        expect(handler1Called).toBe(true)

        await bus2.immediate(new MainEvent({ message: 'bus2' }))
        expect(handler2Called).toBe(true)
      } finally {
        await bus1.stop({ clear: true })
        await bus2.stop({ clear: true })
      }
    })
  })

  describe('with forwarding', () => {
    it('should show forwarded bus in event_bus property', async () => {
      const bus1 = new EventBus({ name: 'Bus1' })
      const bus2 = new EventBus({ name: 'Bus2' })

      // Forward all events from bus1 to bus2
      bus1.on('*', (event) => bus2.immediate(event))

      let handlerBus: EventBus | null = null
      let handlerComplete = false

      bus2.on(MainEvent, async (event) => {
        // When forwarded, the event_bus should be the bus currently processing
        handlerBus = event.eventBus
        handlerComplete = true
      })

      try {
        // Dispatch to bus1, which forwards to bus2
        await bus1.immediate(new MainEvent({ message: 'forward' }))

        // The handler in bus2 should see bus2 as the event_bus
        expect(handlerBus).not.toBeNull()
        expect(handlerBus!.name).toBe('Bus2')
        expect(handlerBus).toBe(bus2)
        expect(handlerComplete).toBe(true)
      } finally {
        await bus1.stop({ clear: true })
        await bus2.stop({ clear: true })
      }
    })
  })

  describe('outside handler context', () => {
    it('should return null when accessed outside handler (before processing)', async () => {
      const bus = new EventBus({ name: 'TestBus' })

      const event = new MainEvent({ message: 'test' })

      try {
        // Before processing, eventBus should be null
        expect(event.eventBus).toBeNull()
      } finally {
        await bus.stop({ clear: true })
      }
    })

    it('should retain eventBus reference after processing', async () => {
      const bus = new EventBus({ name: 'TestBus' })

      bus.on(MainEvent, async () => 'done')

      try {
        const event = await bus.immediate(new MainEvent({ message: 'test' }))

        // After processing, eventBus reference is retained (set during handling)
        expect(event.eventBus).toBe(bus)
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })

  describe('nested handlers', () => {
    it('should show same bus in nested handler scenarios', async () => {
      const bus = new EventBus({ name: 'MainBus' })

      let innerBusName: string | null = null

      // Register child handler first
      bus.on(ChildEvent, async (childEvent) => {
        // Both parent and child should see the same bus
        innerBusName = childEvent.eventBus!.name
      })

      bus.on(MainEvent, async (event) => {
        // Dispatch a child event from within handler using queue jumping
        await event.eventBus!.immediate(new ChildEvent({ data: 'nested' }))
      })

      try {
        await bus.immediate(new MainEvent({ message: 'outer' }))

        expect(innerBusName).toBe('MainBus')
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })

  describe('child dispatch', () => {
    it('should track event_bus through child event chain', async () => {
      const bus = new EventBus({ name: 'MainBus' })

      const executionOrder: string[] = []
      let childEventRef: ChildEvent | null = null
      let grandchildEventRef: GrandchildEvent | null = null

      bus.on(MainEvent, async (event) => {
        executionOrder.push('parent_start')

        expect(event.eventBus).toBe(bus)
        expect(event.eventBus!.name).toBe('MainBus')

        // Use queue jumping to process child immediately
        childEventRef = await event.eventBus!.immediate(
          new ChildEvent({ data: 'from_parent' })
        )

        executionOrder.push('parent_end')
      })

      bus.on(ChildEvent, async (event) => {
        executionOrder.push('child_start')

        expect(event.eventBus).toBe(bus)
        expect(event.eventBus!.name).toBe('MainBus')
        expect(event.data).toBe('from_parent')

        // Use queue jumping to process grandchild immediately
        grandchildEventRef = await event.eventBus!.immediate(
          new GrandchildEvent({ info: 'from_child' })
        )

        executionOrder.push('child_end')
      })

      bus.on(GrandchildEvent, async (event) => {
        executionOrder.push('grandchild_start')

        expect(event.eventBus).toBe(bus)
        expect(event.eventBus!.name).toBe('MainBus')
        expect(event.info).toBe('from_child')

        executionOrder.push('grandchild_end')
      })

      try {
        const parentEvent = await bus.immediate(new MainEvent({ message: 'start' }))

        // Verify execution order
        expect(executionOrder).toEqual([
          'parent_start',
          'child_start',
          'grandchild_start',
          'grandchild_end',
          'child_end',
          'parent_end',
        ])

        // Verify all events completed
        expect(parentEvent.eventStatus).toBe('completed')
        expect(childEventRef).not.toBeNull()
        expect(childEventRef!.eventStatus).toBe('completed')
        expect(grandchildEventRef).not.toBeNull()
        expect(grandchildEventRef!.eventStatus).toBe('completed')

        // Verify parent-child relationships
        expect(childEventRef!.event_parent_id).toBe(parentEvent.event_id)
        expect(grandchildEventRef!.event_parent_id).toBe(childEventRef!.event_id)
      } finally {
        await bus.stop({ clear: true })
      }
    })
  })

  describe('multi-bus child dispatch', () => {
    it('should dispatch child events to correct bus across forwarding', async () => {
      const bus1 = new EventBus({ name: 'Bus1' })
      const bus2 = new EventBus({ name: 'Bus2' })

      // Forward all events from bus1 to bus2
      bus1.on('*', (event) => bus2.immediate(event))

      let childDispatchBus: EventBus | null = null
      let childHandlerBus: EventBus | null = null
      let handlersComplete = false

      bus2.on(MainEvent, async (event) => {
        // This handler runs in bus2 (due to forwarding)
        expect(event.eventBus).toBe(bus2)

        // Dispatch child using event.eventBus (should dispatch to bus2)
        childDispatchBus = event.eventBus
        await event.eventBus!.immediate(new ChildEvent({ data: 'from_bus2_handler' }))
      })

      bus2.on(ChildEvent, async (event) => {
        // Child handler should see bus2 as well
        childHandlerBus = event.eventBus
        expect(event.data).toBe('from_bus2_handler')
        handlersComplete = true
      })

      try {
        // Dispatch to bus1, which forwards to bus2
        await bus1.immediate(new MainEvent({ message: 'start' }))

        // Verify child was dispatched to bus2
        expect(childDispatchBus).not.toBeNull()
        expect(childHandlerBus).not.toBeNull()
        expect(childDispatchBus).toBe(bus2)
        expect(childHandlerBus).toBe(bus2)
        expect(handlersComplete).toBe(true)
      } finally {
        await bus1.stop({ clear: true })
        await bus2.stop({ clear: true })
      }
    })
  })
})
