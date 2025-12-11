/**
 * Test event forwarding between buses including loop prevention.
 * Translated from Python tests/test_eventbus.py (forwarding tests)
 */

import { describe, it, expect } from 'vitest'
import { EventBus, BaseEvent } from '../src/index.js'

// =============================================================================
// Test Event Classes
// =============================================================================

class LoopEvent extends BaseEvent<string> {}

class UserActionEvent extends BaseEvent<string> {
  declare action: string
  declare user_id: string
}

class SystemEventModel extends BaseEvent<string> {
  declare event_name: string
  declare severity: string
}

// =============================================================================
// Tests
// =============================================================================

describe('EventForwarding', () => {
  describe('loop prevention', () => {
    it('should prevent infinite forwarding loops', async () => {
      const busA = new EventBus({ name: 'ForwardBusA' })
      const busB = new EventBus({ name: 'ForwardBusB' })
      const busC = new EventBus({ name: 'ForwardBusC' })

      const seen: Record<string, number> = { A: 0, B: 0, C: 0 }

      busA.on(LoopEvent, async () => {
        seen.A++
        return 'handled-a'
      })

      busB.on(LoopEvent, async () => {
        seen.B++
        return 'handled-b'
      })

      busC.on(LoopEvent, async () => {
        seen.C++
        return 'handled-c'
      })

      // Create a forwarding cycle A -> B -> C -> A
      busA.on('*', busB.dispatch.bind(busB))
      busB.on('*', busC.dispatch.bind(busC))
      busC.on('*', busA.dispatch.bind(busA))

      try {
        const event = await busA.dispatch(new LoopEvent())

        await busA.waitUntilIdle()
        await busB.waitUntilIdle()
        await busC.waitUntilIdle()

        // Each bus should receive the event exactly once
        expect(seen).toEqual({ A: 1, B: 1, C: 1 })

        // Event path should show the journey without loops
        expect(event.event_path).toEqual([
          'ForwardBusA',
          'ForwardBusB',
          'ForwardBusC',
        ])
      } finally {
        await busA.stop({ clear: true })
        await busB.stop({ clear: true })
        await busC.stop({ clear: true })
      }
    })
  })

  describe('tree-level hierarchy bubbling', () => {
    it('should bubble events through hierarchy with correct path', async () => {
      const parentBus = new EventBus({ name: 'ParentBus' })
      const childBus = new EventBus({ name: 'ChildBus' })
      const subchildBus = new EventBus({ name: 'SubchildBus' })

      const eventsAtParent: BaseEvent[] = []
      const eventsAtChild: BaseEvent[] = []
      const eventsAtSubchild: BaseEvent[] = []

      parentBus.on('*', async (event) => {
        eventsAtParent.push(event)
        return 'parent_received'
      })

      childBus.on('*', async (event) => {
        eventsAtChild.push(event)
        return 'child_received'
      })

      subchildBus.on('*', async (event) => {
        eventsAtSubchild.push(event)
        return 'subchild_received'
      })

      // Subscribe buses: parent <- child <- subchild
      childBus.on('*', parentBus.dispatch.bind(parentBus))
      subchildBus.on('*', childBus.dispatch.bind(childBus))

      try {
        // Emit from the bottom
        const emitted = subchildBus.dispatch(
          new UserActionEvent({ action: 'bubble_test', user_id: 'test_user' })
        )

        await subchildBus.waitUntilIdle()
        await childBus.waitUntilIdle()
        await parentBus.waitUntilIdle()

        // Verify event received at all levels
        expect(eventsAtSubchild).toHaveLength(1)
        expect(eventsAtChild).toHaveLength(1)
        expect(eventsAtParent).toHaveLength(1)

        // Verify event_path shows complete journey
        const finalEvent = eventsAtParent[0]
        expect(finalEvent.event_path).toEqual([
          'SubchildBus',
          'ChildBus',
          'ParentBus',
        ])

        // Verify it's the same event
        expect((finalEvent as UserActionEvent).action).toBe('bubble_test')
        expect((finalEvent as UserActionEvent).user_id).toBe('test_user')
        expect(finalEvent.event_id).toBe(emitted.event_id)

        // Test event emitted at middle level
        eventsAtParent.length = 0
        eventsAtChild.length = 0
        eventsAtSubchild.length = 0

        childBus.dispatch(new SystemEventModel({ event_name: 'middle_test', severity: 'info' }))

        await childBus.waitUntilIdle()
        await parentBus.waitUntilIdle()

        // Should only reach child and parent, not subchild
        expect(eventsAtSubchild).toHaveLength(0)
        expect(eventsAtChild).toHaveLength(1)
        expect(eventsAtParent).toHaveLength(1)
        expect(eventsAtParent[0].event_path).toEqual(['ChildBus', 'ParentBus'])
      } finally {
        await parentBus.stop()
        await childBus.stop()
        await subchildBus.stop()
      }
    })
  })

  describe('circular subscription prevention', () => {
    it('should prevent circular subscriptions from infinite loops', async () => {
      const peer1 = new EventBus({ name: 'Peer1' })
      const peer2 = new EventBus({ name: 'Peer2' })
      const peer3 = new EventBus({ name: 'Peer3' })

      const eventsAtPeer1: BaseEvent[] = []
      const eventsAtPeer2: BaseEvent[] = []
      const eventsAtPeer3: BaseEvent[] = []

      peer1.on('*', async (event) => {
        eventsAtPeer1.push(event)
        return 'peer1_received'
      })

      peer2.on('*', async (event) => {
        eventsAtPeer2.push(event)
        return 'peer2_received'
      })

      peer3.on('*', async (event) => {
        eventsAtPeer3.push(event)
        return 'peer3_received'
      })

      // Create circular subscription: peer1 -> peer2 -> peer3 -> peer1
      peer1.on('*', peer2.dispatch.bind(peer2))
      peer2.on('*', peer3.dispatch.bind(peer3))
      peer3.on('*', peer1.dispatch.bind(peer1))

      try {
        const emitted = peer1.dispatch(
          new UserActionEvent({ action: 'circular_test', user_id: 'test_user' })
        )

        // Give time for any potential loops
        await new Promise((r) => setTimeout(r, 200))
        await peer1.waitUntilIdle()
        await peer2.waitUntilIdle()
        await peer3.waitUntilIdle()

        // Each peer should receive exactly once
        expect(eventsAtPeer1).toHaveLength(1)
        expect(eventsAtPeer2).toHaveLength(1)
        expect(eventsAtPeer3).toHaveLength(1)

        // Check paths show propagation without loops
        expect(eventsAtPeer1[0].event_path).toEqual(['Peer1', 'Peer2', 'Peer3'])
        expect(eventsAtPeer2[0].event_path).toEqual(['Peer1', 'Peer2', 'Peer3'])
        expect(eventsAtPeer3[0].event_path).toEqual(['Peer1', 'Peer2', 'Peer3'])

        // All events have same ID
        expect(eventsAtPeer1[0].event_id).toBe(emitted.event_id)
        expect(eventsAtPeer2[0].event_id).toBe(emitted.event_id)
        expect(eventsAtPeer3[0].event_id).toBe(emitted.event_id)

        // Test starting from different peer
        eventsAtPeer1.length = 0
        eventsAtPeer2.length = 0
        eventsAtPeer3.length = 0

        peer2.dispatch(new SystemEventModel({ event_name: 'circular_test_2', severity: 'info' }))

        await new Promise((r) => setTimeout(r, 200))
        await peer1.waitUntilIdle()
        await peer2.waitUntilIdle()
        await peer3.waitUntilIdle()

        expect(eventsAtPeer1).toHaveLength(1)
        expect(eventsAtPeer2).toHaveLength(1)
        expect(eventsAtPeer3).toHaveLength(1)

        expect(eventsAtPeer2[0].event_path).toEqual(['Peer2', 'Peer3', 'Peer1'])
        expect(eventsAtPeer3[0].event_path).toEqual(['Peer2', 'Peer3', 'Peer1'])
        expect(eventsAtPeer1[0].event_path).toEqual(['Peer2', 'Peer3', 'Peer1'])
      } finally {
        await peer1.stop()
        await peer2.stop()
        await peer3.stop()
      }
    })
  })

  describe('forwarding flattens results', () => {
    it('should collect results from all buses in forwarding chain', async () => {
      const bus1 = new EventBus({ name: 'Bus1' })
      const bus2 = new EventBus({ name: 'Bus2' })
      const bus3 = new EventBus({ name: 'Bus3' })

      const results: string[] = []

      bus1.on('TestEvent', async () => {
        results.push('bus1')
        return 'from_bus1'
      })

      bus2.on('TestEvent', async () => {
        results.push('bus2')
        return 'from_bus2'
      })

      bus3.on('TestEvent', async () => {
        results.push('bus3')
        return 'from_bus3'
      })

      // Set up forwarding chain
      bus1.on('*', bus2.dispatch.bind(bus2))
      bus2.on('*', bus3.dispatch.bind(bus3))

      try {
        const event = bus1.dispatch(new BaseEvent({ event_type: 'TestEvent' }))

        await bus1.waitUntilIdle()
        await bus2.waitUntilIdle()
        await bus3.waitUntilIdle()
        await event

        // All handlers should have results
        const eventResults = Array.from(event.event_results.values())
        const resultValues = eventResults.map((r) => r.result)

        expect(resultValues).toContain('from_bus1')
        expect(resultValues).toContain('from_bus2')
        expect(resultValues).toContain('from_bus3')

        expect(results).toEqual(['bus1', 'bus2', 'bus3'])
      } finally {
        await bus1.stop()
        await bus2.stop()
        await bus3.stop()
      }
    })
  })
})
